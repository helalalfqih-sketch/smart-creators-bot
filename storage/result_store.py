from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from core.config import JOB_TTL_SECONDS, RESULT_TTL_SECONDS
from job_queue.connection import get_redis_connection
from storage.object_store import create_signed_download_url

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
    storage_key: str | None = None,
    thumbnail_storage_key: str | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    record = {
        "job_id": job_id,
        "file": file,
        "filename": filename,
        "status": "completed",
        "media_type": media_type,
        "duration": duration,
        "width": width,
        "height": height,
        "thumbnail": thumbnail,
        "storage_key": storage_key,
        "thumbnail_storage_key": thumbnail_storage_key,
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
        record = json.loads(raw)
        return _with_fresh_signed_urls(record)

    record = _memory_results.get(job_id)
    return _with_fresh_signed_urls(record) if record else None


def _with_fresh_signed_urls(record: dict[str, Any]) -> dict[str, Any]:
    """Hydrate only the primary media object with a fresh signed URL.

    Telegram accepts the primary video/document as an HTTP URL, but thumbnails
    are upload-only in this delivery path. Passing a remote presigned thumbnail
    can make python-telegram-bot raise ValueError before the API request is sent.
    Keep the thumbnail unset for S3/R2-backed results; Telegram will generate
    its own preview when possible.
    """
    hydrated = dict(record)
    if hydrated.get("storage_key"):
        try:
            hydrated["file"] = create_signed_download_url(hydrated["storage_key"])
        except Exception as exc:
            logger.debug("Could not generate presigned S3 URL for job: %s", exc)

    if hydrated.get("thumbnail_storage_key"):
        hydrated["thumbnail"] = None

    return hydrated


def delete_result(job_id: str) -> None:
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        redis_conn.delete(_result_key(job_id))
    else:
        _memory_results.pop(job_id, None)
