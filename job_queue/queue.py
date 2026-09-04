from __future__ import annotations

import logging

from core.config import RQ_QUEUE_NAME, VIDEO_CONVERSION_TIMEOUT_SECONDS
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue")

_queue = None
_queue_checked = False
_OPTIONAL_4K_QUALITY = "4k60"


def get_queue():
    """Return the RQ queue instance, or None if Redis is unavailable."""
    global _queue, _queue_checked

    if _queue_checked:
        return _queue

    _queue_checked = True
    redis_conn = get_redis_connection()
    if redis_conn is None:
        return None

    from rq import Queue

    _queue = Queue(RQ_QUEUE_NAME, connection=redis_conn)
    logger.info("RQ queue ready: %s", RQ_QUEUE_NAME)
    return _queue


def enqueue_download(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> bool:
    """Enqueue a download job without exposing URL/chat_id in RQ's job repr.

    The complete job payload is already persisted in job_store before enqueue.
    Only the opaque job_id crosses the RQ boundary, so the default RQ worker
    log cannot print the source URL or Telegram ChatID.

    Optional 4K conversions get exactly one RQ retry. This covers a transient
    FFmpeg/worker interruption without ever duplicating normal original-video
    deliveries.
    """
    queue = get_queue()
    if queue is None:
        return False

    from job_queue.tasks import process_download_task
    from rq import Retry

    retry = Retry(max=1) if str(quality).lower() == _OPTIONAL_4K_QUALITY else None

    queue.enqueue(
        process_download_task,
        job_id,
        job_id=job_id,
        job_timeout=VIDEO_CONVERSION_TIMEOUT_SECONDS + 300,
        result_ttl=3600,
        failure_ttl=3600,
        retry=retry,
    )
    logger.info("Enqueued download job %s", job_id)
    return True
