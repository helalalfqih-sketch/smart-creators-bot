"""
FastAPI server – exposes /download (async, with SSE progress stream)
and a /status/{job_id} endpoint for polling.

Architecture:
  POST /download  -> returns job_id immediately, starts background download
  GET  /progress/{job_id} -> Server-Sent Events stream with progress %
  GET  /result/{job_id}   -> returns file path once done (or error)
  GET  /                  -> health check
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from contextlib import asynccontextmanager

from core.cache import create_cache
from core.config import DOWNLOAD_DIR
from core.worker import download_video
from core.metadata import get_video_metadata, generate_video_thumbnail

logger = logging.getLogger("api")

# ── Job store (in-process) ────────────────────────────────────────────────────
# { job_id: {"status": "pending|running|done|error", "file": str|None,
#             "error": str|None, "progress": float, "text": str,
#             "duration": int, "width": int, "height": int, "thumbnail": str|None} }
_jobs: dict[str, dict] = {}

# Shared cache instance (set on startup)
_cache = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache
    _cache = await create_cache()
    yield
    if _cache:
        await _cache.close()


app = FastAPI(title="Video Downloader API", version="2.0.0", lifespan=lifespan)


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_valid_url(value: str) -> bool:
    try:
        p = urlparse(value)
        return p.scheme in {"http", "https"} and bool(p.netloc)
    except Exception:
        return False


async def _run_download_job(job_id: str, url: str, quality: str = "best") -> None:
    """Background task: download and update job state."""
    _jobs[job_id]["status"] = "running"

    async def on_progress(text: str, pct: float) -> None:
        _jobs[job_id]["text"] = text
        _jobs[job_id]["progress"] = pct

    try:
        path = await download_video(url, quality=quality, cache=_cache, on_progress=on_progress)
        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["file"] = str(path.resolve())
        _jobs[job_id]["progress"] = 100.0
        _jobs[job_id]["text"] = "✅ اكتمل التحميل"

        # Extra metadata and thumbnail extraction
        try:
            meta = get_video_metadata(path)
            _jobs[job_id]["duration"] = meta.get("duration", 0)
            _jobs[job_id]["width"] = meta.get("width", 0)
            _jobs[job_id]["height"] = meta.get("height", 0)

            # Generate thumbnail in same folder if it's a video
            if meta.get("width", 0) > 0 and meta.get("height", 0) > 0:
                thumb_path = path.with_name(f"{path.stem}_thumb.jpg")
                if generate_video_thumbnail(path, thumb_path):
                    _jobs[job_id]["thumbnail"] = str(thumb_path.resolve())
        except Exception as meta_exc:
            logger.error("Error generating metadata/thumbnail for job %s: %s", job_id, meta_exc)

    except Exception as exc:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(exc)
        _jobs[job_id]["text"] = "❌ فشل"
        logger.exception("Job %s failed", job_id)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.post("/download")
async def start_download(
    url: str = Query(..., description="Video URL to download"),
    quality: str = Query("best", description="Video quality: 144, 360, 480, 720, 1080, or best"),
    background_tasks=None,
    request: Request = None,
):
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="رابط غير صالح")

    # Validate quality value
    allowed_qualities = {"144", "360", "480", "720", "1080", "best"}
    if quality not in allowed_qualities:
        quality = "best"

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "pending",
        "file": None,
        "error": None,
        "progress": 0.0,
        "text": "⏳ في الانتظار...",
        "duration": 0,
        "width": 0,
        "height": 0,
        "thumbnail": None,
        "quality": quality,
    }

    # Fire the download task
    asyncio.create_task(_run_download_job(job_id, url, quality))

    return {"job_id": job_id, "status": "pending", "quality": quality}


@app.get("/result/{job_id}")
def get_result(job_id: str):
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/progress/{job_id}")
async def progress_stream(job_id: str):
    """Server-Sent Events stream for real-time progress."""
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            job = _jobs.get(job_id, {})
            data = {
                "status": job.get("status"),
                "progress": job.get("progress", 0),
                "text": job.get("text", ""),
            }
            yield f"data: {data}\n\n"

            if job.get("status") in ("done", "error"):
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
