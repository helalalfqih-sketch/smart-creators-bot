"""
core/captions.py — Professional TikTok-style captions pipeline

Steps:
  1. transcribe_video()  → faster-whisper word-level timestamps
  2. generate_ass()      → ASS karaoke file (golden highlight per word)
  3. burn_captions()     → FFmpeg renders video + captions + watermark
"""
from __future__ import annotations

import asyncio
import logging
import os
import textwrap
from pathlib import Path
from typing import Callable, Awaitable

logger = logging.getLogger("captions")

ProgressCallback = Callable[[str, float], Awaitable[None]]

# ── Whisper model (loaded once and cached) ────────────────────────────────────
_whisper_model = None


def _get_whisper_model():
    """Lazy-load faster-whisper model (tiny for speed, CPU-friendly)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        logger.info("Loading Whisper tiny model...")
        _whisper_model = WhisperModel(
            "tiny",
            device="cpu",
            compute_type="int8",   # smallest memory footprint
        )
        logger.info("Whisper model loaded.")
    return _whisper_model


# ── Step 1: Transcribe ────────────────────────────────────────────────────────

def _transcribe_sync(video_path: Path) -> list[dict]:
    """
    Run faster-whisper on the video/audio file.
    Returns list of word dicts: {word, start, end}
    """
    model = _get_whisper_model()
    segments, info = model.transcribe(
        str(video_path),
        word_timestamps=True,
        vad_filter=True,          # skip silence
        language=None,            # auto-detect Arabic/English
    )
    logger.info("Detected language: %s (%.0f%%)", info.language, info.language_probability * 100)

    words = []
    for segment in segments:
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                })
    return words


async def transcribe_video(
    video_path: Path,
    on_progress: ProgressCallback | None = None,
) -> list[dict]:
    """Async wrapper for Whisper transcription."""
    if on_progress:
        await on_progress("🎤 جاري تفريغ الكلام...", 10.0)
    words = await asyncio.to_thread(_transcribe_sync, video_path)
    if on_progress:
        await on_progress(f"✅ تم التفريغ ({len(words)} كلمة)", 40.0)
    return words


# ── Step 2: Generate ASS file ────────────────────────────────────────────────

def _seconds_to_ass(t: float) -> str:
    """Convert seconds to ASS timestamp format H:MM:SS.cc"""
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int((t % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_ass(
    words: list[dict],
    watermark: str = "",
    font_name: str = "Noto Sans Arabic",
    font_size: int = 22,
    highlight_color: str = "00D7FF",   # golden-yellow in BGR (ASS uses BGR)
    words_per_line: int = 5,
) -> str:
    """
    Generate ASS subtitle content with karaoke-style word highlighting.

    Each line groups up to `words_per_line` words. The active word is
    highlighted in gold; others are white. A subtle watermark is placed
    bottom-right.
    """
    # ASS header
    ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font_name},{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,2,2,30,30,80,1
Style: Watermark,{font_name},14,&H80FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,3,30,30,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Group words into lines
    groups: list[list[dict]] = []
    i = 0
    while i < len(words):
        groups.append(words[i:i + words_per_line])
        i += words_per_line

    for group in groups:
        if not group:
            continue
        line_start = group[0]["start"]
        line_end = group[-1]["end"]

        # Build karaoke line: {{\\k<duration>}}word for each word
        karaoke_parts = []
        for w in group:
            dur_cs = max(1, int((w["end"] - w["start"]) * 100))
            # Active word: highlight color + scale up slightly
            karaoke_parts.append(
                f"{{\\k{dur_cs}\\c&H{highlight_color}&}}{w['word']}{{\\c&HFFFFFF&}} "
            )
        line_text = "".join(karaoke_parts).strip()

        ass += (
            f"Dialogue: 0,{_seconds_to_ass(line_start)},{_seconds_to_ass(line_end)},"
            f"Caption,,0,0,0,,{line_text}\n"
        )

    # Watermark (shown throughout — 0:00:00.00 to 9:59:59.99)
    if watermark:
        safe_wm = watermark.replace("\\", "\\\\").replace("{", "\\{")
        ass += (
            f"Dialogue: 0,0:00:00.00,9:59:59.99,"
            f"Watermark,,0,0,0,,{safe_wm}\n"
        )

    return ass


# ── Step 3: Burn captions into video ─────────────────────────────────────────

def _burn_sync(video_path: Path, ass_path: Path, output_path: Path) -> int:
    import subprocess
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vf", f"ass={ass_path}",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "copy",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("FFmpeg error: %s", result.stderr[-500:])
    return result.returncode


async def burn_captions(
    video_path: Path,
    ass_content: str,
    output_path: Path,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """Write ASS file and burn into video with FFmpeg."""
    if on_progress:
        await on_progress("🎨 جاري تضمين الكابشن...", 70.0)

    ass_path = video_path.parent / f"{video_path.stem}_captions.ass"
    ass_path.write_text(ass_content, encoding="utf-8")

    returncode = await asyncio.to_thread(_burn_sync, video_path, ass_path, output_path)

    # Cleanup ASS file
    try:
        ass_path.unlink()
    except OSError:
        pass

    if returncode != 0 or not output_path.exists():
        logger.warning("Caption burning failed, returning original")
        return video_path

    if on_progress:
        await on_progress("✅ الفيديو الاحترافي جاهز!", 100.0)

    return output_path


# ── Full pipeline ─────────────────────────────────────────────────────────────

async def make_pro_video(
    video_path: Path,
    watermark: str,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """
    Full pipeline: transcribe → ASS → burn captions + watermark.
    Returns path to the final professional video.
    """
    output_path = video_path.parent / f"{video_path.stem}_pro.mp4"

    # Step 1: Transcribe
    words = await transcribe_video(video_path, on_progress=on_progress)

    if not words:
        logger.warning("No words transcribed — adding watermark only")

    # Step 2: Generate ASS
    if on_progress:
        await on_progress("📝 جاري إنشاء الكابشن...", 50.0)
    ass_content = generate_ass(words, watermark=watermark)

    # Step 3: Burn
    result = await burn_captions(video_path, ass_content, output_path, on_progress=on_progress)
    return result
