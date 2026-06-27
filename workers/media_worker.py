from __future__ import annotations

from typing import TYPE_CHECKING

from core.worker import download_video
from engine.media_engine import MediaJob, ProgressCallback

if TYPE_CHECKING:
    from core.cache import CacheProtocol


class MediaWorker:
    """Unified download worker – delegates to core yt-dlp pipeline."""

    def __init__(self, cache: CacheProtocol | None = None):
        self.cache = cache

    async def process(
        self,
        job: MediaJob,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> str:
        path = await download_video(
            job.url,
            quality=job.quality,
            cache=self.cache,
            on_progress=on_progress,
        )
        return str(path.resolve())
