from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from core.cache import create_cache
from core.config import MEDIA_STORAGE_DRIVER
from core.metadata import generate_video_thumbnail, get_video_metadata
from engine.classifier import classify
from engine.media_engine import MediaJob, _to_media_type
from job_queue.job_store import mark_done, mark_error, mark_running
from storage.result_store import save_result
from storage.object_store import delete_private_object, upload_private_file
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
    path: Path | None = None
    thumbnail: str | None = None
    uploaded_keys: list[str] = []
    completed = False

    try:
        job = MediaJob(id=job_id, url=url, quality=quality, chat_id=chat_id)
        file_path = await worker.process(job, on_progress=on_progress)
        path = Path(file_path)
        media_type = _to_media_type(classify(file_path))

        duration = 0
        width = 0
        height = 0

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

        storage_key: str | None = None
        thumbnail_storage_key: str | None = None
        result_file = str(path.resolve())

        if MEDIA_STORAGE_DRIVER == "s3":
            storage_key = upload_private_file(path, job_id=job_id, kind="media")
            uploaded_keys.append(storage_key)
            result_file = ""
            if thumbnail:
                thumbnail_storage_key = upload_private_file(
                    Path(thumbnail), job_id=job_id, kind="thumbnail"
                )
                uploaded_keys.append(thumbnail_storage_key)

        result = save_result(
            job_id,
            file=result_file,
            media_type=media_type.value,
            duration=duration,
            width=width,
            height=height,
            thumbnail=thumbnail if MEDIA_STORAGE_DRIVER != "s3" else None,
            storage_key=storage_key,
            thumbnail_storage_key=thumbnail_storage_key,
        )
        mark_done(job_id)
        completed = True

        return {
            "status": "done",
            "result": result,
        }

    except Exception as exc:
        mark_error(job_id, error=str(exc))
        logger.exception("Download job %s failed", job_id)
        raise
    finally:
        if MEDIA_STORAGE_DRIVER == "s3":
            if path is not None:
                path.unlink(missing_ok=True)
            if thumbnail:
                Path(thumbnail).unlink(missing_ok=True)
            if not completed:
                for key in uploaded_keys:
                    try:
                        delete_private_object(key)
                    except Exception:
                        logger.exception(
                            "Failed to roll back uploaded object for job %s", job_id
                        )
        await cache.close()


def process_download_task(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> dict:
    """RQ entry point – sync wrapper around async download pipeline."""
    return asyncio.run(execute_download(job_id, url, quality, chat_id))
