from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psutil
from fastapi import APIRouter, Depends, Header, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict

from core.config import DOWNLOAD_DIR
from core.flow_log import list_flow_events
from job_queue.connection import get_redis_connection, is_redis_available
from job_queue.job_store import JobStatus, create_job, delete_job, get_job, list_jobs, update_job
from job_queue.queue import enqueue_download
from storage.result_store import delete_result

logger = logging.getLogger("api.admin")

router = APIRouter(prefix="/api/v1", tags=["admin"])
# This router intentionally has no prefix. api.server includes it before legacy
# compatibility endpoints, so hardened dashboard routes registered here win.
ws_router = APIRouter(tags=["admin-websocket"])

_STARTED_MONOTONIC = time.monotonic()
_ENV_PATH = Path(os.getenv("ENV_FILE_PATH", ".env")).resolve()

_ALLOWED_ENV_KEYS = {
    "BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "DOWNLOAD_API_URL",
    "HTTP_TIMEOUT_SECONDS",
    "MAX_CONCURRENT_DOWNLOADS",
    "CACHE_TTL_SECONDS",
    "LOG_LEVEL",
    "REDIS_URL",
    "WEBHOOK_MODE",
    "ALLOWED_ORIGINS",
}
_SECRET_ENV_KEYS = {"BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "REDIS_URL", "ADMIN_API_TOKEN"}
_SECRET_MASK = "••••••••"


class EnvSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    BOT_TOKEN: str = ""
    DOWNLOAD_API_URL: str = ""
    HTTP_TIMEOUT_SECONDS: int = 300
    MAX_CONCURRENT_DOWNLOADS: int = 3
    CACHE_TTL_SECONDS: int = 3600
    LOG_LEVEL: str = "INFO"
    REDIS_URL: str = ""
    WEBHOOK_MODE: bool = False


def _admin_token() -> str:
    return os.getenv("ADMIN_API_TOKEN", "").strip()


def _extract_bearer(value: str | None) -> str:
    if not value:
        return ""
    scheme, _, token = value.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token.strip()
    return ""


def _basic_credentials(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    scheme, _, encoded = value.partition(" ")
    if scheme.lower() != "basic" or not encoded:
        return None
    try:
        decoded = base64.b64decode(encoded.strip()).decode("utf-8")
        username, password = decoded.split(":", 1)
        return username, password
    except Exception:
        return None


def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> None:
    expected_token = _admin_token()
    expected_user = os.getenv("DASHBOARD_USERNAME", "admin").strip()
    expected_pass = os.getenv("DASHBOARD_PASSWORD", "").strip() or expected_token

    if not expected_token and not expected_pass:
        logger.warning("Dashboard authentication is not configured")
        return

    if x_admin_token and expected_token and hmac.compare_digest(x_admin_token.strip(), expected_token):
        return

    bearer = _extract_bearer(authorization)
    if bearer and (
        (expected_token and hmac.compare_digest(bearer, expected_token))
        or (expected_pass and hmac.compare_digest(bearer, expected_pass))
    ):
        return

    basic = _basic_credentials(authorization)
    if basic is not None:
        username, password = basic
        if hmac.compare_digest(username, expected_user) and expected_pass and hmac.compare_digest(password, expected_pass):
            return

    raise HTTPException(status_code=401, detail="Invalid or missing admin credentials")


async def _authorize_websocket(websocket: WebSocket) -> bool:
    expected = _admin_token()
    if not expected:
        await websocket.accept()
        return True

    supplied = (
        websocket.query_params.get("token", "").strip()
        or _extract_bearer(websocket.headers.get("authorization"))
    )
    if not hmac.compare_digest(supplied, expected):
        await websocket.close(code=4401, reason="Unauthorized")
        return False

    await websocket.accept()
    return True


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _duration_text(job: dict[str, Any]) -> str:
    start = _parse_iso(job.get("started_at")) or _parse_iso(job.get("created_at"))
    end = _parse_iso(job.get("completed_at")) or datetime.now(timezone.utc)
    if start is None:
        return "—"
    seconds = max(0, int((end - start).total_seconds()))
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minute}m"
    if minutes:
        return f"{minutes}m {sec}s"
    return f"{sec}s"


def _platform_for_url(value: str) -> str:
    """Classify the source domain without guessing unknown hosts as Twitter."""
    host = (urlparse(value).hostname or "").lower().removeprefix("www.")
    if not host:
        return "Unknown"
    if host == "xhslink.com" or host.endswith(".xhslink.com") or "xiaohongshu" in host:
        return "Xiaohongshu"
    if "tiktok" in host:
        return "TikTok"
    if "douyin" in host:
        return "Douyin"
    if "instagram" in host:
        return "Instagram"
    if "youtu" in host:
        return "YouTube"
    if host == "x.com" or host.endswith(".x.com") or "twitter" in host:
        return "Twitter"
    if "facebook" in host or host == "fb.watch" or host.endswith(".fb.watch"):
        return "Facebook"
    if "pinterest" in host or host == "pin.it" or host.endswith(".pin.it"):
        return "Pinterest"
    if "threads" in host:
        return "Threads"
    if "bilibili" in host or host == "b23.tv" or host.endswith(".b23.tv"):
        return "Bilibili"
    if "likee" in host:
        return "Likee"
    return "Other"


def _dashboard_status(raw: str) -> str:
    return {
        JobStatus.QUEUED.value: "queued",
        JobStatus.RUNNING.value: "downloading",
        JobStatus.READY.value: "completed",
        JobStatus.DONE.value: "completed",
        JobStatus.ERROR.value: "failed",
        JobStatus.CANCELLED.value: "failed",
    }.get(raw, "failed")


def _download_payload(job: dict[str, Any]) -> dict[str, Any]:
    job_id = str(job.get("job_id", ""))
    chat_id = job.get("chat_id")
    status = _dashboard_status(str(job.get("status", "")))
    payload = {
        "id": job_id,
        "job_id": job_id,
        "url": str(job.get("url", "")),
        "platform": _platform_for_url(str(job.get("url", ""))),
        "status": status,
        "progress": round(float(job.get("progress", 0.0) or 0.0), 1),
        "duration": _duration_text(job),
        "user": str(chat_id) if chat_id is not None else "unknown",
        "startedAt": str(job.get("started_at") or job.get("created_at") or ""),
    }
    if status == "completed":
        from storage.result_store import get_result
        try:
            res = get_result(job_id)
            if res:
                payload["file"] = res.get("file")
                payload["thumbnail"] = res.get("thumbnail")
                if res.get("width") and res.get("height"):
                    payload["resolution_label"] = f"{res.get('width')}x{res.get('height')}"
                if res.get("duration"):
                    payload["duration"] = f"{int(float(res['duration']))}s"
        except Exception:
            pass
    return payload


def _metrics_payload() -> dict[str, Any]:
    jobs = list_jobs(limit=1000)
    running = [j for j in jobs if j.get("status") == JobStatus.RUNNING.value]
    today = datetime.now(timezone.utc).date()
    jobs_today = [
        j for j in jobs
        if (_parse_iso(j.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)).date() == today
    ]
    completed = [j for j in jobs_today if j.get("status") == JobStatus.DONE.value]
    failed = [j for j in jobs_today if j.get("status") == JobStatus.ERROR.value]
    finished_count = len(completed) + len(failed)
    success_rate = (len(completed) / finished_count * 100.0) if finished_count else 0.0

    ram = psutil.virtual_memory()
    disk = psutil.disk_usage(str(DOWNLOAD_DIR.resolve()))
    users = {str(j.get("chat_id")) for j in jobs_today if j.get("chat_id") is not None}

    return {
        "cpu": round(psutil.cpu_percent(interval=None), 1),
        "ram": round(ram.percent, 1),
        "disk": round(disk.percent, 1),
        "downloads": len(running),
        "uptimeSeconds": int(time.monotonic() - _STARTED_MONOTONIC),
        "activeUsers": len(users),
        "downloadsToday": len(jobs_today),
        "successRate": round(success_rate, 1),
        "ramTotalGb": round(ram.total / (1024**3), 2),
        "diskTotalGb": round(disk.total / (1024**3), 2),
        "queueBackend": "redis" if is_redis_available() else "memory",
    }


def _read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if not _ENV_PATH.exists():
        return values
    for raw in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            values[key] = value.strip().strip('"').strip("'")
    return values


def _serialize_env_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if not text:
        return ""
    if any(ch.isspace() for ch in text) or any(ch in text for ch in '#"\''):
        return json.dumps(text, ensure_ascii=False)
    return text


def _write_env_file(updates: dict[str, Any]) -> None:
    existing_lines = (
        _ENV_PATH.read_text(encoding="utf-8").splitlines()
        if _ENV_PATH.exists()
        else []
    )
    rendered: list[str] = []
    seen: set[str] = set()

    for raw in existing_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw:
            rendered.append(raw)
            continue
        key = raw.split("=", 1)[0].strip()
        if key in updates:
            rendered.append(f"{key}={_serialize_env_value(updates[key])}")
            seen.add(key)
        else:
            rendered.append(raw)

    for key, value in updates.items():
        if key not in seen:
            rendered.append(f"{key}={_serialize_env_value(value)}")

    _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = _ENV_PATH.with_suffix(_ENV_PATH.suffix + ".tmp")
    temporary.write_text("\n".join(rendered).rstrip() + "\n", encoding="utf-8")
    temporary.replace(_ENV_PATH)


def _settings_payload() -> dict[str, Any]:
    file_values = _read_env_file()

    def get_value(key: str, default: Any = "") -> Any:
        return os.getenv(key, file_values.get(key, str(default)))

    def to_int(value: Any, default: int) -> int:
        try:
            return int(str(value))
        except (TypeError, ValueError):
            return default

    def to_bool(value: Any) -> bool:
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    result: dict[str, Any] = {
        "BOT_TOKEN": get_value("BOT_TOKEN") or get_value("TELEGRAM_BOT_TOKEN"),
        "DOWNLOAD_API_URL": get_value("DOWNLOAD_API_URL"),
        "HTTP_TIMEOUT_SECONDS": to_int(get_value("HTTP_TIMEOUT_SECONDS", 300), 300),
        "MAX_CONCURRENT_DOWNLOADS": to_int(get_value("MAX_CONCURRENT_DOWNLOADS", 3), 3),
        "CACHE_TTL_SECONDS": to_int(get_value("CACHE_TTL_SECONDS", 3600), 3600),
        "LOG_LEVEL": str(get_value("LOG_LEVEL", "INFO")).upper(),
        "REDIS_URL": get_value("REDIS_URL"),
        "WEBHOOK_MODE": to_bool(get_value("WEBHOOK_MODE", False)),
    }

    for key in ("BOT_TOKEN", "REDIS_URL"):
        if result.get(key):
            result[key] = _SECRET_MASK
    return result


def _stop_rq_job(job_id: str) -> None:
    connection = get_redis_connection()
    if connection is None:
        return

    try:
        from rq.command import send_stop_job_command
        send_stop_job_command(connection, job_id)
    except Exception:
        logger.debug("RQ stop command was not applicable for %s", job_id, exc_info=True)

    try:
        from rq.job import Job
        rq_job = Job.fetch(job_id, connection=connection)
        try:
            rq_job.cancel()
        except Exception:
            logger.debug("RQ cancel was not applicable for %s", job_id, exc_info=True)
        rq_job.delete()
    except Exception:
        logger.debug("RQ job %s was already absent", job_id, exc_info=True)


@router.get("/health")
async def admin_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "3.3.0",
        "engine": "media-engine",
        "queue": "redis" if is_redis_available() else "in-process-fallback",
        "result_store": "redis" if is_redis_available() else "memory",
        "adminApi": True,
    }


