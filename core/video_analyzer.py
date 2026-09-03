"""
Comprehensive video file analyzer using ffprobe.

Extracts detailed technical metadata: container, video/audio streams,
frame analysis, checksums (MD5, SHA-1, SHA-256), and integrity checks.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from math import gcd
from pathlib import Path
from typing import Any

logger = logging.getLogger("video_analyzer")


def _run_ffprobe(args: list[str], path: str) -> dict | None:
    """Run ffprobe with given arguments and return parsed JSON."""
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json"] + args + [path]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60,
            encoding="utf-8", errors="replace",
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
        logger.warning("ffprobe failed (%s): %s", " ".join(cmd[:6]), exc)
    return None


def _compute_checksums(path: str) -> dict[str, str]:
    """Compute MD5, SHA-1, SHA-256 of the file."""
    md5 = hashlib.md5()
    sha1 = hashlib.sha1()
    sha256 = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1 << 20)  # 1 MB
                if not chunk:
                    break
                md5.update(chunk)
                sha1.update(chunk)
                sha256.update(chunk)
        return {
            "md5": md5.hexdigest(),
            "sha1": sha1.hexdigest(),
            "sha256": sha256.hexdigest(),
        }
    except OSError as exc:
        logger.error("Checksum computation failed: %s", exc)
        return {}


def _classify_resolution(width: int, height: int) -> str:
    """Classify resolution into human-readable label."""
    long_side = max(width, height)
    short_side = min(width, height)
    orientation = "عمودي" if height > width else ("أفقي" if width > height else "مربع")

    if long_side >= 3840:
        return f"4K UHD {orientation}"
    elif long_side >= 2560:
        return f"QHD (1440p) {orientation}"
    elif long_side >= 1920:
        return f"Full HD (1080p) {orientation}"
    elif long_side >= 1280:
        return f"HD (720p) {orientation}"
    elif long_side >= 854:
        return f"SD (480p) {orientation}"
    elif long_side >= 640:
        return f"SD (360p) {orientation}"
    else:
        return f"Low ({long_side}p) {orientation}"


def _aspect_ratio(width: int, height: int) -> str:
    """Compute display aspect ratio."""
    if width <= 0 or height <= 0:
        return "غير محدد"
    d = gcd(width, height)
    return f"{width // d}:{height // d}"


def _format_codec(codec_name: str | None, profile: str | None = None) -> str:
    """Human-readable codec name."""
    codec_map = {
        "h264": "H.264 / AVC",
        "hevc": "H.265 / HEVC",
        "h265": "H.265 / HEVC",
        "vp9": "VP9",
        "vp8": "VP8",
        "av1": "AV1",
        "mpeg4": "MPEG-4",
        "aac": "AAC",
        "mp3": "MP3",
        "opus": "Opus",
        "vorbis": "Vorbis",
        "flac": "FLAC",
        "ac3": "AC-3 / Dolby Digital",
        "eac3": "E-AC-3 / Dolby Digital Plus",
    }
    name = codec_map.get((codec_name or "").lower(), codec_name or "غير معروف")
    # Check for HE-AAC
    if (codec_name or "").lower() == "aac" and profile and "he" in profile.lower():
        name = "HE-AAC"
    return name


def _format_channels(channels: int, layout: str | None = None) -> str:
    """Human-readable audio channel description."""
    if layout:
        layout_lower = layout.lower()
        if "stereo" in layout_lower:
            return "قناتان — Stereo"
        elif "5.1" in layout_lower:
            return "6 قنوات — 5.1 Surround"
        elif "7.1" in layout_lower:
            return "8 قنوات — 7.1 Surround"
        elif "mono" in layout_lower:
            return "قناة واحدة — Mono"
    if channels == 1:
        return "قناة واحدة — Mono"
    elif channels == 2:
        return "قناتان — Stereo"
    elif channels == 6:
        return "6 قنوات — 5.1 Surround"
    return f"{channels} قنوات"


def _analyze_audio_loudness(path: str) -> dict[str, str]:
    """Analyze audio loudness (LUFS, LRA, True Peak) using ffmpeg ebur128 filter."""
    result = {
        "integrated_loudness": "غير محدد",
        "loudness_range": "غير محدد",
        "true_peak": "غير محدد",
    }
    cmd = [
        "ffmpeg", "-v", "info", "-i", path,
        "-af", "ebur128=framelog=verbose",
        "-f", "null", "-",
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=90,
            encoding="utf-8", errors="replace",
        )
        import re
        i_match = re.search(r"Integrated loudness:\s+I:\s+([-\d.]+)\s+LUFS", proc.stderr)
        if i_match:
            result["integrated_loudness"] = f"{i_match.group(1)} LUFS"

        lra_match = re.search(r"Loudness range:\s+LRA:\s+([-\d.]+)\s+LU", proc.stderr)
        if lra_match:
            result["loudness_range"] = f"{lra_match.group(1)} LU"

        tp_match = re.search(r"True peak:\s+Peak:\s+([-\d.]+)\s+dBFS", proc.stderr)
        if tp_match:
            result["true_peak"] = f"{tp_match.group(1)} dBFS"
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("Audio loudness analysis failed: %s", exc)
    return result


def _format_yemen_time(iso_time: str | None) -> str:
    """Convert UTC ISO timestamp to Yemen time (UTC+3)."""
    if not iso_time:
        return "غير موجود"
    try:
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
        yemen_tz = timezone(timedelta(hours=3))
        yemen_dt = dt.astimezone(yemen_tz)
        return yemen_dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "غير محدد"


def _check_integrity(path: str) -> dict[str, str]:
    """Check container and stream integrity using ffmpeg decode test."""
    result_dict: dict[str, str] = {
        "container": "غير محدد",
        "video_stream": "غير محدد",
        "audio_stream": "غير محدد",
        "decode_errors": "لم يتم الفحص",
    }
    try:
        # Decode video and audio to null output to check for errors
        cmd = [
            "ffmpeg", "-v", "error", "-i", path,
            "-f", "null", "-",
        ]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
            encoding="utf-8", errors="replace",
        )
        stderr = proc.stderr.strip()
        if not stderr:
            result_dict["container"] = "سليمة"
            result_dict["video_stream"] = "سليم وقابل لفك الترميز بالكامل"
            result_dict["audio_stream"] = "سليم وقابل لفك الترميز بالكامل"
            result_dict["decode_errors"] = "لم تظهر أخطاء"
        else:
            error_count = stderr.count("\n") + 1
            result_dict["container"] = "يوجد تحذيرات"
            result_dict["video_stream"] = f"يوجد {error_count} خطأ/تحذير"
            result_dict["audio_stream"] = f"يوجد {error_count} خطأ/تحذير"
            result_dict["decode_errors"] = stderr[:500]
    except subprocess.TimeoutExpired:
        result_dict["decode_errors"] = "انتهت مهلة الفحص (> 120 ثانية)"
    except OSError as exc:
        result_dict["decode_errors"] = f"فشل الفحص: {exc}"

    return result_dict


def _get_frame_analysis(path: str) -> dict[str, Any]:
    """Analyze frame types (I/P/B), sizes, keyframe positions."""
    analysis: dict[str, Any] = {}

    # Get frame info: type, size, keyframe flag, pts_time
    cmd = [
        "ffprobe", "-v", "quiet",
        "-select_streams", "v:0",
        "-show_frames",
        "-show_entries", "frame=pict_type,pkt_size,key_frame,pts_time",
        "-print_format", "json",
        path,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=90,
            encoding="utf-8", errors="replace",
        )
        if result.returncode != 0 or not result.stdout.strip():
            return analysis

        data = json.loads(result.stdout)
        frames = data.get("frames", [])
        if not frames:
            return analysis

        i_count = 0
        p_count = 0
        b_count = 0
        sizes: list[int] = []
        keyframe_positions: list[float] = []

        for frame in frames:
            ptype = (frame.get("pict_type") or "").upper()
            if ptype == "I":
                i_count += 1
            elif ptype == "P":
                p_count += 1
            elif ptype == "B":
                b_count += 1

            try:
                size = int(frame.get("pkt_size", 0))
                if size > 0:
                    sizes.append(size)
            except (ValueError, TypeError):
                pass

            if frame.get("key_frame") == 1:
                try:
                    pts = float(frame.get("pts_time", 0))
                    keyframe_positions.append(pts)
                except (ValueError, TypeError):
                    pass

        analysis["total_frames"] = len(frames)
        analysis["i_frames"] = i_count
        analysis["p_frames"] = p_count
        analysis["b_frames"] = b_count
        analysis["keyframe_positions"] = keyframe_positions[:20]  # limit

        if sizes:
            analysis["min_frame_size"] = min(sizes)
            analysis["max_frame_size"] = max(sizes)
            analysis["avg_frame_size"] = round(sum(sizes) / len(sizes), 2)

    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
        logger.warning("Frame analysis failed: %s", exc)

    return analysis


def analyze_video(path: Path | str) -> dict[str, Any]:
    """
    Perform comprehensive video file analysis.

    Returns a dict with all technical metadata ready for report formatting.
    """
    path = Path(path)
    if not path.exists():
        return {"error": "الملف غير موجود"}

    path_str = str(path.resolve())
    report: dict[str, Any] = {}

    # ── File info ─────────────────────────────────────────────────
    stat = path.stat()
    report["filename"] = path.name
    report["file_size_bytes"] = stat.st_size
    report["file_size_mb"] = round(stat.st_size / 1_000_000, 2)
    report["file_size_mib"] = round(stat.st_size / (1024 * 1024), 2)

    # ── ffprobe: streams + format ─────────────────────────────────
    probe = _run_ffprobe(
        ["-show_format", "-show_streams"],
        path_str,
    )
    if not probe:
        report["error"] = "فشل ffprobe في قراءة الملف"
        return report

    fmt = probe.get("format", {})
    streams = probe.get("streams", [])

    # Container info
    report["duration"] = float(fmt.get("duration", 0))
    report["format_name"] = fmt.get("format_name", "")
    report["format_long_name"] = fmt.get("format_long_name", "")
    report["overall_bitrate"] = int(fmt.get("bit_rate", 0))

    # Container metadata
    tags = fmt.get("tags", {})
    report["creation_time"] = tags.get("creation_time")
    report["container_metadata"] = {
        "major_brand": tags.get("major_brand"),
        "minor_version": tags.get("minor_version"),
        "compatible_brands": tags.get("compatible_brands"),
    }

    # Count stream types
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    subtitle_streams = [s for s in streams if s.get("codec_type") == "subtitle"]

    track_parts = []
    if video_streams:
        track_parts.append("فيديو")
    if audio_streams:
        track_parts.append("صوت")
    if subtitle_streams:
        track_parts.append("ترجمة")

    report["stream_count"] = len(streams)
    report["stream_description"] = f"{'، '.join(track_parts)}" if track_parts else "غير محدد"
    report["has_subtitles"] = len(subtitle_streams) > 0
    report["has_chapters"] = bool(probe.get("chapters"))

    # ── Video stream analysis ─────────────────────────────────────
    if video_streams:
        vs = video_streams[0]
        width = int(vs.get("width", 0))
        height = int(vs.get("height", 0))
        coded_width = int(vs.get("coded_width", width))
        coded_height = int(vs.get("coded_height", height))

        report["video"] = {
            "codec_name": vs.get("codec_name"),
            "codec_long_name": vs.get("codec_long_name"),
            "codec_display": _format_codec(vs.get("codec_name"), vs.get("profile")),
            "profile": vs.get("profile"),
            "level": vs.get("level"),
            "codec_tag_string": vs.get("codec_tag_string"),
            "width": width,
            "height": height,
            "coded_width": coded_width,
            "coded_height": coded_height,
            "display_width": width,
            "display_height": height,
            "resolution_label": _classify_resolution(width, height),
            "aspect_ratio": _aspect_ratio(width, height),
            "sample_aspect_ratio": vs.get("sample_aspect_ratio", "1:1"),
            "pix_fmt": vs.get("pix_fmt"),
            "color_range": vs.get("color_range"),
            "color_space": vs.get("color_space"),
            "color_primaries": vs.get("color_primaries"),
            "color_transfer": vs.get("color_transfer"),
            "chroma_location": vs.get("chroma_location"),
            "field_order": vs.get("field_order", "progressive"),
            "bitrate": int(vs.get("bit_rate", 0)),
            "duration": float(vs.get("duration", 0)),
            "nb_frames": vs.get("nb_frames"),
            "rotation": (vs.get("tags") or {}).get("rotate"),
        }

        # FPS calculation
        r_frame_rate = vs.get("r_frame_rate", "0/1")
        avg_frame_rate = vs.get("avg_frame_rate", "0/1")

        def _parse_rate(rate_str: str) -> float:
            try:
                if "/" in rate_str:
                    num, den = rate_str.split("/")
                    return float(num) / float(den) if float(den) != 0 else 0
                return float(rate_str)
            except (ValueError, ZeroDivisionError):
                return 0

        fps = _parse_rate(r_frame_rate)
        avg_fps = _parse_rate(avg_frame_rate)
        report["video"]["fps"] = round(fps, 2)
        report["video"]["avg_fps"] = round(avg_fps, 2)
        report["video"]["fps_type"] = "ثابت CFR" if abs(fps - avg_fps) < 0.5 else "متغير VFR"

        if fps > 0:
            report["video"]["frame_duration"] = round(1.0 / fps, 6)

        # Bit depth
        bits = vs.get("bits_per_raw_sample") or vs.get("bits_per_sample")
        report["video"]["bit_depth"] = f"{bits}-bit" if bits else "8-bit"

        # Handler name from tags
        vtags = vs.get("tags", {})
        report["video"]["handler_name"] = vtags.get("handler_name")
        report["video"]["language"] = vtags.get("language")

    # ── Audio stream analysis ─────────────────────────────────────
    if audio_streams:
        aus = audio_streams[0]
        report["audio"] = {
            "codec_name": aus.get("codec_name"),
            "codec_display": _format_codec(aus.get("codec_name"), aus.get("profile")),
            "codec_tag_string": aus.get("codec_tag_string"),
            "profile": aus.get("profile"),
            "channels": int(aus.get("channels", 0)),
            "channel_layout": aus.get("channel_layout"),
            "channels_display": _format_channels(
                int(aus.get("channels", 0)),
                aus.get("channel_layout"),
            ),
            "sample_rate": int(aus.get("sample_rate", 0)),
            "bitrate": int(aus.get("bit_rate", 0)),
            "duration": float(aus.get("duration", 0)),
            "nb_frames": aus.get("nb_frames"),
        }
        atags = aus.get("tags", {})
        report["audio"]["handler_name"] = atags.get("handler_name")
        report["audio"]["language"] = atags.get("language")

        # Audio loudness (LUFS, LRA, True Peak)
        loudness = _analyze_audio_loudness(path_str)
        report["audio"].update(loudness)

    # ── Yemen time ────────────────────────────────────────────────
    report["yemen_time"] = _format_yemen_time(report.get("creation_time"))

    # ── Frame analysis ────────────────────────────────────────────
    frame_analysis = _get_frame_analysis(path_str)
    if frame_analysis:
        report["frames"] = frame_analysis

    # ── Checksums ─────────────────────────────────────────────────
    checksums = _compute_checksums(path_str)
    if checksums:
        report["checksums"] = checksums

    # ── Integrity check ───────────────────────────────────────────
    integrity = _check_integrity(path_str)
    report["integrity"] = integrity

    # ── Summary ───────────────────────────────────────────────────
    summary_parts = []
    if "video" in report:
        v = report["video"]
        orientation = "عمودي" if v["height"] > v["width"] else "أفقي"
        summary_parts.append(
            f"الفيديو {orientation} بدقة {v['resolution_label']} ومعدل {v['fps']:.0f} إطاراً في الثانية."
        )
        summary_parts.append(
            f"يستخدم ترميز {v['codec_display']}"
        )
    if "audio" in report:
        a = report["audio"]
        summary_parts[-1] += f" وصوت {a['codec_display']} {a['channels_display']}."

    if integrity.get("container") == "سليمة":
        summary_parts.append("الملف سليم تقنياً ولا يحتوي على أخطاء.")
    else:
        summary_parts.append("الملف يحتوي على بعض التحذيرات.")

    report["summary"] = "\n".join(summary_parts)

    return report
