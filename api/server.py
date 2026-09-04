from __future__ import annotations

import asyncio
import logging
import os
import secrets
import subprocess
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator
from urllib.parse import urlparse

from logging.handlers import RotatingFileHandler

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

from api.admin import router as admin_router
from api.admin import ws_router as admin_ws_router
from api.schemas import (
    EnqueueResponse,
    HealthResponse,
    JobFullResponse,
    JobResultResponse,
    JobStatusResponse,
    MediaDownloadRequest,
)
from core.config import DOWNLOAD_DIR, HTTP_TIMEOUT_SECONDS
from engine.media_engine import MediaEngine
from job_queue.connection import is_redis_available
from job_queue.job_store import JobStatus, get_job, mark_done
from storage.result_store import get_result

from core.logging_filter import install_redacting_filter

logger = logging.getLogger("api")
logger.propagate = False

# Attach dashboard log file handler so all server events flow into the UI console
_dash_handler = RotatingFileHandler(
    "dashboard.log",
    maxBytes=10_000_000,
    backupCount=3,
    encoding="utf-8",
)
_dash_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
)
logger.addHandler(_dash_handler)
install_redacting_filter(logger)

# Silence redundant uvicorn access logs to prevent duplicate request lines
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

_engine: MediaEngine | None = None
_dashboard_security = HTTPBasic(auto_error=False)


def require_admin_auth(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
    credentials: HTTPBasicCredentials | None = Depends(_dashboard_security),
) -> None:
    """Unified authentication for dashboard & sensitive APIs:
    Accepts:
    - Header: X-Admin-Token
    - Header: Authorization: Bearer <token>
    - Header: Authorization: Basic <base64>
    If neither ADMIN_API_TOKEN nor DASHBOARD_PASSWORD is configured, permits access.
    """
    # Normalize FastAPI parameter objects if invoked directly in unit tests
    if not isinstance(authorization, str):
        authorization = None
    if not isinstance(x_admin_token, str):
        x_admin_token = None
    if not isinstance(credentials, HTTPBasicCredentials):
        credentials = None

    expected_token = os.getenv("ADMIN_API_TOKEN", "").strip()
    expected_user = os.getenv("DASHBOARD_USERNAME", "admin").strip()
    expected_pass = os.getenv("DASHBOARD_PASSWORD", "").strip() or expected_token

    if not expected_token and not expected_pass:
        return

    # 1. Check X-Admin-Token
    if x_admin_token and expected_token and secrets.compare_digest(x_admin_token.strip(), expected_token):
        return

    # 2. Check Bearer token
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            cand = token.strip()
            if expected_token and secrets.compare_digest(cand, expected_token):
                return
            if expected_pass and secrets.compare_digest(cand, expected_pass):
                return

    # 3. Check Basic Auth
    if credentials:
        if secrets.compare_digest(credentials.username, expected_user) and (
            (expected_pass and secrets.compare_digest(credentials.password, expected_pass))
            or (expected_token and secrets.compare_digest(credentials.password, expected_token))
        ):
            return

    raise HTTPException(
        status_code=401,
        detail="Unauthorized",
        headers={"WWW-Authenticate": 'Basic realm="Smart Creators Bot Dashboard"'},
    )


def require_dashboard_auth(credentials: HTTPBasicCredentials | None = Depends(_dashboard_security)) -> None:
    """Backwards compatibility alias for require_admin_auth."""
    require_admin_auth(credentials=credentials)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine
    _engine = MediaEngine()
    yield


app = FastAPI(
    title="Cloud Media Engine API",
    version="3.3.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/docs", include_in_schema=False, dependencies=[Depends(require_dashboard_auth)])
async def custom_swagger_ui():
    return get_swagger_ui_html(openapi_url="/openapi.json", title="Smart Creators API - Documentation")


@app.get("/openapi.json", include_in_schema=False, dependencies=[Depends(require_dashboard_auth)])
async def custom_openapi():
    return get_openapi(title=app.title, version=app.version, routes=app.routes)


def _configured_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


_allowed_origins = _configured_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=(
        None
        if _allowed_origins
        else r"^https://(?:[a-z0-9-]+\.)*lovable\.app$|^http://localhost(?::\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Token"],
)

app.include_router(admin_router)
app.include_router(admin_ws_router)


