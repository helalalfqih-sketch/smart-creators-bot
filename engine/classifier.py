from __future__ import annotations

import os

VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov", ".3gp", ".avi"}
AUDIO_EXT = {".mp3", ".aac", ".wav", ".m4a", ".ogg", ".flac", ".opus"}


def classify(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()

    if ext in AUDIO_EXT:
        return "audio"

    if ext in VIDEO_EXT:
        return "video"

    return "unknown"
