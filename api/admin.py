from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psutil
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, WebSocket
from pydantic import BaseModel

from engine.media_engine import MediaEngine
from job_queue.connection import get_redis_connection, is_redis_available
from job_queue.job_store import JobStatus, delete_job, get_job, list_jobs
from storage.result_store import delete_result

logger = logging.getLogger("api.admin")
router = APIRouter()

_PROCESS = psutil.Process()
_PROCESS_STARTED_AT = _PROCESS.create_time()
_ENGINE = MediaEngine()
_MASKED_SECRET = "********"
_ENV_PATH = Path(os.getenv("ENV_FILE", ".env"))

_EDITABLE_ENV: dict[str, tuple[str, Any]] = {
    "BOT_TOKEN": ("str", ""),
    "DOWNLOAD_API_URL": ("str", "http://127.0.0.1:8000"),
    "HTTP_TIMEOUT_SECONDS": ("int", 300),
    "MAX_CONCURRENT_DOWNLOADS": ("int", 3),
    "CACHE_TTL_SECONDS": ("int", 3600),
    "LOG_LEVEL": ("str", "INFO"),
    "REDIS_URL": ("str", "redis://localhost:6379/0"),
    "WEBHOOK_MODE": ("bool", False),
}
_SECRET_ENV_KEYS = {"BOT_TOKEN", "REDIS_URL"}
_LOG_FILES = (Path("bot.log"), Path("dashboard.log"), Path("api.log"))

_LOG_BUFFER: deque[dict[str, Any]] = deque(maxlen=500)
_LOG_SEQUENCE = 0


class EnvUpdate(BaseModel):
    BOT_TOKEN: str | None = None
    DOWNLOAD_API_URL: str | None = None
    HTTP_TIMEOUT_SECONDS: int | None = None
    MAX_CONCURRENT_DOWNLOADS: int | None = None
    CACHE_TTL_SECONDS: int | None = None
    LOG_LEVEL: str | None = None
    REDIS_URL: str | None = None
    WEBHOOK_MODE: bool | None = None


class _AdminLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        global _LOG_SEQUENCE
        try:
            _LOG_SEQUENCE += 1
            level = record.levelname.upper()
            if level == "WARNING":
                level = "WARN"
            _LOG_BUFFER.append(
                {
                    "id": f"mem-{_LOG_SEQUENCE}",
                    "timestamp": datetime.fromtimestamp(
                        record.created, timezone.utc
                    ).isoformat(),
                    "level": level,
                    "source": record.name or "api",
                    "message": record.getMessage(),
                }
            )
        except Exception:
            self.handleError(record)


def _install_log_handler() -> None:
    root = logging.getLogger()
    if any(isinstance(handler, _AdminLogHandler) for handler in root.handlers):
        return
    handler = _AdminLogHandler()
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)


_install_log_handler()


def _admin_token() -> str:
    return os.getenv("ADMIN_API_TOKEN", "").strip()


