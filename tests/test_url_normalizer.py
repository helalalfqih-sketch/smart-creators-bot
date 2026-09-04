import unittest
from core.url_normalizer import (
    clear_active_job_for_url,
    get_active_job_for_url,
    normalize_media_url,
    set_active_job_for_url,
    url_hash,
)


class UrlNormalizerTests(unittest.TestCase):
    def test_normalize_strips_tracking_params(self):
        raw = "https://www.tiktok.com/@user/video/123456789?utm_source=copy&utm_medium=android&fbclid=abc123xyz&igshid=def456&si=ghi789"
        expected = "https://www.tiktok.com/@user/video/123456789"
        self.assertEqual(normalize_media_url(raw), expected)

    def test_normalize_preserves_legitimate_params(self):
        raw = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_campaign=share&feature=related"
        norm = normalize_media_url(raw)
        self.assertIn("v=dQw4w9WgXcQ", norm)
        self.assertNotIn("utm_campaign", norm)
        self.assertNotIn("feature", norm)

    def test_normalize_strips_trailing_slash_and_lowercases_host(self):
        raw = "HTTPS://WWW.Instagram.COM/reel/CxYz123/"
        expected = "https://www.instagram.com/reel/CxYz123"
        self.assertEqual(normalize_media_url(raw), expected)

    def test_url_hash_deterministic(self):
        url1 = "https://vm.tiktok.com/ZM8abc/?utm_source=app"
        url2 = "https://vm.tiktok.com/ZM8abc"
        self.assertEqual(url_hash(url1), url_hash(url2))

    def test_active_job_lifecycle(self):
        test_url = "https://youtube.com/shorts/test_lifecycle_123"
        # Ensure clean initial state
        clear_active_job_for_url(test_url)
        self.assertIsNone(get_active_job_for_url(test_url))

        # Set active job
        set_active_job_for_url(test_url, "job-9988-active")
        self.assertEqual(get_active_job_for_url(test_url), "job-9988-active")

        # Different URL variation maps to same active job
        variant_url = "https://youtube.com/shorts/test_lifecycle_123?utm_source=tg"
        self.assertEqual(get_active_job_for_url(variant_url), "job-9988-active")

        # Clear active job
        clear_active_job_for_url(test_url)
        self.assertIsNone(get_active_job_for_url(test_url))


if __name__ == "__main__":
    unittest.main()
