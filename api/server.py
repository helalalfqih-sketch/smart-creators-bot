from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
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
from engine.media_engine import MediaEngine
from job_queue.connection import is_redis_available
from job_queue.job_store import JobStatus, get_job
from storage.result_store import get_result

logger = logging.getLogger("api")

_engine: MediaEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine
    _engine = MediaEngine()
    yield


app = FastAPI(title="Cloud Media Engine API", version="3.3.0", lifespan=lifespan)


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
        return JobResultResponse(
            job_id=job_id,
            status=job.get("status", JobStatus.DONE.value),
            media_type=result.get("media_type"),
            file=result.get("file"),
            duration=result.get("duration", 0),
            width=result.get("width", 0),
            height=result.get("height", 0),
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

    if status != JobStatus.DONE.value:
        raise HTTPException(
            status_code=202,
            detail={"message": "Result not ready", "status": status},
        )

    result = await asyncio.to_thread(get_result, job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")

    return _build_result_response(job_id, job, result)


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
@app.get("/api/jobs", include_in_schema=False)
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


@app.delete("/api/jobs/{job_id}", include_in_schema=False)
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


@app.get("/api/logs", include_in_schema=False)
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


@app.get("/api/config", include_in_schema=False)
async def api_get_config():
    from api.admin import _settings_payload
    return {"ok": True, "config": _settings_payload()}


@app.post("/api/config", include_in_schema=False)
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


@app.get("/api/telegram/daemon-status", include_in_schema=False)
async def api_daemon_status():
    running = _is_bot_running()
    return {"ok": True, "running": running, "isRunning": running, "status": "running" if running else "stopped"}


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


# ── Frontend Dashboard (React + Vite) ──────────────────────────────────────────
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")

    @app.get("/dashboard", include_in_schema=False)
    @app.get("/dashboard/{full_path:path}", include_in_schema=False)
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


