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

# Query parameters to completely strip for normalization
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

# Active job lock TTL in seconds (15 minutes max for active download/process)
_ACTIVE_JOB_TTL = 900


def normalize_media_url(raw_url: str) -> str:
    """Normalize a media URL by stripping tracking parameters, normalizing host/path.

    Returns a clean, canonical URL suitable for caching and deduplication.
    """
    if not raw_url or not isinstance(raw_url, str):
        return ""

    url = raw_url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = f"https://{url}"

    try:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()

        # Remove port 80/443 if default
        if netloc.endswith(":80") and scheme == "http":
            netloc = netloc[:-3]
        elif netloc.endswith(":443") and scheme == "https":
            netloc = netloc[:-4]

        # Strip standard tracking parameters
        query_items = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
        filtered_query = [
            (k, v)
            for k, v in query_items
            if k.lower() not in _TRACKING_PARAMS and not k.lower().startswith("utm_")
        ]
        # Sort query params for canonical hashing
        filtered_query.sort(key=lambda x: x[0])
        new_query = urllib.parse.urlencode(filtered_query)

        # Normalize path: strip trailing slash unless root
        path = parsed.path
        if len(path) > 1 and path.endswith("/"):
            path = path.rstrip("/")

        normalized = urllib.parse.urlunparse((scheme, netloc, path, parsed.params, new_query, ""))
        return normalized
    except Exception as exc:
        logger.debug("Failed to normalize URL %s: %s", raw_url, exc)
        return raw_url.strip()


def url_hash(url: str) -> str:
    """Compute a deterministic SHA-256 hash of a normalized URL."""
    norm = normalize_media_url(url)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


# In-memory fallback if Redis is not available
_in_memory_active_jobs: dict[str, str] = {}


def get_active_job_for_url(url: str) -> str | None:
    """Check if an active (queued/running) job already exists for this normalized URL.

    Returns the active job_id if found, or None.
    """
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            existing = redis_conn.get(key)
            if existing:
                return existing.decode("utf-8") if isinstance(existing, bytes) else str(existing)
        except Exception as exc:
            logger.warning("Redis active job check error: %s", exc)

    return _in_memory_active_jobs.get(h)


def set_active_job_for_url(url: str, job_id: str) -> None:
    """Record an active job for this normalized URL."""
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            redis_conn.set(key, job_id, ex=_ACTIVE_JOB_TTL)
        except Exception as exc:
            logger.warning("Redis active job set error: %s", exc)

    _in_memory_active_jobs[h] = job_id


def clear_active_job_for_url(url: str) -> None:
    """Clear the active job lock when a job completes or fails."""
    h = url_hash(url)
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:active_url:{h}"
            redis_conn.delete(key)
        except Exception as exc:
            logger.warning("Redis active job clear error: %s", exc)

    _in_memory_active_jobs.pop(h, None)