@router.get("/metrics")
async def get_metrics() -> dict[str, Any]:
    return await asyncio.to_thread(_metrics_payload)


@router.get("/flow-logs", dependencies=[Depends(require_admin)])
async def get_flow_logs(limit: int = 200) -> list[dict[str, Any]]:
    return await asyncio.to_thread(list_flow_events, max(1, min(limit, 1000)))


@router.get("/downloads/queue", dependencies=[Depends(require_admin)])
async def get_download_queue() -> list[dict[str, Any]]:
    jobs = await asyncio.to_thread(list_jobs, 500)
    return [_download_payload(job) for job in jobs]


@router.post("/downloads/{job_id}/retry", dependencies=[Depends(require_admin)])
async def retry_download(job_id: str) -> dict[str, Any]:
    job = await asyncio.to_thread(get_job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") in {JobStatus.QUEUED.value, JobStatus.RUNNING.value}:
        raise HTTPException(status_code=409, detail="Job is already active")

    url = str(job.get("url", ""))
    quality = str(job.get("quality", "best"))
    chat_id = job.get("chat_id")

    await asyncio.to_thread(_stop_rq_job, job_id)
    await asyncio.to_thread(delete_result, job_id)
    await asyncio.to_thread(create_job, job_id, url=url, quality=quality, chat_id=chat_id)

    enqueued = await asyncio.to_thread(enqueue_download, job_id, url, quality, chat_id)
    if not enqueued:
        from job_queue.tasks import execute_download
        asyncio.create_task(execute_download(job_id, url, quality, chat_id))

    refreshed = await asyncio.to_thread(get_job, job_id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Failed to recreate job")
    return _download_payload(refreshed)


@router.delete("/downloads/{job_id}", status_code=204, dependencies=[Depends(require_admin)])
async def cancel_download(job_id: str) -> Response:
    job = await asyncio.to_thread(get_job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    await asyncio.to_thread(
        update_job,
        job_id,
        status=JobStatus.CANCELLED.value,
        text="⛔ أُلغي بواسطة لوحة التحكم",
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    await asyncio.to_thread(_stop_rq_job, job_id)
    await asyncio.to_thread(delete_result, job_id)
    await asyncio.to_thread(delete_job, job_id)
    return Response(status_code=204)


@router.get("/settings/env", dependencies=[Depends(require_admin)])
async def get_env_settings() -> dict[str, Any]:
    return await asyncio.to_thread(_settings_payload)


@router.put("/settings/env", dependencies=[Depends(require_admin)])
async def put_env_settings(payload: EnvSettingsPayload) -> dict[str, Any]:
    raw = payload.model_dump(exclude_none=True)
    extras = payload.model_extra or {}
    raw.update(extras)

    existing = _read_env_file()
    sanitized: dict[str, Any] = {}
    for key, value in raw.items():
        if key not in _ALLOWED_ENV_KEYS:
            continue
        if key in _SECRET_ENV_KEYS and value == _SECRET_MASK:
            preserved = os.getenv(key) or existing.get(key)
            if preserved is not None:
                sanitized[key] = preserved
            continue
        sanitized[key] = value

    if "BOT_TOKEN" in sanitized and "TELEGRAM_BOT_TOKEN" not in sanitized:
        sanitized["TELEGRAM_BOT_TOKEN"] = sanitized["BOT_TOKEN"]

    await asyncio.to_thread(_write_env_file, sanitized)
    for key, value in sanitized.items():
        os.environ[key] = _serialize_env_value(value).strip('"')

    logger.warning(
        "Environment settings updated at %s; restart the service for all workers to reload them",
        _ENV_PATH,
    )
    return await asyncio.to_thread(_settings_payload)


# ---------------------------------------------------------------------------
# Hardened compatibility routes. api.server includes ws_router before its old
# dashboard compatibility routes, so these handlers are selected first.
# ---------------------------------------------------------------------------


def _candidate_log_files() -> list[Path]:
    candidates = [
        Path("bot.log"),
        Path("dashboard.log"),
        Path("logs/bot.log"),
        Path("logs/dashboard.log"),
    ]
    return [path for path in candidates if path.exists() and path.is_file()]


def _flow_message(event: dict[str, Any]) -> dict[str, Any]:
    stage = str(event.get("stage") or "FLOW")
    job_id = str(event.get("job_id") or "")
    detail = str(event.get("detail") or "")
    parts = [f"FLOW {stage}"]
    if job_id:
        parts.append(f"job_id={job_id}")
    if detail:
        parts.append(detail)
    return {
        "timestamp": str(event.get("timestamp") or datetime.now(timezone.utc).isoformat()),
        "level": str(event.get("level") or "INFO").upper(),
        "source": f"flow:{event.get('source') or 'system'}",
        "message": " | ".join(parts),
    }


def _dashboard_log_is_noise(text: str) -> bool:
    if "[flow.dashboard] FLOW " in text:
        return True
    routine = (
        '"GET /api/metrics"',
        '"GET /api/config"',
        '"GET /api/jobs"',
        '"GET /api/telegram/bot-status"',
        '"GET /api/telegram/daemon-status"',
        '"GET /api/logs"',
        '"GET /jobs/',
    )
    return any(fragment in text for fragment in routine)


def _local_alert_entries(limit: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in _candidate_log_files():
        try:
            raw_lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for raw in raw_lines[-max(limit * 4, 200):]:
            text = raw.strip()
            if not text or text in seen or _dashboard_log_is_noise(text):
                continue
            # Flow events contain the normal lifecycle. Local logs are retained
            # here only when they carry a warning/error worth diagnosing.
            upper = text.upper()
            if "ERROR" not in upper and "WARNING" not in upper and "WARN" not in upper and "TRACEBACK" not in upper:
                continue
            seen.add(text)
            level = "ERROR" if "ERROR" in upper or "TRACEBACK" in upper else "WARN"
            entries.append({
                "id": f"alert_{abs(hash(text))}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "source": path.name,
                "message": text,
            })
    return entries[-limit:]


@ws_router.get("/api/logs", include_in_schema=False, dependencies=[Depends(require_admin)])
async def api_clean_flow_logs(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 200), 1000))
    flow_events = await asyncio.to_thread(list_flow_events, safe_limit)
    entries: list[dict[str, Any]] = []
    for idx, event in enumerate(flow_events):
        entry = _flow_message(event)
        entry["id"] = f"flow_{idx}_{abs(hash(json.dumps(event, sort_keys=True, ensure_ascii=False)))}"
        entries.append(entry)
    alerts = await asyncio.to_thread(_local_alert_entries, max(20, safe_limit // 4))
    return (entries + alerts)[-safe_limit:]


@ws_router.get("/api/telegram/recent-updates", include_in_schema=False)
async def api_no_legacy_replay() -> dict[str, Any]:
    """The production poller owns Telegram updates; the dashboard must not replay them."""
    return {"ok": True, "updates": [], "source": "production-poller"}


async def _telegram_send_video_file(client: Any, token: str, chat_id: str, path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        response = await client.post(
            f"https://api.telegram.org/bot{token}/sendVideo",
            data={"chat_id": chat_id, "supports_streaming": "true"},
            files={"video": (path.name or "video.mp4", handle, "video/mp4")},
        )
    try:
        return response.json()
    except Exception:
        return {"ok": False, "description": "Invalid Telegram response"}


@ws_router.post("/api/telegram/send-media", include_in_schema=False, dependencies=[Depends(require_admin)])
async def api_telegram_send_video_only(body: dict) -> dict[str, Any]:
    """Dashboard compatibility sender: actual video only, never a report or link fallback."""
    raw_chat_id = str(body.get("chat_id") or "").strip()
    if not raw_chat_id or raw_chat_id.lower() in {"unknown", "anonymous", "none"}:
        return {"ok": False, "description": "حدد وجهة Telegram صالحة"}

    media_type = str(body.get("type") or "video").lower()
    if media_type != "video":
        return {"ok": False, "description": "مسار لوحة التحكم يسمح بإرسال الفيديو فقط"}

    media_file = str(body.get("file") or "").strip()
    if not media_file:
        return {"ok": False, "description": "ملف الفيديو غير متوفر"}

    token = (os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN") or "").strip()
    if not token:
        raise HTTPException(status_code=500, detail="Bot token is not configured on the server")

    import httpx

    timeout = httpx.Timeout(180.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        local_path: Path | None = None
        try:
            candidate = Path(media_file)
            if candidate.is_file():
                local_path = candidate
            else:
                download_candidate = DOWNLOAD_DIR / candidate.name
                if download_candidate.is_file():
                    local_path = download_candidate
        except (OSError, ValueError):
            local_path = None

        if local_path is not None:
            result = await _telegram_send_video_file(client, token, raw_chat_id, local_path)
            if result.get("ok"):
                logger.info("DASHBOARD_TELEGRAM_VIDEO_SENT")
                message = result.get("result") or {}
                return {"ok": True, "delivery": "video", "message_id": message.get("message_id")}
            return {"ok": False, "description": "Telegram rejected video delivery"}

        if not media_file.startswith(("http://", "https://")):
            return {"ok": False, "description": "ملف الفيديو غير قابل للإرسال"}

        direct = await client.post(
            f"https://api.telegram.org/bot{token}/sendVideo",
            json={"chat_id": raw_chat_id, "video": media_file, "supports_streaming": True},
        )
        try:
            direct_result = direct.json()
        except Exception:
            direct_result = {"ok": False}
        if direct_result.get("ok"):
            logger.info("DASHBOARD_TELEGRAM_VIDEO_SENT")
            message = direct_result.get("result") or {}
            return {"ok": True, "delivery": "video", "message_id": message.get("message_id")}

        # If Telegram cannot fetch the signed URL itself, materialize it and
        # upload the actual bytes. Never fall back to sendMessage or a link card.
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix="dashboard-video-", suffix=".mp4", delete=False) as temp:
                temp_path = Path(temp.name)
                async with client.stream("GET", media_file) as upstream:
                    upstream.raise_for_status()
                    async for chunk in upstream.aiter_bytes(1024 * 1024):
                        if chunk:
                            temp.write(chunk)
            uploaded = await _telegram_send_video_file(client, token, raw_chat_id, temp_path)
            if uploaded.get("ok"):
                logger.info("DASHBOARD_TELEGRAM_VIDEO_SENT materialized=true")
                message = uploaded.get("result") or {}
                return {"ok": True, "delivery": "video", "message_id": message.get("message_id")}
            return {"ok": False, "description": "Telegram rejected uploaded video"}
        except Exception as exc:
            logger.warning("DASHBOARD_TELEGRAM_VIDEO_FAILED error_type=%s", type(exc).__name__)
            return {"ok": False, "description": "تعذر إرسال الفيديو الفعلي"}
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)


async def _metrics_socket(websocket: WebSocket) -> None:
    if not await _authorize_websocket(websocket):
        return
    try:
        while True:
            payload = await asyncio.to_thread(_metrics_payload)
            await websocket.send_json(payload)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Metrics WebSocket failed")
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass


@ws_router.websocket("/ws/metrics")
@ws_router.websocket("/api/v1/ws/metrics")
async def metrics_websocket(websocket: WebSocket) -> None:
    await _metrics_socket(websocket)


async def _logs_socket(websocket: WebSocket) -> None:
    if not await _authorize_websocket(websocket):
        return

    offsets: dict[Path, int] = {}
    for path in _candidate_log_files():
        try:
            offsets[path] = max(0, path.stat().st_size - 64_000)
        except OSError:
            offsets[path] = 0

    seen_flow: set[str] = set()
    initial_flow = await asyncio.to_thread(list_flow_events, 100)
    for event in initial_flow:
        signature = json.dumps(event, sort_keys=True, ensure_ascii=False)
        seen_flow.add(signature)
        await websocket.send_json(_flow_message(event))

    await websocket.send_json({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": "INFO",
        "source": "flow:system",
        "message": "FLOW DASHBOARD_CONNECTED",
    })

    try:
        heartbeat_at = time.monotonic()
        while True:
            found_line = False

            flow_events = await asyncio.to_thread(list_flow_events, 200)
            for event in flow_events:
                signature = json.dumps(event, sort_keys=True, ensure_ascii=False)
                if signature in seen_flow:
                    continue
                seen_flow.add(signature)
                found_line = True
                await websocket.send_json(_flow_message(event))
            if len(seen_flow) > 2000:
                seen_flow = {
                    json.dumps(event, sort_keys=True, ensure_ascii=False)
                    for event in flow_events
                }

            for path in _candidate_log_files():
                offset = offsets.get(path, 0)
                try:
                    with path.open("r", encoding="utf-8", errors="replace") as handle:
                        handle.seek(offset)
                        for line in handle:
                            text = line.rstrip()
                            upper = text.upper()
                            if _dashboard_log_is_noise(text):
                                continue
                            if "ERROR" not in upper and "WARNING" not in upper and "WARN" not in upper and "TRACEBACK" not in upper:
                                continue
                            found_line = True
                            level = "ERROR" if "ERROR" in upper or "TRACEBACK" in upper else "WARN"
                            await websocket.send_json({
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "level": level,
                                "source": path.name,
                                "message": text,
                            })
                        offsets[path] = handle.tell()
                except OSError:
                    continue

            if not found_line and time.monotonic() - heartbeat_at >= 15:
                await websocket.send_json({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "level": "DEBUG",
                    "source": "flow:system",
                    "message": "FLOW_HEARTBEAT | waiting_for_activity",
                })
                heartbeat_at = time.monotonic()
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Logs WebSocket failed")
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass


@ws_router.websocket("/ws/logs")
@ws_router.websocket("/api/v1/ws/logs")
async def logs_websocket(websocket: WebSocket) -> None:
    await _logs_socket(websocket)
