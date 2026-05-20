"""
Video metadata extraction and thumbnail generation using ffprobe/ffmpeg.
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("metadata")


def get_video_metadata(video_path: Path | str) -> dict:
    """
    Get video duration, width, and height using ffprobe.
    Returns:
        dict: {"duration": int, "width": int, "height": int}
    """
    path = Path(video_path)
    if not path.exists():
        logger.warning("Video file not found for metadata: %s", video_path)
        return {"duration": 0, "width": 0, "height": 0}

    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json",
            str(path.resolve())
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)

        # Extract width and height from streams
        streams = data.get("streams", [])
        width = 0
        height = 0
        if streams:
            width = int(streams[0].get("width", 0))
            height = int(streams[0].get("height", 0))

        # Extract duration from format
        duration_str = data.get("format", {}).get("duration", "0")
        duration = int(float(duration_str))

        return {
            "duration": duration,
            "width": width,
            "height": height
        }
    except Exception as exc:
        logger.error("Failed to extract metadata for %s: %s", video_path, exc)
        return {"duration": 0, "width": 0, "height": 0}


def generate_video_thumbnail(video_path: Path | str, thumbnail_path: Path | str) -> bool:
    """
    Generate a JPEG thumbnail from the video using ffmpeg.
    Returns:
        bool: True if thumbnail was successfully generated, False otherwise.
    """
    video_path = Path(video_path)
    thumbnail_path = Path(thumbnail_path)

    if not video_path.exists():
        return False

    try:
        # Create parent directories if they don't exist
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            "ffmpeg",
            "-y",                     # Overwrite output file
            "-ss", "00:00:00",        # Seek to start
            "-i", str(video_path.resolve()),
            "-vframes", "1",          # Extract one frame
            "-q:v", "2",              # High quality (JPEG scale 1-31, 2 is very high)
            str(thumbnail_path.resolve())
        ]
        # Run ffmpeg
        subprocess.run(cmd, capture_output=True, check=True)
        return thumbnail_path.exists()
    except Exception as exc:
        logger.error("Failed to generate thumbnail for %s: %s", video_path, exc)
        return False
