from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Callable, Awaitable

from job_queue.job_store import create_job
from job_queue.queue import enqueue_download

if TYPE_CHECKING:
    from workers.media_worker import MediaWorker

ProgressCallback = Callable[[str, float], Awaitable[None]]
logger = logging.getLogger("engine")


class MediaType(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"
    UNKNOWN = "unknown"


@dataclass
class MediaJob:
    id: str
    url: str
    quality: str
    chat_id: int | None = None
    media_type: MediaType = MediaType.UNKNOWN


@dataclass
class MediaJobResult:
    job_id: str
    file_path: str
    media_type: MediaType


@dataclass
class MediaJobEnqueueResult:
    job_id: str
    status: str


def _to_media_type(value: str) -> MediaType:
    return {
        "video": MediaType.VIDEO,
        "audio": MediaType.AUDIO,
    }.get(value, MediaType.UNKNOWN)


class MediaEngine:
    def __init__(self, worker: MediaWorker | None = None):
        self.worker = worker

    async def submit(
        self,
        url: str,
        quality: str,
        *,
        job_id: str | None = None,
        chat_id: int | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> MediaJobEnqueueResult:
        """Enqueue a download job instead of running it inline."""
        resolved_job_id = job_id or str(uuid.uuid4())

        create_job(
            resolved_job_id,
            url=url,
            quality=quality,
            chat_id=chat_id,
        )

        if not enqueue_download(resolved_job_id, url, quality, chat_id):
            logger.warning(
                "Redis/RQ unavailable – running in-process fallback for job %s",
                resolved_job_id,
            )
            asyncio.create_task(
                self._run_fallback(resolved_job_id, url, quality, chat_id, on_progress)
            )

        return MediaJobEnqueueResult(job_id=resolved_job_id, status="queued")

    async def _run_fallback(
        self,
        job_id: str,
        url: str,
        quality: str,
        chat_id: int | None,
        on_progress: ProgressCallback | None,
    ) -> None:
        """In-process fallback when Redis/RQ is unavailable."""
        from job_queue.tasks import execute_download

        try:
            await execute_download(job_id, url, quality, chat_id)
        except Exception:
            logger.exception("In-process fallback failed for job %s", job_id)
