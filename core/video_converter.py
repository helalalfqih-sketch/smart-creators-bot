"""Safe FFmpeg conversion for the production Telegram delivery pipeline."""
from __future__ import annotations

import asyncio
import json
import logging
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


def _rate(value: str | None) -> float:
    try:
        return float(Fraction(value or "0/1"))
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_video(path: Path) -> VideoProbe:
    command = [
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(path.resolve()),
    ]
    result = __import__("subprocess").run(command, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("No video stream")
    format_data = data.get("format", {})
    return VideoProbe(
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        fps=_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        video_codec=str(video.get("codec_name") or ""),
        pixel_format=str(video.get("pix_fmt") or ""),
        container=str(format_data.get("format_name") or ""),
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        duration=max(0, int(float(format_data.get("duration") or 0))),
    )


def _target_dimensions(probe: VideoProbe) -> tuple[int, int]:
    return (2160, 3840) if probe.height > probe.width else (3840, 2160)


def _spatial_at_least_target(probe: VideoProbe) -> bool:
    target_w, target_h = _target_dimensions(probe)
    return probe.width >= target_w and probe.height >= target_h


def _already_at_least_target(probe: VideoProbe) -> bool:
    return _spatial_at_least_target(probe) and probe.fps >= VIDEO_OUTPUT_FPS


def _can_remux_only(probe: VideoProbe) -> bool:
    return (
        _already_at_least_target(probe)
        and probe.video_codec in {"hevc", "h265"}
        and probe.pixel_format == "yuv420p"
        and any(name in probe.container for name in ("mp4", "mov"))
    )


def build_ffmpeg_command(input_path: Path, output_path: Path, probe: VideoProbe) -> list[str]:
    base = ["ffmpeg", "-y", "-i", str(input_path.resolve())]
    if _can_remux_only(probe):
        return base + ["-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-tag:v", "hvc1", "-movflags", "+faststart", str(output_path.resolve())]

    # Preserve sources above the requested spatial/fps target; only normalize the
    # codec/container. This deliberately avoids downscaling genuine higher quality.
    filters: list[str] = []
    if not _spatial_at_least_target(probe):
        target_w, target_h = _target_dimensions(probe)
        if VIDEO_OUTPUT_FIT == "crop":
            filters.append(
                f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}"
            )
        else:
            filters.append(
                f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
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
        "-c:v", video_codec, "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-tag:v", "hvc1", "-preset", VIDEO_OUTPUT_PRESET, "-crf", str(VIDEO_OUTPUT_CRF),
    ]
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
        except TimeoutError:
            process.kill()
            await process.wait()
            output_path.unlink(missing_ok=True)
            raise TimeoutError("Video conversion timed out")
    if process.returncode != 0 or not output_path.is_file():
        output_path.unlink(missing_ok=True)
        detail = (stderr or b"").decode("utf-8", errors="replace")[-500:]
        raise RuntimeError(f"FFmpeg conversion failed: {detail}")
    return output_path, await asyncio.to_thread(probe_video, output_path), True
