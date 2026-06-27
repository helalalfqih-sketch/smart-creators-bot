from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from core.config import JOB_TTL_SECONDS, RESULT_TTL_SECONDS
from job_queue.connection import get_redis_connection

logger = logging.getLogger("storage.result_store")

_memory_results: dict[str, dict[str, Any]] = {}


def _result_key(job_id: str) -> str:
    return f"media:result:{job_id}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_result(
    job_id: str,
    *,
    file: str,
    media_type: str,
    duration: int = 0,
    width: int = 0,
    height: int = 0,
    thumbnail: str | None = None,
) -> dict[str, Any]:
    record = {
        "job_id": job_id,
        "file": file,
        "media_type": media_type,
        "duration": duration,
        "width": width,
        "height": height,
        "thumbnail": thumbnail,
        "completed_at": _now_iso(),
    }

    redis_conn = get_redis_connection()
    if redis_conn is not None:
        redis_conn.setex(_result_key(job_id), RESULT_TTL_SECONDS, json.dumps(record))
    else:
        _memory_results[job_id] = record

    logger.info("Saved result for job %s", job_id)
    return record


def get_result(job_id: str) -> dict[str, Any] | None:
    redis_conn = get_redis_connection()

    if redis_conn is not None:
        raw = redis_conn.get(_result_key(job_id))
        if raw is None:
            return None
        return json.loads(raw)

    return _memory_results.get(job_id)


def delete_result(job_id: str) -> None:
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        redis_conn.delete(_result_key(job_id))
    else:
        _memory_results.pop(job_id, None)
