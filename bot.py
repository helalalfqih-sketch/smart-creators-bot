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

# ── Prevent multiple bot instances on same host ──────────────────────────────
import socket
import sys

_lock_socket = None


def _acquire_instance_lock() -> None:
    global _lock_socket
    _lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _lock_socket.bind(("127.0.0.1", 18492))
    except socket.error:
        print("⚠️ Another bot.py instance is already running on this container. Exiting duplicate.")
        sys.exit(0)


_acquire_instance_lock()

from bot.telegram_bot import main  # noqa: E402

if __name__ == "__main__":
    main()
