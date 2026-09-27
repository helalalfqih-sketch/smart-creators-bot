from __future__ import annotations

import mimetypes
import hashlib
import uuid
from pathlib import Path

from core.config import (
    MEDIA_STORAGE_DRIVER,
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT_URL,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
    S3_SIGNED_URL_TTL_SECONDS,
)


class ObjectStorageConfigurationError(RuntimeError):
    """Raised when private object storage is requested but incomplete."""


def _client():
    if MEDIA_STORAGE_DRIVER != "s3":
        raise ObjectStorageConfigurationError("MEDIA_STORAGE_DRIVER is not 's3'")

    missing = [
        name
        for name, value in (
            ("S3_BUCKET", S3_BUCKET),
            ("S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID),
            ("S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY),
        )
        if not value
    ]
    if missing:
        raise ObjectStorageConfigurationError(
            f"Missing private object storage settings: {', '.join(missing)}"
        )

    import boto3

    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL or None,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY_ID,
        aws_secret_access_key=S3_SECRET_ACCESS_KEY,
    )


def upload_private_file(path: Path, *, job_id: str, kind: str) -> str:
    """Upload an existing regular file privately and return its opaque object key."""
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Object storage upload source must be a regular file")

    suffix = resolved.suffix.lower()
    safe_job_key = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    key = f"jobs/{safe_job_key}/{kind}-{uuid.uuid4().hex}{suffix}"
    content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
    _client().upload_file(
        str(resolved),
        S3_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def create_signed_download_url(key: str) -> str:
    """Create a short-lived URL for one private object."""
    if not key or key.startswith("/") or ".." in Path(key).parts:
        raise ValueError("Invalid object key")
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=S3_SIGNED_URL_TTL_SECONDS,
    )


def delete_private_object(key: str) -> None:
    """Delete a private object during rollback or lifecycle cleanup."""
    if not key or key.startswith("/") or ".." in Path(key).parts:
        raise ValueError("Invalid object key")
    _client().delete_object(Bucket=S3_BUCKET, Key=key)