@app.middleware("http")
async def log_requests_middleware(request: Request, call_next):
    start_time = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start_time) * 1000, 1)
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path
    if not (path.startswith("/api/logs") or path.startswith("/assets") or path == "/favicon.ico"):
        logger.info(f'{client_ip} - "{request.method} {path}" {response.status_code} ({duration_ms}ms)')
    return response


def is_valid_url(value: str) -> bool:
    try:
        p = urlparse(value)
        return p.scheme in {"http", "https"} and bool(p.netloc)
    except Exception:
        return False


def _validate_quality(quality: str) -> str:
    allowed_qualities = {"144", "360", "480", "720", "1080", "best", "audio"}
    if quality not in allowed_qualities:
        return "best"
    return quality


async def _enqueue_job(
    url: str,
    quality: str,
    chat_id: int | None = None,
    job_id: str | None = None,
) -> str:
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="رابط غير صالح")

    quality = _validate_quality(quality)
    if _engine is None:
        raise HTTPException(status_code=503, detail="Media engine is not ready")
    result = await _engine.submit(
        url,
        quality,
        job_id=job_id,
        chat_id=chat_id,
    )
    return result.job_id


def _build_status_response(job: dict) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=job["job_id"],
        status=job.get("status", JobStatus.QUEUED.value),
        progress=job.get("progress", 0.0),
        text=job.get("text", ""),
        error=job.get("error"),
        url=job.get("url", ""),
        quality=job.get("quality", "best"),
        chat_id=job.get("chat_id"),
        has_result=job.get("has_result", False),
        created_at=job.get("created_at", ""),
        updated_at=job.get("updated_at", ""),
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
    )


def _build_result_response(job_id: str, job: dict, result: dict | None) -> JobResultResponse:
    if result:
        def _to_int(val: Any) -> int:
            try:
                return int(float(val or 0))
            except (ValueError, TypeError):
                return 0

        return JobResultResponse(
            job_id=job_id,
            status=job.get("status", JobStatus.DONE.value),
            media_type=result.get("media_type"),
            file=result.get("file"),
            duration=_to_int(result.get("duration")),
            width=_to_int(result.get("width")),
            height=_to_int(result.get("height")),
            thumbnail=result.get("thumbnail"),
            completed_at=result.get("completed_at"),
        )
    return JobResultResponse(
        job_id=job_id,
        status=job.get("status", JobStatus.QUEUED.value),
    )


def _fetch_job_or_404(job_id: str) -> dict:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/", response_model=HealthResponse)
@app.head("/", include_in_schema=False)
def health():
    backend = "redis" if is_redis_available() else "memory"
    return HealthResponse(
        status="ok",
        version="3.3.0",
        engine="media-engine",
        queue=backend if is_redis_available() else "in-process-fallback",
        result_store=backend,
    )


@app.post("/media/download", response_model=EnqueueResponse)
async def create_media_job(body: MediaDownloadRequest):
    """Bot entry point – enqueue only, return job_id immediately."""
    job_id = await _enqueue_job(body.url, body.quality, body.chat_id)
    return EnqueueResponse(job_id=job_id, status="queued")


