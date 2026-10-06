from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import uuid

from job_queue.connection import get_redis_connection

logger = logging.getLogger("bot.polling_lock")

_LOCK_KEY = os.getenv("TELEGRAM_POLLING_LOCK_KEY", "telegram:polling:lease")
_LOCK_TTL_SECONDS = max(30, int(os.getenv("TELEGRAM_POLLING_LOCK_TTL_SECONDS", "90")))


class PollingLease:
    """Redis-backed singleton lease for Telegram long polling.

    When Redis is unavailable, local development remains usable and polling is
    allowed with a warning. In production, Redis prevents duplicate getUpdates
    consumers from causing Telegram 409 Conflict responses.
    """

    _renew_script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('expire', KEYS[1], ARGV[2])
    end
    return 0
    """

    _release_script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    end
    return 0
    """

    def __init__(self, key: str = _LOCK_KEY, ttl_seconds: int = _LOCK_TTL_SECONDS) -> None:
        self.key = key
        self.ttl_seconds = max(30, ttl_seconds)
        self.owner = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex}"
        self._redis = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active = False

    def acquire(self) -> bool:
        if self._active:
            return True

        conn = get_redis_connection()
        if conn is None:
            logger.warning("Redis unavailable; Telegram singleton lease cannot be enforced")
            self._active = True
            return True

        acquired = bool(conn.set(self.key, self.owner, nx=True, ex=self.ttl_seconds))
        if not acquired:
            return False

        self._redis = conn
        self._active = True
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._renew_loop,
            name="telegram-polling-lease",
            daemon=True,
        )
        self._thread.start()
        logger.info("Acquired Telegram polling lease %s", self.key)
        return True

    def _renew_loop(self) -> None:
        interval = max(10, self.ttl_seconds // 3)
        consecutive_errors = 0

        while not self._stop.wait(interval):
            try:
                renewed = self._redis.eval(
                    self._renew_script,
                    1,
                    self.key,
                    self.owner,
                    self.ttl_seconds,
                )
                if not renewed:
                    logger.critical("Telegram polling lease ownership was lost; terminating this bot instance")
                    os.kill(os.getpid(), signal.SIGTERM)
                    return
                consecutive_errors = 0
            except Exception:
                consecutive_errors += 1
                logger.exception("Failed to renew Telegram polling lease")
                if consecutive_errors >= 3:
                    logger.critical("Redis lease renewal repeatedly failed; terminating to avoid duplicate polling")
                    os.kill(os.getpid(), signal.SIGTERM)
                    return

    def release(self) -> None:
        if not self._active:
            return

        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)

        if self._redis is not None:
            try:
                self._redis.eval(self._release_script, 1, self.key, self.owner)
            except Exception:
                logger.exception("Failed to release Telegram polling lease")

        self._active = False
        self._redis = None
        self._thread = None
