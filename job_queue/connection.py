from __future__ import annotations

import logging

from core.config import REDIS_URL

logger = logging.getLogger("job_queue.connection")

_redis_conn = None
_redis_checked = False


def get_redis_connection():
    """Return a sync Redis client for RQ, or None if unavailable."""
    global _redis_conn, _redis_checked

    if _redis_checked:
        return _redis_conn

    _redis_checked = True
    try:
        import redis

        client = redis.from_url(REDIS_URL, socket_connect_timeout=2, decode_responses=False)
        client.ping()
        _redis_conn = client
        logger.info("Redis connected for queue at %s", REDIS_URL)
    except Exception as exc:
        logger.warning("Redis unavailable for queue (%s) – using in-process fallback", exc)
        _redis_conn = None

    return _redis_conn


def is_redis_available() -> bool:
    return get_redis_connection() is not None