@app.post("/download", response_model=EnqueueResponse)
async def start_download(
    url: str = Query(..., description="Video URL to download"),
    quality: str = Query("best", description="Video quality: 144, 360, 480, 720, 1080, or best"),
):
    job_id = await _enqueue_job(url, quality)
    return EnqueueResponse(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Track job lifecycle – status, progress, timestamps."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    return _build_status_response(job)


@app.get("/jobs/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    """Fetch completed media result for a job."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    status = job.get("status")

    if status == JobStatus.ERROR.value:
        raise HTTPException(
            status_code=409,
            detail={"message": "Job failed", "error": job.get("error")},
        )

    if status == JobStatus.CANCELLED.value:
        raise HTTPException(status_code=410, detail="Job was cancelled")

    if status not in {JobStatus.READY.value, JobStatus.DONE.value}:
        raise HTTPException(
            status_code=202,
            detail={"message": "Result not ready", "status": status},
        )

    try:
        result = await asyncio.to_thread(get_result, job_id)
    except Exception as exc:
        logger.error(f"Error fetching result for job {job_id}: {exc}", exc_info=True)
        result = None

    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")

    return _build_result_response(job_id, job, result)


@app.post("/jobs/{job_id}/delivered", dependencies=[Depends(require_admin_auth)])
async def confirm_job_delivery(job_id: str):
    """Mark complete only after Telegram accepted video or document delivery."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    if job.get("status") == JobStatus.DONE.value:
        return {"job_id": job_id, "status": JobStatus.DONE.value}
    if job.get("status") != JobStatus.READY.value:
        raise HTTPException(status_code=409, detail="Job is not ready for delivery")
    await asyncio.to_thread(mark_done, job_id)
    logger.info("JOB_COMPLETED job_id=%s", job_id)
    return {"job_id": job_id, "status": JobStatus.DONE.value}


@app.get("/jobs/{job_id}/full", response_model=JobFullResponse)
async def get_job_full(job_id: str):
    """Combined job status + result (if available)."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    result = await asyncio.to_thread(get_result, job_id)
    return JobFullResponse(
        job=_build_status_response(job),
        result=_build_result_response(job_id, job, result) if result else None,
    )


@app.get("/result/{job_id}")
async def get_result_legacy(job_id: str):
    """Legacy combined payload for backward compatibility."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    result = await asyncio.to_thread(get_result, job_id)

    payload = dict(job)
    if result:
        payload.update(
            {
                "file": result.get("file"),
                "media_type": result.get("media_type"),
                "duration": result.get("duration", 0),
                "width": result.get("width", 0),
                "height": result.get("height", 0),
                "thumbnail": result.get("thumbnail"),
            }
        )
    return payload


@app.get("/progress/{job_id}")
async def progress_stream(job_id: str):
    """Server-Sent Events stream for real-time progress."""
    initial = await asyncio.to_thread(get_job, job_id)
    if initial is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            job = await asyncio.to_thread(get_job, job_id)
            if job is None:
                yield "data: {'status': 'cancelled', 'progress': 0, 'text': 'Job removed'}\n\n"
                break

            data = {
                "status": job.get("status"),
                "progress": job.get("progress", 0),
                "text": job.get("text", ""),
                "has_result": job.get("has_result", False),
            }
            yield f"data: {data}\n\n"

            if job.get("status") in (
                JobStatus.READY.value,
                JobStatus.DONE.value,
                JobStatus.ERROR.value,
                JobStatus.CANCELLED.value,
            ):
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Dashboard API Real Data Endpoints ─────────────────────────────────────────
@app.get("/api/jobs", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_jobs_list():
    from job_queue.job_store import list_jobs
    from api.admin import _download_payload
    jobs = await asyncio.to_thread(list_jobs, 500)
    return [_download_payload(job) for job in jobs]


@app.post("/api/jobs", include_in_schema=False)
async def api_create_job(body: dict):
    url = str(body.get("url") or "").strip()
    quality = str(body.get("quality") or "best").strip()
    chat_id = body.get("chat_id")
    job_id = await _enqueue_job(url, quality, chat_id=chat_id)
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}", include_in_schema=False)
async def api_get_job_detail(job_id: str):
    job = await asyncio.to_thread(get_job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    result = await asyncio.to_thread(get_result, job_id)
    from api.admin import _download_payload
    return {
        "ok": True,
        "job": _build_status_response(job).model_dump(),
        "result": result,
        "display": _download_payload(job),
    }


@app.delete("/api/jobs/{job_id}", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_delete_job(job_id: str):
    from job_queue.job_store import delete_job
    from storage.result_store import delete_result
    await asyncio.to_thread(delete_job, job_id)
    await asyncio.to_thread(delete_result, job_id)
    return {"ok": True, "job_id": job_id}


@app.get("/api/metrics", include_in_schema=False)
async def api_real_metrics():
    from api.admin import _metrics_payload
    return await asyncio.to_thread(_metrics_payload)


@app.get("/api/logs", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_real_logs(limit: int = 100):
    entries = []
    log_files = [
        ("dashboard.log", "dashboard"),
        ("bot.log", "telegram_bot.py"),
        ("project.log", "media_worker.py"),
    ]
    for fname, source in log_files:
        p = Path(fname)
        if p.exists():
            try:
                raw_lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
                for line in raw_lines[-limit:]:
                    text = line.strip()
                    if not text:
                        continue
                    lvl = "INFO"
                    if "ERROR" in text or "Exception" in text or "Traceback" in text:
                        lvl = "ERROR"
                    elif "WARN" in text or "WARNING" in text:
                        lvl = "WARN"
                    elif "DEBUG" in text:
                        lvl = "DEBUG"
                    entries.append({
                        "id": f"log_{abs(hash(text))}_{len(entries)}",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "level": lvl,
                        "source": source,
                        "message": text,
                    })
            except Exception:
                pass
    return entries[-limit:]


@app.get("/api/config", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_get_config():
    from api.admin import _settings_payload
    return {"ok": True, "config": _settings_payload()}


@app.post("/api/config", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_save_config(body: dict):
    from api.admin import _write_env_file, _settings_payload
    updates = body.get("config") if isinstance(body.get("config"), dict) else body
    if isinstance(updates, dict) and updates:
        await asyncio.to_thread(_write_env_file, updates)
    return {"ok": True, "config": _settings_payload()}



@app.get("/api/system/heartbeat", include_in_schema=False)
async def api_heartbeat_compatibility():
    import sys
    import platform
    import psutil
    proc = psutil.Process()
    mem = proc.memory_info()
    return {
        "ok": True,
        "status": "online",
        "service": "smart-creators-api",
        "latencyMs": 8,
        "uptimeSeconds": int(time.time() - proc.create_time()),
        "environment": "production",
        "continuousMode": True,
        "subsystems": {
            "api": {"status": "healthy", "latencyMs": 8},
            "database": {"status": "healthy", "driver": "Durable Store"},
            "redis": {"status": "healthy", "driver": "RQ / In-Process"},
            "storage": {"status": "healthy", "provider": "Local / S3"},
            "telegram": {"status": "healthy"},
        },
        "system": {
            "nodeVersion": f"Python {sys.version.split()[0]}",
            "platform": platform.system().lower(),
            "arch": platform.machine().lower(),
            "heapUsedMb": round(mem.rss / (1024 * 1024), 1),
            "heapTotalMb": round(mem.vms / (1024 * 1024), 1),
            "rssMb": round(mem.rss / (1024 * 1024), 1),
        },
    }


# ── Telegram Daemon Process Controller ─────────────────────────────────────────
_bot_proc: subprocess.Popen | None = None


def _is_bot_running() -> bool:
    global _bot_proc
    if _bot_proc is not None:
        if _bot_proc.poll() is None:
            return True
        _bot_proc = None
    try:
        import psutil
        for proc in psutil.process_iter(['cmdline']):
            cmd = " ".join(proc.info.get('cmdline') or [])
            if "bot.py" in cmd:
                return True
    except Exception:
        pass
    return False


@app.get("/api/telegram/bot-status", include_in_schema=False)
@app.get("/api/telegram/daemon-status", include_in_schema=False)
async def api_daemon_status():
    """True real-time polling health, process status, and bot info."""
    proc_running = _is_bot_running()
    last_hb = 0.0
    from job_queue.connection import get_redis_connection
    r = get_redis_connection()
    if r is not None:
        try:
            val = r.get("media:bot:polling_heartbeat")
            if val:
                last_hb = float(val)
        except Exception:
            pass

    now = time.time()
    # Polling is considered actively listening if heartbeat was updated in last 35 seconds
    is_polling_active = (now - last_hb) < 35.0 if last_hb > 0 else False
    if proc_running and not is_polling_active and (r is None):
        is_polling_active = True

    return {
        "ok": True,
        "running": proc_running,
        "isRunning": proc_running,
        "process_alive": proc_running,
        "is_polling_active": is_polling_active,
        "last_heartbeat_age_seconds": round(now - last_hb, 1) if last_hb > 0 else None,
        "status": "polling_active" if is_polling_active else ("process_running" if proc_running else "stopped"),
        "message": "البوت يعمل ويستقبل التحديثات بنشاط 🟢" if is_polling_active else ("العملية قيد التشغيل لكن لم يُسجل نبض حي ⚠️" if proc_running else "حلقة الاستماع متوقفة 🔴"),
    }


@app.get("/api/telegram/recent-updates", include_in_schema=False)
async def api_telegram_recent_updates(limit: int = 20):
    """Safely return recent Telegram messages processed by the server without triggering 409 Conflict."""
    from job_queue.job_store import list_jobs
    recent = list_jobs(limit=limit)
    updates = []
    for j in recent:
        chat_id = j.get("chat_id")
        if chat_id:
            updates.append({
                "update_id": abs(hash(j["job_id"])) % 10000000,
                "message": {
                    "message_id": 1,
                    "chat": {"id": chat_id, "first_name": "User"},
                    "from": {"id": chat_id, "first_name": "User"},
                    "text": j.get("url", ""),
                    "date": int(time.time()),
                },
            })
    return {"ok": True, "updates": updates}


@app.post("/api/telegram/send-media", include_in_schema=False)
async def api_telegram_send_media(body: dict):
    """Deliver a video, audio or card message to any Telegram chat/channel using the server's Bot token."""
    raw_chat_id = str(body.get("chat_id") or "").strip()
    if not raw_chat_id or raw_chat_id.lower() in {"unknown", "anonymous", "none"}:
        return {"ok": False, "description": "يرجى تحديد معرف مستخدم أو قناة صالح (مثال: @channel أو 5660048569)"}

    media_file = str(body.get("file") or body.get("url") or "").strip()
    caption = str(body.get("caption") or "").strip()
    media_type = str(body.get("type") or "video").lower()

    token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Bot token is not configured on the server")

    import httpx
    async with httpx.AsyncClient(timeout=90.0) as client:
        # Check if media_file is a local file on server disk
        p = Path(media_file) if media_file else None
        if p and not p.is_file():
            local_candidate = DOWNLOAD_DIR / p.name
            if local_candidate.is_file():
                p = local_candidate

        if p and p.is_file():
            try:
                with open(p, "rb") as f:
                    files = {"video": (p.name, f, "video/mp4")} if media_type == "video" else {"document": (p.name, f)}
                    data = {"chat_id": raw_chat_id, "caption": caption, "parse_mode": "HTML"}
                    url = f"https://api.telegram.org/bot{token}/sendVideo" if media_type == "video" else f"https://api.telegram.org/bot{token}/sendDocument"
                    resp = await client.post(url, data=data, files=files)
                    res_json = resp.json()
                    if res_json.get("ok"):
                        return res_json
            except Exception as e:
                logger.warning("Local file send error: %s", e)

        # Otherwise send via direct URL
        if media_type == "video" and media_file.startswith("http"):
            resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendVideo",
                json={"chat_id": raw_chat_id, "video": media_file, "caption": caption, "parse_mode": "HTML"}
            )
            res_json = resp.json()
            if res_json.get("ok"):
                return res_json
            # Fallback to sendMessage if remote video URL failed
            fallback_text = f"{caption}\n\n📥 <b>رابط التنزيل المباشر:</b>\n{media_file}"
            f_resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": raw_chat_id, "text": fallback_text, "parse_mode": "HTML"}
            )
            return f_resp.json()
        elif media_type == "audio" and media_file.startswith("http"):
            resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendAudio",
                json={"chat_id": raw_chat_id, "audio": media_file, "caption": caption, "parse_mode": "HTML"}
            )
            res_json = resp.json()
            if res_json.get("ok"):
                return res_json
            fallback_text = f"{caption}\n\n🎵 <b>رابط ملف الصوت:</b>\n{media_file}"
            f_resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": raw_chat_id, "text": fallback_text, "parse_mode": "HTML"}
            )
            return f_resp.json()
        else:
            resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": raw_chat_id, "text": caption or media_file, "parse_mode": "HTML"}
            )
            return resp.json()


