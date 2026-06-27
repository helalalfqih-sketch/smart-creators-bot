from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from core.config import JOB_TTL_SECONDS
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue.job_store")

_memory_jobs: dict[str, dict[str, Any]] = {}


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


def _job_key(job_id: str) -> str:
    return f"media:job:{job_id}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_job(
    *,
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
    status: str = JobStatus.QUEUED.value,
) -> dict[str, Any]:
    now = _now_iso()
    return {
        "job_id": job_id,
        "status": status,
        "progress": 0.0,
        "text": "⏳ في الانتظار...",
        "error": None,
        "quality": quality,
        "url": url,
        "chat_id": chat_id,
        "has_result": False,
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }


def _persist(job_id: str, record: dict[str, Any]) -> dict[str, Any]:
    record["updated_at"] = _now_iso()
    redis_conn = get_redis_connection()

    if redis_conn is not None:
        redis_conn.setex(_job_key(job_id), JOB_TTL_SECONDS, json.dumps(record))
    else:
        _memory_jobs[job_id] = record

    return record


def create_job(
    job_id: str,
    *,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> dict[str, Any]:
    record = _default_job(job_id=job_id, url=url, quality=quality, chat_id=chat_id)
    return _persist(job_id, record)


def get_job(job_id: str) -> dict[str, Any] | None:
    redis_conn = get_redis_connection()

    if redis_conn is not None:
        raw = redis_conn.get(_job_key(job_id))
        if raw is None:
            return None
        return json.loads(raw)

    return _memory_jobs.get(job_id)


def update_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    record = get_job(job_id)
    if record is None:
        return None
    record.update(fields)
    return _persist(job_id, record)


def mark_running(job_id: str, *, text: str, progress: float) -> dict[str, Any] | None:
    record = get_job(job_id)
    if record is None:
        return None

    updates: dict[str, Any] = {
        "status": JobStatus.RUNNING.value,
        "text": text,
        "progress": progress,
    }
    if record.get("started_at") is None:
        updates["started_at"] = _now_iso()

    record.update(updates)
    return _persist(job_id, record)


def mark_done(job_id: str, *, text: str = "✅ اكتمل التحميل") -> dict[str, Any] | None:
    record = get_job(job_id)
    if record is None:
        return None

    record.update(
        {
            "status": JobStatus.DONE.value,
            "progress": 100.0,
            "text": text,
            "has_result": True,
            "completed_at": _now_iso(),
            "error": None,
        }
    )
    return _persist(job_id, record)


def mark_error(job_id: str, *, error: str, text: str = "❌ فشل") -> dict[str, Any] | None:
    record = get_job(job_id)
    if record is None:
        return None

    record.update(
        {
            "status": JobStatus.ERROR.value,
            "error": error,
            "text": text,
            "completed_at": _now_iso(),
        }
    )
    return _persist(job_id, record)
