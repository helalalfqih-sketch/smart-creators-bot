from __future__ import annotations

import logging

from core.config import (
    RQ_4K_QUEUE_NAME,
    RQ_QUEUE_NAME,
    RQ_SEPARATE_4K_QUEUE_ENABLED,
    VIDEO_CONVERSION_TIMEOUT_SECONDS,
)
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue")

_queues: dict[str, object] = {}
_queue_checks: set[str] = set()
_OPTIONAL_4K_QUALITY = "4k60"


def _target_queue_name(quality: str) -> str:
    """Select the delivery queue without leaking source data into RQ logs.

    The separate 4K queue is feature-gated so production remains backwards
    compatible until a dedicated high-memory Render worker is attached to
    ``RQ_4K_QUEUE_NAME``. Once enabled, original jobs stay on ``media`` while
    optional 4K/60 conversions are isolated on ``media-4k``.
    """
    if (
        RQ_SEPARATE_4K_QUEUE_ENABLED
        and str(quality).strip().lower() == _OPTIONAL_4K_QUALITY
    ):
        return RQ_4K_QUEUE_NAME
    return RQ_QUEUE_NAME


def get_queue(queue_name: str | None = None):
    """Return the requested RQ queue, or None if Redis is unavailable."""
    resolved_name = str(queue_name or RQ_QUEUE_NAME).strip() or RQ_QUEUE_NAME

    if resolved_name in _queue_checks:
        return _queues.get(resolved_name)

    _queue_checks.add(resolved_name)
    redis_conn = get_redis_connection()
    if redis_conn is None:
        return None

    from rq import Queue

    queue = Queue(resolved_name, connection=redis_conn)
    _queues[resolved_name] = queue
    logger.info("RQ queue ready: %s", resolved_name)
    return queue


def enqueue_download(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> bool:
    """Enqueue a media job using only its opaque job ID at the RQ boundary.

    The complete payload is already persisted in ``job_store`` before enqueue,
    so default RQ logs never expose the source URL or Telegram ChatID.

    Original downloads are always sent to the normal media queue. When
    ``RQ_SEPARATE_4K_QUEUE_ENABLED=true``, optional 4K/60 jobs are sent to the
    dedicated 4K queue and therefore cannot block or crash the original-media
    worker. Optional 4K conversions keep exactly one RQ retry.
    """
    queue_name = _target_queue_name(quality)
    queue = get_queue(queue_name)
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
    logger.info("Enqueued download job %s queue=%s", job_id, queue_name)
    return True