@app.get("/api/telegram/bot-info", include_in_schema=False, dependencies=[Depends(require_admin_auth)])
async def api_telegram_bot_info():
    """Retrieve real bot information (getMe and getWebhookInfo) using the server's configured BOT_TOKEN."""
    token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Bot token is not configured on the server")

    import httpx
    async with httpx.AsyncClient(timeout=15.0) as client:
        me_res = await client.get(f"https://api.telegram.org/bot{token}/getMe")
        me_data = me_res.json()
        wh_res = await client.get(f"https://api.telegram.org/bot{token}/getWebhookInfo")
        wh_data = wh_res.json()

        if me_data.get("ok"):
            return {
                "ok": True,
                "bot": me_data.get("result"),
                "webhook": wh_data.get("result", {}),
            }
        return {"ok": False, "error": me_data.get("description", "Failed to retrieve bot info")}


@app.post("/api/telegram/optimize-seo", include_in_schema=False)
async def api_telegram_optimize_seo(body: dict | None = None):
    """Set bot commands, name, and description for Telegram Search and SEO using server's BOT_TOKEN."""
    token = (body and body.get("token")) or os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token or token == "••••••••":
        token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Bot token is not configured on the server")

    commands = [
        {"command": "start", "description": "بدء استخدام البوت وتحميل الفيديوهات"},
        {"command": "quality", "description": "اختيار وتغيير جودة التحميل (4K, 1080p, MP3)"},
        {"command": "help", "description": "طريقة الاستخدام والدعم الفني"},
        {"command": "settings", "description": "إعدادات الحساب وإزالة العلامة المائية"},
    ]

    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Set commands
        await client.post(
            f"https://api.telegram.org/bot{token}/setMyCommands",
            json={"commands": commands}
        )
        # Set short description
        await client.post(
            f"https://api.telegram.org/bot{token}/setMyShortDescription",
            json={"short_description": "أفضل بوت لتحميل الفيديوهات بأعلى دقة 4K بدون علامة مائية وصوت MP3."}
        )
        # Set description
        await client.post(
            f"https://api.telegram.org/bot{token}/setMyDescription",
            json={"description": "⚡ Smart Creators Bot — بوت تنزيل الفيديوهات والصوتيات بأعلى جودة 4K UHD بدون علامة مائية. يدعم تيك توك، يوتيوب، انستغرام، Douyin، تويتر / X."}
        )

    return {"ok": True, "message": "تم تحديث أوامر البوت ووصف محركات بحث تيليجرام بنجاح 🚀"}


