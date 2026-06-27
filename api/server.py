from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager

from api.schemas import (
    EnqueueResponse,
    HealthResponse,
    JobFullResponse,
    JobResultResponse,
    JobStatusResponse,
    MediaDownloadRequest,
)
from engine.media_engine import MediaEngine
from job_queue.connection import is_redis_available
from job_queue.job_store import JobStatus, get_job
from storage.result_store import get_result

logger = logging.getLogger("api")

_engine: MediaEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine
    _engine = MediaEngine()
    yield


app = FastAPI(title="Cloud Media Engine API", version="3.2.0", lifespan=lifespan)


def is_valid_url(value: str) -> bool:
    try:
        p = urlparse(value)
        return p.scheme in {"http", "https"} and bool(p.netloc)
    except Exception:
        return False


def _validate_quality(quality: str) -> str:
    allowed_qualities = {"144", "360", "480", "720", "1080", "best", "audio"}
    if quality not in allowed_qualities:
        return "best"
    return quality


async def _enqueue_job(
    url: str,
    quality: str,
    chat_id: int | None = None,
    job_id: str | None = None,
) -> str:
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="رابط غير صالح")

    quality = _validate_quality(quality)
    result = await _engine.submit(
        url,
        quality,
        job_id=job_id,
        chat_id=chat_id,
    )
    return result.job_id


def _build_status_response(job: dict) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=job["job_id"],
        status=job.get("status", JobStatus.QUEUED.value),
        progress=job.get("progress", 0.0),
        text=job.get("text", ""),
        error=job.get("error"),
        url=job.get("url", ""),
        quality=job.get("quality", "best"),
        chat_id=job.get("chat_id"),
        has_result=job.get("has_result", False),
        created_at=job.get("created_at", ""),
        updated_at=job.get("updated_at", ""),
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
    )


def _build_result_response(job_id: str, job: dict, result: dict | None) -> JobResultResponse:
    if result:
        return JobResultResponse(
            job_id=job_id,
            status=job.get("status", JobStatus.DONE.value),
            media_type=result.get("media_type"),
            file=result.get("file"),
            duration=result.get("duration", 0),
            width=result.get("width", 0),
            height=result.get("height", 0),
            thumbnail=result.get("thumbnail"),
            completed_at=result.get("completed_at"),
        )

    return JobResultResponse(
        job_id=job_id,
        status=job.get("status", JobStatus.QUEUED.value),
    )


def _fetch_job_or_404(job_id: str) -> dict:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/", response_model=HealthResponse)
def health():
    backend = "redis" if is_redis_available() else "memory"
    return HealthResponse(
        status="ok",
        version="3.2.0",
        engine="media-engine",
        queue=backend if is_redis_available() else "in-process-fallback",
        result_store=backend,
    )


@app.post("/media/download", response_model=EnqueueResponse)
async def create_media_job(body: MediaDownloadRequest):
    """Bot entry point – enqueue only, return job_id immediately."""
    job_id = await _enqueue_job(body.url, body.quality, body.chat_id)
    return EnqueueResponse(job_id=job_id, status="queued")


@app.post("/download", response_model=EnqueueResponse)
async def start_download(
    url: str = Query(..., description="Video URL to download"),
    quality: str = Query("best", description="Video quality: 144, 360, 480, 720, 1080, or best"),
):
    job_id = await _enqueue_job(url, quality)
    return EnqueueResponse(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Track job lifecycle – status, progress, timestamps."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    return _build_status_response(job)


@app.get("/jobs/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    """Fetch completed media result for a job."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    status = job.get("status")

    if status == JobStatus.ERROR.value:
        raise HTTPException(
            status_code=409,
            detail={"message": "Job failed", "error": job.get("error")},
        )

    if status != JobStatus.DONE.value:
        raise HTTPException(
            status_code=202,
            detail={"message": "Result not ready", "status": status},
        )

    result = await asyncio.to_thread(get_result, job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")

    return _build_result_response(job_id, job, result)


@app.get("/jobs/{job_id}/full", response_model=JobFullResponse)
async def get_job_full(job_id: str):
    """Combined job status + result (if available)."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    result = await asyncio.to_thread(get_result, job_id)
    return JobFullResponse(
        job=_build_status_response(job),
        result=_build_result_response(job_id, job, result) if result else None,
    )


@app.get("/result/{job_id}")
async def get_result_legacy(job_id: str):
    """Legacy combined payload for backward compatibility."""
    job = await asyncio.to_thread(_fetch_job_or_404, job_id)
    result = await asyncio.to_thread(get_result, job_id)

    payload = dict(job)
    if result:
        payload.update(
            {
                "file": result.get("file"),
                "media_type": result.get("media_type"),
                "duration": result.get("duration", 0),
                "width": result.get("width", 0),
                "height": result.get("height", 0),
                "thumbnail": result.get("thumbnail"),
            }
        )
    return payload


@app.get("/progress/{job_id}")
async def progress_stream(job_id: str):
    """Server-Sent Events stream for real-time progress."""
    initial = await asyncio.to_thread(get_job, job_id)
    if initial is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            job = await asyncio.to_thread(get_job, job_id) or {}
            data = {
                "status": job.get("status"),
                "progress": job.get("progress", 0),
                "text": job.get("text", ""),
                "has_result": job.get("has_result", False),
            }
            yield f"data: {data}\n\n"

            if job.get("status") in (JobStatus.DONE.value, JobStatus.ERROR.value):
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
