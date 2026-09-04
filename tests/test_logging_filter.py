import unittest
from core.logging_filter import redact_text


class LoggingFilterTests(unittest.TestCase):
    def test_redact_telegram_bot_token(self):
        sample = "Connecting with token 1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567 to Telegram"
        cleaned = redact_text(sample)
        self.assertNotIn("1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567", cleaned)
        self.assertIn("[REDACTED_BOT_TOKEN]", cleaned)

    def test_redact_chat_id(self):
        sample = "TELEGRAM_UPDATE_RECEIVED update_id=123 chat_id=5660048569 status=ok"
        cleaned = redact_text(sample)
        self.assertNotIn("5660048569", cleaned)
        self.assertIn("chat_id=***8569", cleaned)

    def test_redact_redis_auth(self):
        sample = "Connecting to redis://default:secretPassword123@redis-service:6379/0"
        cleaned = redact_text(sample)
        self.assertNotIn("secretPassword123", cleaned)
        self.assertIn("redis://***@redis-service:6379/0", cleaned)

    def test_redact_sensitive_url_query(self):
        sample = "Uploaded to https://r2.cloudflarestorage.com/media/test.mp4?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D"
        cleaned = redact_text(sample)
        self.assertNotIn("Signature=", cleaned)
        self.assertIn("[REDACTED_URL]", cleaned)
        self.assertNotIn("r2.cloudflarestorage.com", cleaned)

    def test_redact_s3_key(self):
        sample = "Using S3 access key AKIAIOSFODNN7EXAMPLE for upload"
        cleaned = redact_text(sample)
        self.assertNotIn("AKIAIOSFODNN7EXAMPLE", cleaned)
        self.assertIn("[REDACTED_S3_KEY]", cleaned)


if __name__ == "__main__":
    unittest.main()