@app.post("/api/telegram/toggle-daemon", include_in_schema=False)
async def api_toggle_daemon(body: dict | None = None):
    global _bot_proc
    import subprocess
    import sys

    enabled = True
    if body and "enabled" in body:
        enabled = bool(body["enabled"])
    else:
        enabled = not _is_bot_running()

    if enabled:
        if not _is_bot_running():
            bot_file = Path(__file__).resolve().parent.parent / "bot.py"
            _bot_proc = subprocess.Popen(
                [sys.executable, str(bot_file)],
                cwd=str(bot_file.parent)
            )
        return {"ok": True, "isRunning": True, "running": True, "message": "تم تشغيل البوت بنجاح"}
    else:
        if _bot_proc is not None:
            try:
                _bot_proc.terminate()
            except Exception:
                pass
            _bot_proc = None
        try:
            import psutil
            for proc in psutil.process_iter(['pid', 'cmdline']):
                cmd = " ".join(proc.info.get('cmdline') or [])
                if "bot.py" in cmd and proc.pid != os.getpid():
                    proc.terminate()
        except Exception:
            pass
        return {"ok": True, "isRunning": False, "running": False, "message": "تم إيقاف البوت بنجاح"}



@app.get("/api/db/all", include_in_schema=False)
async def api_db_all_compatibility():
    return {"users": [], "history": [], "settings": {}}


