"""
Async yt-dlp worker with:
  - Concurrent download limiting (semaphore)
  - Real-time progress callbacks
  - Cache integration
  - File-size enforcement
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import Callable, Awaitable

from core.cache import CacheProtocol


from core.config import (
    DOWNLOAD_DIR,
    MAX_CONCURRENT_DOWNLOADS,
    MAX_FILESIZE_MB,
    YTDLP_FORMAT,
)
from engine.extractors.smart_extractor import SmartExtractor

logger = logging.getLogger("worker")

# Semaphore limits parallel yt-dlp processes
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)

ProgressCallback = Callable[[str, float], Awaitable[None]]
"""Signature: (status_text, percent_0_to_100) -> None"""

# Quality → yt-dlp format string
# TikTok serves mp4 as the video container. Filtering by ext=mp4 is more
# reliable than vcodec!='none' because TikTok uses bytevc1 which yt-dlp
# may not recognize in vcodec filters. --merge-output-format mp4 handles muxing.
_QUALITY_FORMAT: dict[str, str] = {
    "144":  "best[height<=144][ext=mp4]/best[height<=360][ext=mp4]/best[ext=mp4]/best",
    "360":  "best[height<=360][ext=mp4]/best[ext=mp4]/best",
    "480":  "best[height<=480][ext=mp4]/best[ext=mp4]/best",
    "720":  "best[height<=720][ext=mp4]/best[ext=mp4]/best",
    "1080": "best[height<=1080][ext=mp4]/best[ext=mp4]/best",
    "best": "best[ext=mp4]/best",
    "audio": "bestaudio/best",   # audio-only → will be sent as voice/audio message
}


# Bump this version when format strings change to invalidate all stale cache entries
_CACHE_VERSION = "v4"

def _url_cache_key(url: str) -> str:
    return f"dl:{_CACHE_VERSION}:" + hashlib.sha256(url.encode()).hexdigest()


async def download_video(
    url: str,
    *,
    quality: str = "best",
    cache: CacheProtocol | None = None,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """
    Download *url* with yt-dlp, returning the local Path.

    Checks the cache first; caches the result on success.
    Calls *on_progress* with (text, percent) periodically.
    The *quality* parameter can be: '144', '360', '480', '720', '1080', or 'best'.
    """
    cache_key = _url_cache_key(url) + f":{quality}"

    # ── Cache hit ─────────────────────────────────────────────────────────────
    if cache is not None:
        cached = await cache.get(cache_key)
        if cached:
            cached_path = Path(cached)
            if cached_path.exists():
                logger.info("Cache hit for %s", url)
                if on_progress:
                    await on_progress("📦 من الكاش", 100.0)
                return cached_path
            else:
                await cache.delete(cache_key)  # stale entry

    # ── Download ──────────────────────────────────────────────────────────────
    file_id = str(uuid.uuid4())
    out_template = str(DOWNLOAD_DIR / f"{file_id}.%(ext)s")
    max_bytes = MAX_FILESIZE_MB * 1024 * 1024
    fmt = _QUALITY_FORMAT.get(quality, YTDLP_FORMAT)
    extractor = SmartExtractor()

    async with _semaphore:
        if on_progress:
            await on_progress("🔍 جاري الجلب...", 0.0)

        loop = asyncio.get_running_loop()
        last_percent = 0.0

        def handle_line(line: str) -> None:
            nonlocal last_percent
            if "[download]" in line and "%" in line and on_progress:
                try:
                    pct_str = line.split("%")[0].split()[-1]
                    pct = float(pct_str)
                    if pct - last_percent >= 10:
                        last_percent = pct
                        asyncio.run_coroutine_threadsafe(
                            on_progress(f"⬇️ تحميل... {pct:.0f}%", pct),
                            loop,
                        )
                except ValueError:
                    pass

        def run_extractor_sync() -> tuple[int, list[str]]:
            try:
                result = extractor.extract(
                    url,
                    out_template=out_template,
                    format_string=fmt,
                    max_bytes=max_bytes,
                    on_line=handle_line,
                )
                return 0, result.output_lines
            except RuntimeError as exc:
                return 1, str(exc).splitlines()

        returncode, output_lines = await asyncio.to_thread(run_extractor_sync)

        if returncode != 0:
            tail = "\n".join(output_lines[-15:])
            raise RuntimeError(f"yt-dlp فشل:\n{tail[:800]}")

    # ── Find output file ──────────────────────────────────────────────────────
    matches = sorted(DOWNLOAD_DIR.glob(f"{file_id}.*"))
    if not matches:
        raise RuntimeError("انتهى التحميل لكن الملف غير موجود.")

    result_path = matches[0]

    # ── Cache the result ──────────────────────────────────────────────────────
    if cache is not None:
        await cache.set(cache_key, str(result_path))

    return result_path



# ── Cleanup helper ────────────────────────────────────────────────────────────

async def cleanup_file(path: Path) -> None:
    """Delete a downloaded file asynchronously."""
    try:
        await asyncio.to_thread(os.remove, path)
        logger.info("Deleted %s", path)
    except OSError as exc:
        logger.warning("Could not delete %s: %s", path, exc)


# ── Video Enhancement ─────────────────────────────────────────────────────────

async def enhance_video(
    input_path: Path,
    *,
    target_height: int = 1080,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """
    Enhance video quality using FFmpeg professional filters:
      - hqdn3d: High quality 3D denoiser (removes noise/grain)
      - unsharp: Sharpens edges and fine details
      - scale: Upscales using Lanczos algorithm (best quality)
      - loudnorm: Normalizes audio levels

    Returns the enhanced file path (new file, input is preserved).
    """
    if on_progress:
        await on_progress("✨ جاري تحسين الجودة...", 0.0)

    out_path = input_path.parent / f"{input_path.stem}_enhanced.mp4"

    # Determine if file has video stream
    is_audio = input_path.suffix.lower() in {".mp3", ".m4a", ".wav", ".ogg", ".flac"}

    if is_audio:
        # Audio-only: just normalize loudness
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-c:a", "aac", "-b:a", "192k",
            str(out_path),
        ]
    else:
        # Video: denoise → sharpen only (no upscaling to keep file size manageable)
        vf_filters = (
            "hqdn3d=3:2:4:3.5,"           # lighter noise reduction
            "unsharp=3:3:0.8:3:3:0.0"     # sharpen edges (no chroma sharpen)
        )
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-vf", vf_filters,
            "-c:v", "libx264",
            "-preset", "veryfast",         # faster encoding
            "-crf", "22",                  # balanced quality/size
            "-c:a", "copy",                # copy audio without re-encoding (faster)
            str(out_path),
        ]

    # Capture the running loop BEFORE entering the thread
    loop = asyncio.get_running_loop()

    def run_ffmpeg() -> int:
        import subprocess
        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        for line in proc.stdout:
            # Use the captured loop from the async context
            if "time=" in line and on_progress:
                try:
                    asyncio.run_coroutine_threadsafe(
                        on_progress("✨ جاري تحسين الجودة...", 50.0),
                        loop,
                    )
                except Exception:
                    pass
        proc.wait()
        return proc.returncode

    returncode = await asyncio.to_thread(run_ffmpeg)


    if returncode != 0 or not out_path.exists():
        logger.warning("FFmpeg enhancement failed, returning original file")
        return input_path  # fallback to original

    if on_progress:
        await on_progress("✅ تم تحسين الجودة!", 100.0)

    logger.info("Enhanced video saved to %s", out_path)
    return out_path

