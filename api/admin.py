from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psutil
from fastapi import APIRouter, Depends, Header, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict

from core.config import DOWNLOAD_DIR
from job_queue.connection import get_redis_connection, is_redis_available
from job_queue.job_store import JobStatus, create_job, delete_job, get_job, list_jobs, update_job
from job_queue.queue import enqueue_download
from storage.result_store import delete_result

logger = logging.getLogger("api.admin")

router = APIRouter(prefix="/api/v1", tags=["admin"])
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
    """Known dashboard-editable environment values.

    Extra keys are accepted for forward compatibility, but are discarded unless
    explicitly included in _ALLOWED_ENV_KEYS.
    """

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
    return value.strip()


def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> None:
    """Require a configured shared token for sensitive routes.

    For backward compatibility, deployments without ADMIN_API_TOKEN remain
    accessible but emit a warning. Configure ADMIN_API_TOKEN in production.
    """

    expected = _admin_token()
    if not expected:
        logger.warning(
            "ADMIN_API_TOKEN is not configured; sensitive admin endpoints are unprotected"
        )
        return

    provided = _extract_bearer(authorization) or (x_admin_token or "").strip()
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")


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
    host = (urlparse(value).hostname or "").lower()
    if "tiktok" in host:
        return "TikTok"
    if "douyin" in host:
        return "Douyin"
    if "instagram" in host:
        return "Instagram"
    if "youtu" in host:
        return "YouTube"
    if "twitter" in host or host.endswith("x.com"):
        return "Twitter"
    return "Twitter"


def _dashboard_status(raw: str) -> str:
    return {
        JobStatus.QUEUED.value: "queued",
        JobStatus.RUNNING.value: "downloading",
        JobStatus.DONE.value: "completed",
        JobStatus.ERROR.value: "failed",
        JobStatus.CANCELLED.value: "failed",
    }.get(raw, "failed")


def _download_payload(job: dict[str, Any]) -> dict[str, Any]:
    chat_id = job.get("chat_id")
    return {
        "id": str(job.get("job_id", "")),
        "url": str(job.get("url", "")),
        "platform": _platform_for_url(str(job.get("url", ""))),
        "status": _dashboard_status(str(job.get("status", ""))),
        "progress": round(float(job.get("progress", 0.0) or 0.0), 1),
        "duration": _duration_text(job),
        "user": str(chat_id) if chat_id is not None else "unknown",
        "startedAt": str(job.get("started_at") or job.get("created_at") or ""),
    }


def _metrics_payload() -> dict[str, Any]:
    jobs = list_jobs(limit=1000)
    running = [j for j in jobs if j.get("status") == JobStatus.RUNNING.value]
    today = datetime.now(timezone.utc).date()
    jobs_today = [j for j in jobs if (_parse_iso(j.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)).date() == today]
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
    await asyncio.to_thread(
        create_job,
        job_id,
        url=url,
        quality=quality,
        chat_id=chat_id,
    )

    enqueued = await asyncio.to_thread(
        enqueue_download,
        job_id,
        url,
        quality,
        chat_id,
    )
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


def _candidate_log_files() -> list[Path]:
    candidates = [
        Path("bot.log"),
        Path("dashboard.log"),
        Path("logs/bot.log"),
        Path("logs/dashboard.log"),
    ]
    return [path for path in candidates if path.exists() and path.is_file()]


async def _logs_socket(websocket: WebSocket) -> None:
    if not await _authorize_websocket(websocket):
        return

    offsets: dict[Path, int] = {}
    for path in _candidate_log_files():
        try:
            offsets[path] = max(0, path.stat().st_size - 64_000)
        except OSError:
            offsets[path] = 0

    await websocket.send_json(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": "INFO",
            "source": "dashboard.log",
            "message": "Admin log WebSocket connected",
        }
    )

    try:
        heartbeat_at = time.monotonic()
        while True:
            found_line = False
            for path in _candidate_log_files():
                offset = offsets.get(path, 0)
                try:
                    with path.open("r", encoding="utf-8", errors="replace") as handle:
                        handle.seek(offset)
                        for line in handle:
                            found_line = True
                            text = line.rstrip()
                            level = "ERROR" if "ERROR" in text else "WARN" if "WARN" in text or "WARNING" in text else "DEBUG" if "DEBUG" in text else "INFO"
                            await websocket.send_json(
                                {
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "level": level,
                                    "source": path.name,
                                    "message": text,
                                }
                            )
                        offsets[path] = handle.tell()
                except OSError:
                    continue

            if not found_line and time.monotonic() - heartbeat_at >= 15:
                await websocket.send_json(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "level": "DEBUG",
                        "source": "dashboard.log",
                        "message": "log-stream heartbeat",
                    }
                )
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
