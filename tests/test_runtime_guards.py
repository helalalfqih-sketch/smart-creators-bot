import sys
import unittest
from unittest.mock import patch

from bot.polling_lock import PollingLease
from engine.extractors.smart_extractor import SmartExtractor


class _FakeRedis:
    def __init__(self, acquire=True):
        self.acquire = acquire
        self.calls = []

    def set(self, key, value, *, nx, ex):
        self.calls.append(("set", key, value, nx, ex))
        return self.acquire

    def eval(self, script, numkeys, *args):
        self.calls.append(("eval", numkeys, args))
        return 1


class RuntimeGuardTests(unittest.TestCase):
    def test_yt_dlp_uses_active_python_interpreter(self):
        cmd = SmartExtractor()._common_args(
            "https://example.com/video",
            "/tmp/%(id)s.%(ext)s",
            "best",
            10_000_000,
        )
        self.assertEqual(cmd[:3], [sys.executable, "-m", "yt_dlp"])

    def test_polling_lease_acquires_and_releases(self):
        redis = _FakeRedis(acquire=True)
        with patch("bot.polling_lock.get_redis_connection", return_value=redis):
            lease = PollingLease(key="test:telegram:lease", ttl_seconds=90)
            self.assertTrue(lease.acquire())
            lease.release()

        self.assertEqual(redis.calls[0][0], "set")
        self.assertTrue(any(call[0] == "eval" for call in redis.calls))

    def test_polling_lease_refuses_duplicate_owner(self):
        redis = _FakeRedis(acquire=False)
        with patch("bot.polling_lock.get_redis_connection", return_value=redis):
            lease = PollingLease(key="test:telegram:lease", ttl_seconds=90)
            self.assertFalse(lease.acquire())


if __name__ == "__main__":
    unittest.main()
