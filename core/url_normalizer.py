"""
core/url_normalizer.py
Robust URL normalization and active job deduplication:
- Strips tracking, advertising, and session query parameters (utm_*, fbclid, igshid, si, etc.)
- Normalizes protocol, hostname, trailing slashes, and parameter ordering
- Provides Redis/In-Memory active job locking so concurrent duplicate requests share the existing job
"""
from __future__ import annotations

import hashlib
import logging
import urllib.parse
from typing import Any

from job_queue.connection import get_redis_connection

logger = logging.getLogger(__name__)

_TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "igshid",
    "si",
    "share_app_id",
    "ugbiz_name",
    "checksum",
    "_r",
    "_t",
    "spm",
    "feature",
    "mid",
    "timestamp",
    "ts",
    "refer",
    "referrer",
}

_ACTIVE_JOB_TTL = 900


def normalize_media_url(raw_url: str) -> str:
    """Normalize a media URL by stripping tracking parameters, normalizing host/path."""
    if not raw_url or not isinstance(raw_url, str):
        return ""

    url = raw_url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = f"https://{url}"

    try:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()

        if netloc.endswith(":80") and scheme == "http":
            netloc = netloc[:-3]
        elif netloc.endswith(":443") and scheme == "https":
            netloc = netloc[:-4]

        query_items = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
        filtered_query = [
            (k, v)
            for k, v in query_items
            if k.lower() not in _TRACKING_PARAMS and not k.lower().startswith("utm_")
        ]
        filtered_query.sort(key=lambda x: x[0])
        new_query = urllib.parse.urlencode(filtered_query)

        path = parsed.path
        if len(path) > 1 and path.endswith("/"):
            path = path.rstrip("/")

        return urllib.parse.urlunparse((scheme, netloc, path, parsed.params, new_query, ""))
    except Exception as exc:
        logger.debug("Failed to normalize URL: %s", type(exc).__name__)
        return raw_url.strip()


def url_hash(url: str) -> str:
    norm = normalize_media_url(url)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


_in_memory_active_jobs: dict[str, str] = {}


def _is_job_still_active(job_id: str) -> bool:
    """Return True only for application jobs that can still produce a result."""
    try:
        from job_queue.job_store import JobStatus, get_job
        record = get_job(job_id)
        if record is None:
            return False
        return record.get("status") in {
            JobStatus.QUEUED.value,
            JobStatus.RUNNING.value,
            JobStatus.READY.value,
        }
    except Exception as exc:
        logger.warning("Active job state validation unavailable: %s", type(exc).__name__)
        return True


def get_active_job_for_url(url: str) -> str | None:
    """Return an active job for this URL, discarding stale terminal locks."""
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            existing = redis_conn.get(key)
            if existing:
                job_id = existing.decode("utf-8") if isinstance(existing, bytes) else str(existing)
                if _is_job_still_active(job_id):
                    return job_id
                redis_conn.delete(key)
                _in_memory_active_jobs.pop(h, None)
                logger.info("STALE_ACTIVE_JOB_CLEARED job_id=%s", job_id)
                return None
        except Exception as exc:
            logger.warning("Redis active job check error: %s", type(exc).__name__)

    existing = _in_memory_active_jobs.get(h)
    if existing and not _is_job_still_active(existing):
        _in_memory_active_jobs.pop(h, None)
        return None
    return existing


def set_active_job_for_url(url: str, job_id: str) -> None:
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            redis_conn.set(key, job_id, ex=_ACTIVE_JOB_TTL)
        except Exception as exc:
            logger.warning("Redis active job set error: %s", type(exc).__name__)

    _in_memory_active_jobs[h] = job_id


def clear_active_job_for_url(url: str) -> None:
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            redis_conn.delete(key)
        except Exception as exc:
            logger.warning("Redis active job clear error: %s", type(exc).__name__)

    _in_memory_active_jobs.pop(h, None)
