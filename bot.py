"""
Entry point: Telegram Bot (polling mode).

Run with:
    python bot.py
"""
import os
from pathlib import Path


def _load_env(env_path: Path = Path(".env")) -> None:
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env()

# Prevent duplicate bot instances on the same container.
import socket
import sys

_lock_socket = None


def _acquire_instance_lock() -> None:
    global _lock_socket
    _lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _lock_socket.bind(("127.0.0.1", 18492))
    except socket.error:
        print("Another bot.py instance is already running on this container. Exiting duplicate.")
        sys.exit(0)


_acquire_instance_lock()

# Render rolling deploys can briefly run old and new containers at the same time.
# Telegram long polling permits only one getUpdates consumer, so enforce a second
# Redis-backed process lock across containers before importing/starting the bot.
import threading
import time
import uuid

_process_lock_key = "media:telegram:process_lock"
_process_lock_value = str(uuid.uuid4())
_process_lock_conn = None
_process_lock_stop = threading.Event()


def _acquire_distributed_lock() -> None:
    global _process_lock_conn
    try:
        from job_queue.connection import get_redis_connection
        _process_lock_conn = get_redis_connection()
    except Exception:
        _process_lock_conn = None

    if _process_lock_conn is None:
        return

    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            if _process_lock_conn.set(
                _process_lock_key,
                _process_lock_value,
                nx=True,
                ex=45,
            ):
                return
        except Exception:
            return
        time.sleep(2)

    print("Another Telegram poller owns the distributed lock. Exiting duplicate.")
    sys.exit(0)


def _refresh_distributed_lock() -> None:
    while not _process_lock_stop.wait(10):
        conn = _process_lock_conn
        if conn is None:
            return
        try:
            current = conn.get(_process_lock_key)
            if isinstance(current, bytes):
                current = current.decode("utf-8")
            if current != _process_lock_value:
                return
            conn.expire(_process_lock_key, 45)
        except Exception:
            return


def _release_distributed_lock() -> None:
    _process_lock_stop.set()
    conn = _process_lock_conn
    if conn is None:
        return
    try:
        current = conn.get(_process_lock_key)
        if isinstance(current, bytes):
            current = current.decode("utf-8")
        if current == _process_lock_value:
            conn.delete(_process_lock_key)
    except Exception:
        pass


_acquire_distributed_lock()
if _process_lock_conn is not None:
    threading.Thread(target=_refresh_distributed_lock, daemon=True).start()

from bot.telegram_bot import main  # noqa: E402

if __name__ == "__main__":
    try:
        main()
    finally:
        _release_distributed_lock()
