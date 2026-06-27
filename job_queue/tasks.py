from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from core.cache import create_cache
from core.metadata import generate_video_thumbnail, get_video_metadata
from engine.classifier import classify
from engine.media_engine import MediaJob, _to_media_type
from job_queue.job_store import mark_done, mark_error, mark_running
from storage.result_store import save_result
from workers.media_worker import MediaWorker

logger = logging.getLogger("job_queue.tasks")


async def execute_download(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> dict:
    """Run download via MediaWorker and persist job + result state."""
    cache = await create_cache()
    worker = MediaWorker(cache=cache)

    async def on_progress(text: str, pct: float) -> None:
        mark_running(job_id, text=text, progress=pct)

    mark_running(job_id, text="🔍 جاري الجلب...", progress=0.0)

    try:
        job = MediaJob(id=job_id, url=url, quality=quality, chat_id=chat_id)
        file_path = await worker.process(job, on_progress=on_progress)
        path = Path(file_path)
        media_type = _to_media_type(classify(file_path))

        duration = 0
        width = 0
        height = 0
        thumbnail: str | None = None

        try:
            meta = get_video_metadata(path)
            duration = meta.get("duration", 0)
            width = meta.get("width", 0)
            height = meta.get("height", 0)

            if media_type.value == "video" and width > 0:
                thumb_path = path.with_name(f"{path.stem}_thumb.jpg")
                if generate_video_thumbnail(path, thumb_path):
                    thumbnail = str(thumb_path.resolve())
        except Exception as meta_exc:
            logger.error("Metadata/thumbnail failed for job %s: %s", job_id, meta_exc)

        result = save_result(
            job_id,
            file=str(path.resolve()),
            media_type=media_type.value,
            duration=duration,
            width=width,
            height=height,
            thumbnail=thumbnail,
        )
        mark_done(job_id)

        return {
            "status": "done",
            "result": result,
        }

    except Exception as exc:
        mark_error(job_id, error=str(exc))
        logger.exception("Download job %s failed", job_id)
        raise
    finally:
        await cache.close()


def process_download_task(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> dict:
    """RQ entry point – sync wrapper around async download pipeline."""
    return asyncio.run(execute_download(job_id, url, quality, chat_id))