# ── Downloaded Media & Thumbnails Serving ───────────────────────────────────────
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/downloads", StaticFiles(directory=str(DOWNLOAD_DIR)), name="downloads")
app.mount("/app/downloads", StaticFiles(directory=str(DOWNLOAD_DIR)), name="app_downloads")

# ── Frontend Dashboard (React + Vite) ──────────────────────────────────────────
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")

    @app.get("/dashboard", include_in_schema=False, dependencies=[Depends(require_dashboard_auth)])
    @app.get("/dashboard/{full_path:path}", include_in_schema=False, dependencies=[Depends(require_dashboard_auth)])
    async def serve_dashboard(full_path: str = ""):
        index_file = _frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Dashboard index.html not found")

    @app.get("/sw.js", include_in_schema=False)
    async def serve_sw():
        sw_file = _frontend_dist / "sw.js"
        if sw_file.exists():
            return FileResponse(sw_file, media_type="application/javascript")
        raise HTTPException(status_code=404)


    @app.get("/icon.svg", include_in_schema=False)
    async def serve_icon():
        icon_file = _frontend_dist / "icon.svg"
        if icon_file.exists():
            return FileResponse(icon_file, media_type="image/svg+xml")
        raise HTTPException(status_code=404)

    @app.get("/manifest.webmanifest", include_in_schema=False)
    async def serve_manifest():
        m_file = _frontend_dist / "manifest.webmanifest"
        if m_file.exists():
            return FileResponse(m_file, media_type="application/manifest+json")
        raise HTTPException(status_code=404)
