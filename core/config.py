"""
Central configuration – loaded once from environment variables.
"""
from __future__ import annotations

import os
from pathlib import Path

# Load .env file if present (local dev OR Railway with .env committed)
try:
    from dotenv import load_dotenv, find_dotenv
    load_dotenv(find_dotenv(usecwd=True), override=False)
except ImportError:
    pass  # python-dotenv not installed – rely on system env vars


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


# ── Telegram ──────────────────────────────────────────────────────────────────
BOT_TOKEN: str = (
    _env("TELEGRAM_BOT_TOKEN") or _env("BOT_TOKEN") or _env("TOKEN")
)

# ── FastAPI / Worker ──────────────────────────────────────────────────────────
API_HOST: str = _env("API_HOST", "0.0.0.0")
API_PORT: int = int(_env("API_PORT", "8000"))
DOWNLOAD_API_URL: str = _env("DOWNLOAD_API_URL", "http://127.0.0.1:8000")

# ── yt-dlp ────────────────────────────────────────────────────────────────────
DOWNLOAD_DIR: Path = Path(_env("DOWNLOAD_DIR", "downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

YTDLP_FORMAT: str = _env("YTDLP_FORMAT", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best")
MAX_FILESIZE_MB: int = int(_env("MAX_FILESIZE_MB", "50"))   # Telegram limit for bots
MAX_CONCURRENT_DOWNLOADS: int = int(_env("MAX_CONCURRENT_DOWNLOADS", "3"))

# ── Redis (optional) ──────────────────────────────────────────────────────────
REDIS_URL: str = _env("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_SECONDS: int = int(_env("CACHE_TTL_SECONDS", "3600"))  # 1 hour

# ── Misc ──────────────────────────────────────────────────────────────────────
HTTP_TIMEOUT_SECONDS: int = int(_env("HTTP_TIMEOUT_SECONDS", "300"))
LOG_LEVEL: str = _env("LOG_LEVEL", "INFO").upper()
