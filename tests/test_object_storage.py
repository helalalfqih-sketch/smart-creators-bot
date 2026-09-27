from __future__ import annotations

import tempfile
import unittest
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch

from storage import object_store
from storage import result_store


class ObjectStorageTests(unittest.TestCase):
    def test_private_upload_uses_opaque_job_key_and_content_type(self):
        client = MagicMock()
        with tempfile.NamedTemporaryFile(suffix=".mp4") as fixture:
            with patch.object(object_store, "_client", return_value=client):
                key = object_store.upload_private_file(
                    Path(fixture.name), job_id="job-123", kind="media"
                )

        safe_job_key = hashlib.sha256(b"job-123").hexdigest()
        self.assertTrue(key.startswith(f"jobs/{safe_job_key}/media-"))
        self.assertTrue(key.endswith(".mp4"))
        client.upload_file.assert_called_once()
        args = client.upload_file.call_args.args
        kwargs = client.upload_file.call_args.kwargs
        self.assertEqual(args[1], object_store.S3_BUCKET)
        self.assertEqual(args[2], key)
        self.assertEqual(kwargs["ExtraArgs"]["ContentType"], "video/mp4")

    def test_result_read_generates_fresh_signed_urls_from_private_keys(self):
        record = {
            "job_id": "job-123",
            "file": "",
            "thumbnail": None,
            "storage_key": "jobs/job-123/media-a.mp4",
            "thumbnail_storage_key": "jobs/job-123/thumbnail-b.jpg",
        }
        with patch.object(
            result_store,
            "create_signed_download_url",
            side_effect=lambda key: f"https://signed.example/{key}?temporary=1",
        ):
            hydrated = result_store._with_fresh_signed_urls(record)

        self.assertIn("media-a.mp4?temporary=1", hydrated["file"])
        self.assertIn("thumbnail-b.jpg?temporary=1", hydrated["thumbnail"])
        self.assertEqual(record["file"], "")

    def test_rejects_traversal_object_key(self):
        with self.assertRaises(ValueError):
            object_store.create_signed_download_url("jobs/../secret")

    def test_job_id_cannot_create_traversal_key(self):
        client = MagicMock()
        with tempfile.NamedTemporaryFile(suffix=".mp4") as fixture:
            with patch.object(object_store, "_client", return_value=client):
                key = object_store.upload_private_file(
                    Path(fixture.name), job_id="../../escape", kind="media"
                )
        self.assertNotIn("..", key)
        self.assertNotIn("escape", key)

    def test_delete_private_object_targets_configured_bucket(self):
        client = MagicMock()
        with patch.object(object_store, "_client", return_value=client):
            object_store.delete_private_object("jobs/job-123/media-a.mp4")
        client.delete_object.assert_called_once_with(
            Bucket=object_store.S3_BUCKET,
            Key="jobs/job-123/media-a.mp4",
        )


if __name__ == "__main__":
    unittest.main()
