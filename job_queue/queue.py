from __future__ import annotations

import logging

from core.config import RQ_QUEUE_NAME
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue")

_queue = None
_queue_checked = False


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
    """Enqueue a download job. Returns False when Redis/RQ is unavailable."""
    queue = get_queue()
    if queue is None:
        return False

    from job_queue.tasks import process_download_task

    queue.enqueue(
        process_download_task,
        job_id,
        url,
        quality,
        chat_id,
        job_id=job_id,
        job_timeout="30m",
        result_ttl=3600,
        failure_ttl=3600,
    )
    logger.info("Enqueued download job %s", job_id)
    return True
