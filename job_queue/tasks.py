from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from pathlib import Path

from core.cache import create_cache
from core.config import (
    CACHE_TTL_SECONDS,
    MEDIA_STORAGE_DRIVER,
    VIDEO_FPS_MODE,
    VIDEO_OUTPUT_CODEC,
    VIDEO_OUTPUT_CRF,
    VIDEO_OUTPUT_FIT,
    VIDEO_OUTPUT_FPS,
    VIDEO_OUTPUT_PRESET,
    VIDEO_OUTPUT_RESOLUTION,
)
from core.metadata import generate_video_thumbnail, get_video_metadata
from core.url_normalizer import clear_active_job_for_url, normalize_media_url, set_active_job_for_url
from core.video_converter import prepare_video
from engine.classifier import classify
from engine.media_engine import MediaJob, _to_media_type
from job_queue.job_store import get_job, mark_error, mark_ready, mark_running
from storage.result_store import save_result
from storage.object_store import delete_private_object, upload_private_file
from workers.media_worker import MediaWorker
from job_queue.connection import get_redis_connection

logger = logging.getLogger("job_queue.tasks")

OPTIONAL_4K_QUALITY = "4k60"


def _conversion_cache_key(url: str) -> str:
    settings = ":".join(map(str, (
        VIDEO_OUTPUT_RESOLUTION, VIDEO_OUTPUT_FPS, VIDEO_OUTPUT_CODEC,
        VIDEO_OUTPUT_CRF, VIDEO_OUTPUT_PRESET, VIDEO_OUTPUT_FIT, VIDEO_FPS_MODE,
    )))
    digest = hashlib.sha256(f"{normalize_media_url(url)}|{settings}".encode()).hexdigest()
    return f"media:conversion:v2:{digest}"


async def execute_download(
    job_id: str,
    url: str,
    quality: str,
    chat_id: int | None = None,
) -> dict:
    """Download highest original quality by default; convert only for 4k60 jobs."""
    cache = await create_cache()
    worker = MediaWorker(cache=cache)
    wants_4k = quality == OPTIONAL_4K_QUALITY

    async def on_progress(text: str, pct: float) -> None:
        mark_running(job_id, text=text, progress=pct)

    logger.info("WORKER_STARTED job_id=%s mode=%s", job_id, "4k60" if wants_4k else "original")
    set_active_job_for_url(url, job_id)
    mark_running(job_id, text="⏳ جارٍ تنزيل الفيديو بأعلى جودة...", progress=0.0)

    path: Path | None = None
    downloaded_path: Path | None = None
    thumbnail: str | None = None
    uploaded_keys: list[str] = []
    completed = False

    try:
        redis_conn = get_redis_connection()

        # A converted 4K cache must never replace the default original-quality path.
        if wants_4k and MEDIA_STORAGE_DRIVER == "s3" and redis_conn is not None:
            cached_raw = redis_conn.get(_conversion_cache_key(url))
            if cached_raw:
                cached = json.loads(cached_raw)
                result = save_result(
                    job_id,
                    file="",
                    media_type="video",
                    duration=int(cached.get("duration", 0)),
                    width=int(cached.get("width", 0)),
                    height=int(cached.get("height", 0)),
                    storage_key=cached["storage_key"],
                    filename=cached.get("filename", "video.mp4"),
                )
                mark_ready(job_id)
                completed = True
                logger.info("CONVERSION_CACHE_HIT job_id=%s", job_id)
                return {"status": "completed", "result": result}

        # 4k60 is an internal pipeline mode. The extractor should still fetch the
        # highest available source before conversion.
        extractor_quality = "best" if wants_4k else quality
        job = MediaJob(id=job_id, url=url, quality=extractor_quality, chat_id=chat_id)
        logger.info("DOWNLOAD_STARTED job_id=%s", job_id)
        file_path = await worker.process(job, on_progress=on_progress)
        downloaded_path = Path(file_path)
        path = downloaded_path
        logger.info("DOWNLOAD_COMPLETED job_id=%s path=%s", job_id, path.name)
        media_type = _to_media_type(classify(file_path))

        if wants_4k and media_type.value == "video":
            mark_running(job_id, text="🎬 جارٍ تجهيز نسخة 4K بمعدل 60 إطارًا...", progress=80.0)
            logger.info("CONVERSION_STARTED job_id=%s", job_id)
            path, _, _ = await prepare_video(path)
            logger.info("CONVERSION_COMPLETED job_id=%s", job_id)

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
            logger.warning("Metadata/thumbnail unavailable for job %s: %s", job_id, type(meta_exc).__name__)

        storage_key: str | None = None
        thumbnail_storage_key: str | None = None
        result_file = str(path.resolve())

        if MEDIA_STORAGE_DRIVER == "s3":
            storage_key = upload_private_file(path, job_id=job_id, kind="media")
            uploaded_keys.append(storage_key)
            logger.info("R2_UPLOAD_COMPLETED job_id=%s", job_id)
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
            filename=path.name,
        )
        mark_ready(job_id)
        completed = True

        if wants_4k and storage_key and redis_conn is not None:
            redis_conn.setex(
                _conversion_cache_key(url),
                CACHE_TTL_SECONDS,
                json.dumps({
                    "storage_key": storage_key,
                    "duration": duration,
                    "width": width,
                    "height": height,
                    "filename": path.name,
                }),
            )

        return {"status": "completed", "result": result}

    except Exception as exc:
        mark_error(job_id, error=str(exc))
        logger.exception("Download job %s failed", job_id)
        raise
    finally:
        clear_active_job_for_url(url)
        if MEDIA_STORAGE_DRIVER == "s3":
            if path is not None:
                path.unlink(missing_ok=True)
            if downloaded_path is not None and downloaded_path != path:
                downloaded_path.unlink(missing_ok=True)
            if thumbnail:
                Path(thumbnail).unlink(missing_ok=True)
            if not completed:
                for key in uploaded_keys:
                    try:
                        delete_private_object(key)
                    except Exception:
                        logger.exception("Failed to roll back uploaded object for job %s", job_id)
        await cache.close()


def process_download_task(job_id: str, *legacy_args) -> dict:
    """RQ entry point; only opaque job_id is used for new jobs."""
    if legacy_args:
        url = str(legacy_args[0])
        quality = str(legacy_args[1]) if len(legacy_args) > 1 else "best"
        chat_id = legacy_args[2] if len(legacy_args) > 2 else None
    else:
        record = get_job(job_id)
        if record is None:
            raise RuntimeError(f"Job record not found: {job_id}")
        url = str(record.get("url") or "")
        quality = str(record.get("quality") or "best")
        chat_id = record.get("chat_id")
        if not url:
            mark_error(job_id, error="Job source URL is missing")
            raise RuntimeError(f"Job source URL is missing: {job_id}")

    return asyncio.run(execute_download(job_id, url, quality, chat_id))
