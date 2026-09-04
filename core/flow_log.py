from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from job_queue.connection import get_redis_connection

logger = logging.getLogger("flow")

FLOW_LOG_KEY = "media:flow_logs:v1"
FLOW_LOG_MAX_ENTRIES = 1000
FLOW_LOG_TTL_SECONDS = 7 * 24 * 60 * 60
_MIRROR_POLL_SECONDS = 1.0
_mirror_started = False
_mirror_lock = threading.Lock()


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


def _event_signature(event: dict[str, Any]) -> str:
    return "|".join(
        str(event.get(key) or "")
        for key in ("timestamp", "source", "stage", "job_id", "detail")
    )


def _mirror_worker() -> None:
    """Mirror Redis lifecycle events into the bot service dashboard.log.

    The dashboard API already reads dashboard.log every few seconds, while the
    media worker lives in a separate Render service. Mirroring here makes the
    complete cross-service lifecycle visible in one console without exposing
    URLs, Telegram chat ids, tokens, cookies, or signed URLs.
    """
    seen: set[str] = set()
    primed = False
    flow_logger = logging.getLogger("flow.dashboard")

    while True:
        try:
            events = list_flow_events(250)
            if not primed:
                # Do not replay the whole historical buffer after every deploy.
                seen = {_event_signature(event) for event in events}
                primed = True
            else:
                for event in events:
                    signature = _event_signature(event)
                    if signature in seen:
                        continue
                    seen.add(signature)
                    if len(seen) > 2000:
                        seen = set(list(seen)[-1000:])

                    stage = str(event.get("stage") or "FLOW_EVENT")
                    source = str(event.get("source") or "flow")
                    job_id = str(event.get("job_id") or "")
                    detail = str(event.get("detail") or "")
                    message = f"FLOW {stage} source={source}"
                    if job_id:
                        message += f" job_id={job_id}"
                    if detail:
                        message += f" detail={detail}"

                    level_name = str(event.get("level") or "INFO").upper()
                    level = getattr(logging, level_name, logging.INFO)
                    flow_logger.log(level, message)
        except Exception as exc:
            logger.debug("Flow mirror unavailable: %s", type(exc).__name__)
        time.sleep(_MIRROR_POLL_SECONDS)


def start_dashboard_flow_mirror() -> None:
    global _mirror_started
    service_name = os.getenv("RENDER_SERVICE_NAME", "").lower()
    if "worker" in service_name:
        return
    # Only auto-start in the production bot service. Local development can call
    # this function explicitly if the mirror is desired.
    if service_name and "bot" not in service_name:
        return

    with _mirror_lock:
        if _mirror_started:
            return
        _mirror_started = True
        thread = threading.Thread(
            target=_mirror_worker,
            name="dashboard-flow-mirror",
            daemon=True,
        )
        thread.start()


start_dashboard_flow_mirror()
