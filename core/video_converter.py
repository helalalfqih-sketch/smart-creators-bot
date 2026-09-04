from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from core.config import (
    VIDEO_CONVERSION_CONCURRENCY,
    VIDEO_CONVERSION_TIMEOUT_SECONDS,
    VIDEO_FPS_MODE,
    VIDEO_OUTPUT_CODEC,
    VIDEO_OUTPUT_CRF,
    VIDEO_OUTPUT_ENABLED,
    VIDEO_OUTPUT_FIT,
    VIDEO_OUTPUT_FPS,
    VIDEO_OUTPUT_PRESET,
    VIDEO_OUTPUT_RESOLUTION,
)

logger = logging.getLogger("video_converter")
_conversion_slots = asyncio.Semaphore(max(1, VIDEO_CONVERSION_CONCURRENCY))

# 4K HEVC is extremely memory-hungry with libx265 defaults because it creates
# multiple frame/thread pools. The Render worker is intentionally constrained to
# one encoder/filter thread so a 2160x3840 frame cannot make the container OOM.
_SAFE_ENCODER_THREADS = 1
_SAFE_X265_PARAMS = "pools=1:frame-threads=1:wpp=0"
_FAST_PRESETS = {"ultrafast", "superfast", "veryfast"}


@dataclass(frozen=True)
class VideoProbe:
    width: int
    height: int
    fps: float
    video_codec: str
    pixel_format: str
    container: str
    has_audio: bool
    duration: int
    audio_codec: str = ""
    audio_sample_rate: int = 0
    audio_channels: int = 0


def _rate(value: str | None) -> float:
    try:
        return float(Fraction(value or "0/1"))
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_video(path: Path) -> VideoProbe:
    """Probe media internally; probe output is never exposed to Telegram users."""
    command = [
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(path.resolve()),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("No video stream")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    format_data = data.get("format", {})
    try:
        audio_rate = int(audio.get("sample_rate") or 0) if audio else 0
    except (TypeError, ValueError):
        audio_rate = 0
    return VideoProbe(
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        fps=_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        video_codec=str(video.get("codec_name") or ""),
        pixel_format=str(video.get("pix_fmt") or ""),
        container=str(format_data.get("format_name") or ""),
        has_audio=audio is not None,
        duration=max(0, int(float(format_data.get("duration") or 0))),
        audio_codec=str(audio.get("codec_name") or "") if audio else "",
        audio_sample_rate=audio_rate,
        audio_channels=int(audio.get("channels") or 0) if audio else 0,
    )


def _target_dimensions(probe: VideoProbe) -> tuple[int, int]:
    return (2160, 3840) if probe.height > probe.width else (3840, 2160)


def _spatial_at_least_target(probe: VideoProbe) -> bool:
    target_w, target_h = _target_dimensions(probe)
    return probe.width >= target_w and probe.height >= target_h


def _already_at_least_target(probe: VideoProbe) -> bool:
    return _spatial_at_least_target(probe) and probe.fps >= VIDEO_OUTPUT_FPS


def _audio_is_output_compatible(probe: VideoProbe) -> bool:
    # Unknown legacy probe values are treated as compatible for remux decisions;
    # real ffprobe results populate these fields and force normalization when needed.
    if not probe.has_audio or not probe.audio_codec:
        return True
    return (
        probe.audio_codec in {"aac", "aac_latm"}
        and probe.audio_sample_rate == 44100
        and probe.audio_channels == 2
    )


def _can_remux_only(probe: VideoProbe) -> bool:
    return (
        _already_at_least_target(probe)
        and probe.video_codec in {"hevc", "h265"}
        and probe.pixel_format == "yuv420p"
        and any(name in probe.container for name in ("mp4", "mov"))
        and _audio_is_output_compatible(probe)
    )


def _resource_safe_preset() -> str:
    """Never allow a slow x265 preset to exhaust the small production worker."""
    requested = str(VIDEO_OUTPUT_PRESET or "").strip().lower()
    return requested if requested in _FAST_PRESETS else "veryfast"


def build_ffmpeg_command(input_path: Path, output_path: Path, probe: VideoProbe) -> list[str]:
    # Log only errors: retaining FFmpeg's continuous progress stderr in a Python
    # PIPE for a long 4K conversion needlessly grows the worker's RSS.
    base = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-threads", str(_SAFE_ENCODER_THREADS),
        "-filter_threads", "1",
        "-i", str(input_path.resolve()),
    ]
    if _can_remux_only(probe):
        return base + [
            "-map", "0:v:0", "-map", "0:a?", "-c", "copy",
            "-tag:v", "hvc1", "-movflags", "+faststart", str(output_path.resolve()),
        ]

    filters: list[str] = []
    if not _spatial_at_least_target(probe):
        target_w, target_h = _target_dimensions(probe)
        if VIDEO_OUTPUT_FIT == "crop":
            filters.append(
                f"scale={target_w}:{target_h}:flags=fast_bilinear:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}"
            )
        else:
            filters.append(
                f"scale={target_w}:{target_h}:flags=fast_bilinear:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2"
            )
    if probe.fps < VIDEO_OUTPUT_FPS:
        if VIDEO_FPS_MODE == "interpolate":
            filters.append(f"minterpolate=fps={VIDEO_OUTPUT_FPS}")
        else:
            filters.append(f"fps={VIDEO_OUTPUT_FPS}")

    video_codec = "libx265" if VIDEO_OUTPUT_CODEC == "hevc" else "libx264"
    command = base[:]
    if filters:
        command += ["-vf", ",".join(filters)]
    command += [
        "-c:v", video_codec,
        "-threads", str(_SAFE_ENCODER_THREADS),
        "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-tag:v", "hvc1", "-preset", _resource_safe_preset(),
        "-crf", str(VIDEO_OUTPUT_CRF),
    ]
    if video_codec == "libx265":
        command += ["-x265-params", _SAFE_X265_PARAMS]
    if probe.has_audio:
        command += ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"]
    else:
        command += ["-an"]
    command += ["-movflags", "+faststart", str(output_path.resolve())]
    return command


async def prepare_video(input_path: Path) -> tuple[Path, VideoProbe, bool]:
    probe = await asyncio.to_thread(probe_video, input_path)
    if not VIDEO_OUTPUT_ENABLED or VIDEO_OUTPUT_RESOLUTION != "4k":
        return input_path, probe, False

    output_path = input_path.with_name(f"{input_path.stem}_4k60.mp4")
    command = build_ffmpeg_command(input_path, output_path, probe)
    async with _conversion_slots:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(), timeout=VIDEO_CONVERSION_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            output_path.unlink(missing_ok=True)
            raise TimeoutError("Video conversion timed out")
    if process.returncode != 0 or not output_path.is_file():
        output_path.unlink(missing_ok=True)
        detail = (stderr or b"").decode("utf-8", errors="replace")[-500:]
        raise RuntimeError(f"FFmpeg conversion failed: {detail}")
    return output_path, await asyncio.to_thread(probe_video, output_path), True