def _token_is_valid(candidate: str | None) -> bool:
    expected = _admin_token()
    return bool(expected and candidate and secrets.compare_digest(candidate, expected))


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if not _admin_token():
        raise HTTPException(
            status_code=503,
            detail="ADMIN_API_TOKEN is not configured on the server",
        )
    if not _token_is_valid(x_admin_token):
        raise HTTPException(status_code=401, detail="Invalid admin token")


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _format_duration(job: dict[str, Any]) -> str:
    started = _parse_iso(job.get("started_at")) or _parse_iso(job.get("created_at"))
    ended = (
        _parse_iso(job.get("completed_at"))
        or _parse_iso(job.get("updated_at"))
        or datetime.now(timezone.utc)
    )
    if started is None:
        return "—"
    seconds = max(0, int((ended - started).total_seconds()))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _platform_from_url(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        host = ""
    if "tiktok" in host:
        return "TikTok"
    if "douyin" in host:
        return "Douyin"
    if "instagram" in host:
        return "Instagram"
    if "youtube" in host or "youtu.be" in host:
        return "YouTube"
    if "twitter" in host or host == "x.com" or host.endswith(".x.com"):
        return "Twitter"
    return "Other"


def _ui_status(value: str) -> str:
    return {
        JobStatus.QUEUED.value: "queued",
        JobStatus.RUNNING.value: "downloading",
        JobStatus.DONE.value: "completed",
        JobStatus.ERROR.value: "failed",
    }.get(value, "failed")


def _download_payload(job: dict[str, Any]) -> dict[str, Any]:
    chat_id = job.get("chat_id")
    return {
        "id": str(job.get("job_id", "")),
        "url": str(job.get("url", "")),
        "platform": _platform_from_url(str(job.get("url", ""))),
        "status": _ui_status(str(job.get("status", ""))),
        "progress": round(float(job.get("progress", 0.0) or 0.0), 1),
        "duration": _format_duration(job),
        "user": str(chat_id) if chat_id is not None else "system",
        "startedAt": str(job.get("started_at") or job.get("created_at") or ""),
    }


def _collect_metrics() -> dict[str, Any]:
    jobs = list_jobs(limit=1000)
    now = datetime.now(timezone.utc)
    today = now.date()

    active = [
        job
        for job in jobs
        if job.get("status") in {JobStatus.QUEUED.value, JobStatus.RUNNING.value}
    ]
    today_jobs = [
        job
        for job in jobs
        if (_parse_iso(job.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)).date()
        == today
    ]
    terminal_today = [
        job
        for job in today_jobs
        if job.get("status") in {JobStatus.DONE.value, JobStatus.ERROR.value}
    ]
    successful_today = [
        job for job in terminal_today if job.get("status") == JobStatus.DONE.value
    ]
    active_users = {
        str(job["chat_id"])
        for job in today_jobs
        if job.get("chat_id") is not None
    }

    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(Path.cwd()))
    success_rate = (
        (len(successful_today) / len(terminal_today)) * 100.0
        if terminal_today
        else 100.0
    )

    return {
        "cpu": round(psutil.cpu_percent(interval=None), 1),
        "ram": round(memory.percent, 1),
        "disk": round(disk.percent, 1),
        "downloads": len(active),
        "uptimeSeconds": max(0, int(time.time() - _PROCESS_STARTED_AT)),
        "activeUsers": len(active_users),
        "downloadsToday": len(today_jobs),
        "successRate": round(success_rate, 1),
        "ramTotalGb": round(memory.total / (1024**3), 2),
        "diskTotalGb": round(disk.total / (1024**3), 2),
    }


def _load_env_file() -> dict[str, str]:
    if not _ENV_PATH.exists():
        return {}
    values: dict[str, str] = {}
    for raw in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _coerce_env_value(kind: str, value: Any, default: Any) -> Any:
    if value is None:
        return default
    if kind == "int":
        try:
            return int(value)
        except (TypeError, ValueError):
            return int(default)
    if kind == "bool":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    return str(value)


def _current_env_settings(*, masked: bool = True) -> dict[str, Any]:
    file_values = _load_env_file()
    settings: dict[str, Any] = {}
    for key, (kind, default) in _EDITABLE_ENV.items():
        raw = os.getenv(key)
        if key == "BOT_TOKEN" and not raw:
            raw = os.getenv("TELEGRAM_BOT_TOKEN")
        if raw is None:
            raw = file_values.get(key)
        value = _coerce_env_value(kind, raw, default)
        if masked and key in _SECRET_ENV_KEYS and str(value):
            value = _MASKED_SECRET
        settings[key] = value
    return settings


