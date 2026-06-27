from __future__ import annotations

from pydantic import BaseModel, Field


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    text: str = ""
    error: str | None = None
    url: str
    quality: str
    chat_id: int | None = None
    has_result: bool = False
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class JobResultResponse(BaseModel):
    job_id: str
    status: str
    media_type: str | None = None
    file: str | None = None
    duration: int = 0
    width: int = 0
    height: int = 0
    thumbnail: str | None = None
    completed_at: str | None = None


class JobFullResponse(BaseModel):
    job: JobStatusResponse
    result: JobResultResponse | None = None


class EnqueueResponse(BaseModel):
    job_id: str
    status: str = Field(default="queued")


class MediaDownloadRequest(BaseModel):
    url: str
    quality: str = "best"
    chat_id: int


class HealthResponse(BaseModel):
    status: str
    version: str
    engine: str
    queue: str
    result_store: str
