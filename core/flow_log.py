from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from job_queue.connection import get_redis_connection

logger = logging.getLogger("flow")

FLOW_LOG_KEY = "media:flow_logs:v1"
FLOW_LOG_MAX_ENTRIES = 1000
FLOW_LOG_TTL_SECONDS = 7 * 24 * 60 * 60


def emit_flow(
    stage: str,
    *,
    source: str,
    job_id: str | None = None,
    level: str = "INFO",
    detail: str | None = None,
) -> None:
    """Persist a safe cross-service lifecycle event for the dashboard.

    Never pass source URLs, Telegram chat ids, tokens, cookies, signed URLs, or
    arbitrary exception strings as detail. Keep detail to safe state labels.
    """
    event: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": str(level or "INFO").upper(),
        "source": source,
        "stage": stage,
    }
    if job_id:
        event["job_id"] = str(job_id)
    if detail:
        event["detail"] = str(detail)

    try:
        redis_conn = get_redis_connection()
        if redis_conn is None:
            return
        pipe = redis_conn.pipeline()
        pipe.lpush(FLOW_LOG_KEY, json.dumps(event, ensure_ascii=False))
        pipe.ltrim(FLOW_LOG_KEY, 0, FLOW_LOG_MAX_ENTRIES - 1)
        pipe.expire(FLOW_LOG_KEY, FLOW_LOG_TTL_SECONDS)
        pipe.execute()
    except Exception as exc:
        logger.debug("Flow log unavailable: %s", type(exc).__name__)


def list_flow_events(limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 100), FLOW_LOG_MAX_ENTRIES))
    try:
        redis_conn = get_redis_connection()
        if redis_conn is None:
            return []
        raw_items = redis_conn.lrange(FLOW_LOG_KEY, 0, limit - 1)
    except Exception:
        return []

    events: list[dict[str, Any]] = []
    for raw in reversed(raw_items):
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            item = json.loads(raw)
            if isinstance(item, dict):
                events.append(item)
        except Exception:
            continue
    return events
