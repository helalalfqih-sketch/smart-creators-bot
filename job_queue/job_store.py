from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from core.config import JOB_TTL_SECONDS
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue.job_store")

_memory_jobs: dict[str, dict[str, Any]] = {}
JOB_STALE_SECONDS = max(600, int(os.getenv("JOB_STALE_SECONDS", "2700")))


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


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


def _record_age_seconds(record: dict[str, Any]) -> float:
    raw = record.get("updated_at") or record.get("started_at") or record.get("created_at")
    if not raw:
        return 0.0
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds())
    except (TypeError, ValueError):
        return 0.0


def _mark_reconciled_error(record: dict[str, Any], *, reason: str, rq_status: str) -> dict[str, Any]:
    record.update(
        {
            "status": JobStatus.ERROR.value,
            "error": reason,
            "text": "❌ فشل",
            "completed_at": _now_iso(),
        }
    )
    _persist(str(record["job_id"]), record)
    logger.warning(
        "RQ_TERMINAL_STATE_RECONCILED job_id=%s rq_status=%s",
        record.get("job_id"),
        rq_status,
    )
    return record


def _reconcile_rq_terminal_state(record: dict[str, Any]) -> dict[str, Any]:
    """Mirror dead/terminal RQ state into the persistent dashboard record.

    A Render restart can leave the app record at queued/running even though RQ
    has already lost, failed, stopped or finished the task. Active RQ jobs are
    never timed out here; the age fallback is used only when the RQ job itself
    is no longer present.
    """
    if record.get("status") not in {JobStatus.QUEUED.value, JobStatus.RUNNING.value}:
        return record

    redis_conn = get_redis_connection()
    if redis_conn is None:
        return record

    age_seconds = _record_age_seconds(record)
    try:
        from rq.job import Job

        rq_job = Job.fetch(str(record.get("job_id")), connection=redis_conn)
        rq_status = str(rq_job.get_status(refresh=True) or "").lower()
    except Exception:
        if age_seconds >= JOB_STALE_SECONDS:
            return _mark_reconciled_error(
                record,
                reason="Queue task disappeared before completion",
                rq_status="missing",
            )
        return record

    if rq_status in {"failed", "stopped", "canceled", "cancelled"}:
        return _mark_reconciled_error(
            record,
            reason="Worker interrupted before completion",
            rq_status=rq_status,
        )

    # A finished RQ function must have published READY/DONE before returning.
    # If it did not, the persistent record is orphaned rather than processing.
    if rq_status in {"finished", "complete", "completed"} and age_seconds >= 60:
        return _mark_reconciled_error(
            record,
            reason="Worker finished without publishing a result",
            rq_status=rq_status,
        )

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
        record = json.loads(raw)
        return _reconcile_rq_terminal_state(record)

    return _memory_jobs.get(job_id)


def list_jobs(limit: int = 500) -> list[dict[str, Any]]:
    """Return newest retained jobs from Redis or the in-process fallback store."""
    safe_limit = max(1, min(int(limit), 5000))
    redis_conn = get_redis_connection()
    records: list[dict[str, Any]] = []

    if redis_conn is not None:
        for key in redis_conn.scan_iter(match="media:job:*", count=200):
            raw = redis_conn.get(key)
            if raw is None:
                continue
            try:
                decoded = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                logger.warning("Ignoring malformed job record at key %r", key)
                continue
            if isinstance(decoded, dict):
                records.append(_reconcile_rq_terminal_state(decoded))
    else:
        records = [dict(record) for record in _memory_jobs.values()]

    records.sort(
        key=lambda item: str(item.get("created_at") or item.get("updated_at") or ""),
        reverse=True,
    )
    return records[:safe_limit]


def delete_job(job_id: str) -> None:
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        redis_conn.delete(_job_key(job_id))
    else:
        _memory_jobs.pop(job_id, None)


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


def mark_ready(job_id: str) -> dict[str, Any] | None:
    """Result is persisted but Telegram delivery is not confirmed yet."""
    record = get_job(job_id)
    if record is None:
        return None
    record.update(
        {
            "status": JobStatus.READY.value,
            "progress": 99.0,
            "text": "جاهز للإرسال",
            "has_result": True,
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
