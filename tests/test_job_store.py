from __future__ import annotations

import unittest
from job_queue import job_store


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        job_store._memory_jobs.clear()

    def test_job_lifecycle_transitions(self):
        job_id = "test_job_123"
        job = job_store.create_job(job_id, url="https://example.com/video", quality="best", chat_id=999)
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["progress"], 0.0)

        running = job_store.mark_running(job_id, text="Downloading", progress=45.0)
        self.assertEqual(running["status"], "running")
        self.assertEqual(running["progress"], 45.0)
        self.assertIsNotNone(running["started_at"])

        ready = job_store.mark_ready(job_id)
        self.assertEqual(ready["status"], "ready")
        self.assertIsNone(ready["completed_at"])

        done = job_store.mark_done(job_id)
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["progress"], 100.0)
        self.assertIsNotNone(done["completed_at"])
        self.assertTrue(done["has_result"])

    def test_job_error_transition(self):
        job_id = "test_job_err"
        job_store.create_job(job_id, url="https://example.com/err", quality="720")
        failed = job_store.mark_error(job_id, error="Fatal network failure")
        self.assertEqual(failed["status"], "error")
        self.assertEqual(failed["error"], "Fatal network failure")
        self.assertIsNotNone(failed["completed_at"])


if __name__ == "__main__":
    unittest.main()