def _quote_env(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if not text:
        return ""
    if re.search(r"\s|#|['\"]", text):
        return json.dumps(text, ensure_ascii=False)
    return text


def _write_env_file(updates: dict[str, Any]) -> None:
    existing_lines = (
        _ENV_PATH.read_text(encoding="utf-8").splitlines()
        if _ENV_PATH.exists()
        else []
    )
    updated_keys: set[str] = set()
    output: list[str] = []

    for raw in existing_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(raw)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            output.append(f"{key}={_quote_env(updates[key])}")
            updated_keys.add(key)
        else:
            output.append(raw)

    for key in _EDITABLE_ENV:
        if key in updates and key not in updated_keys:
            output.append(f"{key}={_quote_env(updates[key])}")

    _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = _ENV_PATH.with_suffix(_ENV_PATH.suffix + ".tmp")
    temp_path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
    os.replace(temp_path, _ENV_PATH)


def _validate_env_updates(payload: EnvUpdate) -> dict[str, Any]:
    raw = payload.model_dump(exclude_none=True)
    current = _current_env_settings(masked=False)
    updates: dict[str, Any] = {}

    for key, value in raw.items():
        if key in _SECRET_ENV_KEYS and value == _MASKED_SECRET:
            updates[key] = current[key]
            continue

        kind, _ = _EDITABLE_ENV[key]
        if kind == "int":
            value = int(value)
            if value <= 0:
                raise HTTPException(status_code=422, detail=f"{key} must be positive")
        elif kind == "bool":
            value = bool(value)
        else:
            value = str(value).strip()

        if key == "LOG_LEVEL":
            value = value.upper()
            if value == "WARNING":
                value = "WARN"
            if value not in {"DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"}:
                raise HTTPException(status_code=422, detail="Invalid LOG_LEVEL")
        if key == "DOWNLOAD_API_URL" and value:
            parsed = urlparse(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise HTTPException(
                    status_code=422, detail="DOWNLOAD_API_URL must be an HTTP(S) URL"
                )
        updates[key] = value

    return updates


def _remove_rq_job(job_id: str, *, stop_running: bool) -> bool:
    connection = get_redis_connection()
    if connection is None:
        return False

    try:
        from rq.command import send_stop_job_command
        from rq.exceptions import NoSuchJobError
        from rq.job import Job
    except ImportError:
        return False

    try:
        rq_job = Job.fetch(job_id, connection=connection)
    except NoSuchJobError:
        return True

    try:
        raw_status = rq_job.get_status(refresh=True)
        status = getattr(raw_status, "value", str(raw_status))
        if stop_running and status in {"started", "busy"}:
            send_stop_job_command(connection, job_id)
        else:
            rq_job.cancel()
    except Exception:
        logger.exception("Could not cancel RQ job %s", job_id)

    try:
        rq_job.delete()
    except Exception:
        logger.exception("Could not delete RQ job %s", job_id)
    return True


def _parse_log_line(raw: str, source: str) -> dict[str, Any]:
    text = raw.rstrip("\r\n")
    timestamp = datetime.now(timezone.utc).isoformat()
    level = "INFO"
    message = text

    match = re.match(
        r"^(?P<time>\d{4}-\d{2}-\d{2}[ T][^ ]+)\s+"
        r"(?P<level>DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+"
        r"(?P<message>.*)$",
        text,
        re.IGNORECASE,
    )
    if match:
        timestamp = match.group("time")
        level = match.group("level").upper()
        message = match.group("message")
    else:
        upper = text.upper()
        for candidate in ("CRITICAL", "ERROR", "WARNING", "WARN", "DEBUG", "INFO"):
            if candidate in upper:
                level = candidate
                break
    if level == "WARNING":
        level = "WARN"

    return {
        "id": f"file-{uuid.uuid4().hex}",
        "timestamp": timestamp,
        "level": level,
        "source": source,
        "message": message,
    }


async def _authenticate_websocket(websocket: WebSocket) -> bool:
    candidate = websocket.query_params.get("token") or websocket.headers.get(
        "x-admin-token"
    )
    if not _admin_token():
        await websocket.close(code=4503, reason="ADMIN_API_TOKEN is not configured")
        return False
    if not _token_is_valid(candidate):
        await websocket.close(code=4401, reason="Invalid admin token")
        return False
    return True


@router.get("/api/v1/health")
def admin_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "3.3.0",
        "service": "smart-creators-admin",
        "redis": is_redis_available(),
        "queue": "redis-rq" if is_redis_available() else "in-process-fallback",
        "adminAuthConfigured": bool(_admin_token()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/v1/metrics", dependencies=[Depends(require_admin)])
def metrics() -> dict[str, Any]:
    return _collect_metrics()


@router.get("/api/v1/downloads/queue", dependencies=[Depends(require_admin)])
def downloads_queue(
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    return [_download_payload(job) for job in list_jobs(limit=limit)]


@router.post(
    "/api/v1/downloads/{job_id}/retry",
    dependencies=[Depends(require_admin)],
)
async def retry_download(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") == JobStatus.RUNNING.value:
        raise HTTPException(status_code=409, detail="A running job cannot be retried")

    _remove_rq_job(job_id, stop_running=False)
    delete_result(job_id)

    result = await _ENGINE.submit(
        str(job.get("url", "")),
        str(job.get("quality", "best")),
        job_id=job_id,
        chat_id=job.get("chat_id"),
    )
    refreshed = get_job(result.job_id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Retry could not be queued")
    logger.info("Retried download job %s", job_id)
    return _download_payload(refreshed)


@router.delete(
    "/api/v1/downloads/{job_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
def cancel_download(job_id: str) -> Response:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    status_value = str(job.get("status", ""))
    if status_value in {JobStatus.QUEUED.value, JobStatus.RUNNING.value}:
        if not _remove_rq_job(
            job_id, stop_running=status_value == JobStatus.RUNNING.value
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This in-process fallback job cannot be cancelled safely. "
                    "Configure Redis/RQ to enable cancellation."
                ),
            )

    delete_job(job_id)
    delete_result(job_id)
    logger.info("Cancelled download job %s", job_id)
    return Response(status_code=204)


@router.get("/api/v1/settings/env", dependencies=[Depends(require_admin)])
def get_env_settings() -> dict[str, Any]:
    return _current_env_settings(masked=True)


@router.put("/api/v1/settings/env", dependencies=[Depends(require_admin)])
def update_env_settings(payload: EnvUpdate) -> dict[str, Any]:
    updates = _validate_env_updates(payload)
    if not updates:
        return _current_env_settings(masked=True)

    current = _current_env_settings(masked=False)
    merged = {**current, **updates}
    _write_env_file(merged)

    for key, value in updates.items():
        os.environ[key] = (
            "true" if value is True else "false" if value is False else str(value)
        )
    if "LOG_LEVEL" in updates:
        level_name = str(updates["LOG_LEVEL"]).upper()
        if level_name == "WARN":
            level_name = "WARNING"
        logging.getLogger().setLevel(getattr(logging, level_name, logging.INFO))

    logger.warning(
        "Environment settings updated. A service restart is required for bot "
        "and worker subprocesses to load every change."
    )
    return _current_env_settings(masked=True)


@router.websocket("/ws/metrics")
async def metrics_socket(websocket: WebSocket) -> None:
    if not await _authenticate_websocket(websocket):
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(_collect_metrics())
            await asyncio.sleep(2)
    except Exception:
        logger.debug("Metrics WebSocket disconnected", exc_info=True)


@router.websocket("/ws/logs")
async def logs_socket(websocket: WebSocket) -> None:
    if not await _authenticate_websocket(websocket):
        return
    await websocket.accept()

    offsets: dict[Path, int] = {}
    memory_cursor = 0

    try:
        for path in _LOG_FILES:
            if not path.exists() or not path.is_file():
                continue
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                lines = deque(handle, maxlen=100)
                offsets[path] = handle.tell()
            for line in lines:
                await websocket.send_json(_parse_log_line(line, path.name))

        if _LOG_BUFFER:
            for entry in list(_LOG_BUFFER)[-100:]:
                await websocket.send_json(entry)
            memory_cursor = int(str(_LOG_BUFFER[-1]["id"]).split("-")[-1])

        while True:
            for entry in list(_LOG_BUFFER):
                try:
                    sequence = int(str(entry["id"]).split("-")[-1])
                except (KeyError, TypeError, ValueError):
                    continue
                if sequence > memory_cursor:
                    await websocket.send_json(entry)
                    memory_cursor = sequence

            for path in _LOG_FILES:
                if not path.exists() or not path.is_file():
                    continue
                previous = offsets.get(path, 0)
                size = path.stat().st_size
                if size < previous:
                    previous = 0
                with path.open("r", encoding="utf-8", errors="replace") as handle:
                    handle.seek(previous)
                    for line in handle:
                        await websocket.send_json(_parse_log_line(line, path.name))
                    offsets[path] = handle.tell()

            await asyncio.sleep(0.5)
    except Exception:
        logger.debug("Logs WebSocket disconnected", exc_info=True)
