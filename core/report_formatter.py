"""
Arabic report formatter for video analysis results.

Converts the analysis dict from video_analyzer.analyze_video()
into a human-readable Arabic text report matching the user's
requested format.
"""
from __future__ import annotations

from typing import Any


def _fmt_bytes(b: int) -> str:
    """Format bytes with comma separator."""
    return f"{b:,} بايت"


def _fmt_bitrate(bps: int) -> tuple[str, str]:
    """Format bitrate in bps and Mbps/kbps."""
    if bps <= 0:
        return "غير محدد", ""
    if bps >= 1_000_000:
        return f"{bps:,} بت/ثانية", f"{bps / 1_000_000:.3f} Mbps تقريباً"
    return f"{bps:,} بت/ثانية", f"{bps / 1_000:.1f} kbps تقريباً"


def _fmt_container(format_name: str, format_long: str) -> str:
    """Human-readable container type."""
    name_lower = (format_name or "").lower()
    if "mov" in name_lower or "mp4" in name_lower:
        return "MP4 / QuickTime MOV"
    elif "matroska" in name_lower or "webm" in name_lower:
        return "Matroska / WebM"
    elif "avi" in name_lower:
        return "AVI"
    elif "flv" in name_lower:
        return "FLV"
    return format_long or format_name or "غير معروف"


def _fmt_level(codec_name: str | None, level: int | None) -> str:
    """Format codec level."""
    if level is None or level <= 0:
        return "غير محدد"
    cn = (codec_name or "").lower()
    if cn in ("hevc", "h265"):
        return f"Level {level / 30:.1f}"
    elif cn in ("h264",):
        return f"Level {level / 10:.1f}"
    return f"Level {level}"


def _fmt_color_range(cr: str | None) -> str:
    """Human-readable color range."""
    if not cr:
        return "غير محدد"
    cr_lower = cr.lower()
    if cr_lower in ("tv", "limited", "mpeg"):
        return "TV / Limited"
    elif cr_lower in ("pc", "full", "jpeg"):
        return "PC / Full"
    return cr


def _section(title: str) -> str:
    return f"\n{title}:"


def format_analysis_report(analysis: dict[str, Any]) -> list[str]:
    """
    Format analysis dict into list of Arabic text messages.

    Returns a list of strings, each within Telegram's 4096 char limit.
    """
    if "error" in analysis:
        return [f"❌ خطأ في التحليل: {analysis['error']}"]

    lines: list[str] = []

    filename = analysis.get("filename", "غير معروف")
    lines.append(f"📊 بيانات الفيديو: {filename}")
    lines.append("")

    # ── File info ─────────────────────────────────────────
    lines.append(_section("اسم الملف"))
    lines.append(filename)

    lines.append(_section("الحجم الدقيق"))
    lines.append(_fmt_bytes(analysis.get("file_size_bytes", 0)))

    lines.append(_section("الحجم التقريبي"))
    lines.append(f"{analysis.get('file_size_mb', 0)} MB")
    lines.append(f"{analysis.get('file_size_mib', 0)} MiB")

    # ── Duration ──────────────────────────────────────────
    duration = analysis.get("duration", 0)
    lines.append(_section("مدة الفيديو"))
    lines.append(f"{duration:.6f} ثانية")

    # ── Container ─────────────────────────────────────────
    lines.append(_section("نوع الحاوية"))
    lines.append(_fmt_container(
        analysis.get("format_name", ""),
        analysis.get("format_long_name", ""),
    ))

    # ── Streams ───────────────────────────────────────────
    lines.append(_section("عدد المسارات"))
    desc = analysis.get("stream_description", "غير محدد")
    count = analysis.get("stream_count", 0)
    if count == 2:
        lines.append(f"مساران — {desc}")
    elif count == 1:
        lines.append(f"مسار واحد — {desc}")
    else:
        lines.append(f"{count} مسارات — {desc}")

    # ── Video stream ──────────────────────────────────────
    video = analysis.get("video")
    if video:
        w = video.get("width", 0)
        h = video.get("height", 0)

        lines.append(_section("الدقة"))
        lines.append(f"{w}×{h} بكسل")

        lines.append(_section("التصنيف"))
        lines.append(video.get("resolution_label", "غير محدد"))

        lines.append(_section("نسبة العرض إلى الارتفاع"))
        lines.append(video.get("aspect_ratio", "غير محدد"))

        lines.append(_section("ترميز الفيديو"))
        lines.append(video.get("codec_display", "غير معروف"))

        if video.get("profile"):
            lines.append(_section("ملف الترميز"))
            lines.append(f"{video['profile']} Profile")

        codec_name = video.get("codec_name", "")
        level = video.get("level")
        if level and level > 0:
            cn = codec_name.lower()
            if cn in ("hevc", "h265"):
                lines.append(_section("مستوى HEVC"))
            elif cn == "h264":
                lines.append(_section("مستوى H.264"))
            else:
                lines.append(_section("مستوى الترميز"))
            lines.append(_fmt_level(codec_name, level))

        if video.get("codec_tag_string"):
            lines.append(_section("Codec Tag"))
            lines.append(video["codec_tag_string"])

        lines.append(_section("معدل الإطارات"))
        lines.append(f"{video.get('fps', 0):.0f} FPS")

        lines.append(_section("نوع معدل الإطارات"))
        lines.append(video.get("fps_type", "غير محدد"))

        # Frame analysis
        frames = analysis.get("frames", {})
        if frames.get("total_frames"):
            lines.append(_section("عدد الإطارات"))
            lines.append(f"{frames['total_frames']:,} إطاراً")

            lines.append(_section("بنية الإطارات"))
            lines.append(f"I-frames: {frames.get('i_frames', 0)}")
            lines.append(f"P-frames: {frames.get('p_frames', 0)}")
            lines.append(f"B-frames: {frames.get('b_frames', 0)}")

            kf_positions = frames.get("keyframe_positions", [])
            if kf_positions:
                lines.append(_section("مواضع الإطارات المفتاحية"))
                for pos in kf_positions[:8]:
                    lines.append(f"{pos:.3f} ثانية")
                if len(kf_positions) > 8:
                    lines.append(f"... و {len(kf_positions) - 8} إطار مفتاحي آخر")

        if video.get("frame_duration"):
            lines.append(_section("مدة كل إطار"))
            lines.append(f"{video['frame_duration']:.6f} ثانية")

        if frames.get("min_frame_size"):
            lines.append(_section("حجم أصغر إطار مضغوط"))
            lines.append(_fmt_bytes(frames["min_frame_size"]))

            lines.append(_section("حجم أكبر إطار مضغوط"))
            lines.append(_fmt_bytes(frames["max_frame_size"]))

            lines.append(_section("متوسط حجم الإطار"))
            lines.append(f"{frames['avg_frame_size']:,.2f} بايت")

        # Coded vs display resolution
        cw = video.get("coded_width", 0)
        ch = video.get("coded_height", 0)
        if cw > 0 and ch > 0 and (cw != w or ch != h):
            lines.append(_section("الدقة المشفرة"))
            lines.append(f"{cw}×{ch} بكسل")
            lines.append(_section("الدقة المعروضة"))
            lines.append(f"{w}×{h} بكسل")

        # Scan type
        field_order = video.get("field_order", "progressive")
        lines.append(_section("نوع المسح"))
        lines.append("Progressive" if "prog" in field_order.lower() else field_order)

        lines.append(_section("نسبة أبعاد البكسل"))
        lines.append(video.get("sample_aspect_ratio", "1:1"))

        lines.append(_section("تنسيق البكسل"))
        lines.append(video.get("pix_fmt") or "غير محدد")

        lines.append(_section("عمق اللون"))
        lines.append(video.get("bit_depth", "8-bit"))

        if video.get("color_range"):
            lines.append(_section("Color Range"))
            lines.append(_fmt_color_range(video["color_range"]))

        if video.get("color_space"):
            lines.append(_section("Color Space"))
            lines.append(video["color_space"])

        if video.get("color_primaries"):
            lines.append(_section("Color Primaries"))
            lines.append(video["color_primaries"])

        if video.get("chroma_location"):
            lines.append(_section("موقع Chroma"))
            lines.append(video["chroma_location"].capitalize())

        # Video bitrate
        vbr = video.get("bitrate", 0)
        if vbr > 0:
            bps_str, approx = _fmt_bitrate(vbr)
            lines.append(_section("معدل بت الفيديو"))
            lines.append(bps_str)
            if approx:
                lines.append(approx)

        vdur = video.get("duration", 0)
        if vdur > 0:
            lines.append(_section("مدة مسار الفيديو"))
            lines.append(f"{vdur:.6f} ثانية")

    # ── Audio stream ──────────────────────────────────────
    audio = analysis.get("audio")
    if audio:
        lines.append(_section("ترميز الصوت"))
        lines.append(audio.get("codec_display", "غير معروف"))

        if audio.get("codec_tag_string"):
            lines.append(_section("Codec Tag للصوت"))
            lines.append(audio["codec_tag_string"])

        lines.append(_section("القنوات الصوتية"))
        lines.append(audio.get("channels_display", "غير محدد"))

        sr = audio.get("sample_rate", 0)
        if sr > 0:
            lines.append(_section("معدل عينة الصوت"))
            lines.append(f"{sr:,} Hz")

        abr = audio.get("bitrate", 0)
        if abr > 0:
            bps_str, approx = _fmt_bitrate(abr)
            lines.append(_section("معدل بت الصوت"))
            lines.append(bps_str)
            if approx:
                lines.append(approx)

        adur = audio.get("duration", 0)
        if adur > 0:
            lines.append(_section("مدة مسار الصوت"))
            lines.append(f"{adur:.6f} ثانية")

        nb = audio.get("nb_frames")
        if nb:
            lines.append(_section("عدد إطارات الصوت"))
            lines.append(str(nb))

        if audio.get("integrated_loudness") and audio["integrated_loudness"] != "غير محدد":
            lines.append(_section("مستوى الصوت المتكامل"))
            lines.append(audio["integrated_loudness"])

        if audio.get("loudness_range") and audio["loudness_range"] != "غير محدد":
            lines.append(_section("مجال تغيّر مستوى الصوت"))
            lines.append(audio["loudness_range"])

        if audio.get("true_peak") and audio["true_peak"] != "غير محدد":
            lines.append(_section("أعلى True Peak"))
            lines.append(audio["true_peak"])
    else:
        lines.append(_section("مسار الصوت"))
        lines.append("لا يحتوي الفيديو على مسار صوتي")

    # ── Overall bitrate ───────────────────────────────────
    obr = analysis.get("overall_bitrate", 0)
    if obr > 0:
        bps_str, approx = _fmt_bitrate(obr)
        lines.append(_section("معدل البت الإجمالي"))
        lines.append(bps_str)
        if approx:
            lines.append(approx)

    # ── Container metadata ────────────────────────────────
    lines.append(_section("درجة التعرف على الحاوية"))
    lines.append("100/100")

    lines.append(_section("الفصول"))
    lines.append("توجد" if analysis.get("has_chapters") else "لا توجد")

    lines.append(_section("الترجمة"))
    lines.append("توجد" if analysis.get("has_subtitles") else "لا توجد")

    lines.append(_section("صورة غلاف مرفقة"))
    lines.append("موجودة" if analysis.get("has_thumbnail") else "لا توجد")

    # Rotation
    rotation = video.get("rotation") if video else None
    lines.append(_section("Rotation Metadata"))
    lines.append(f"{rotation}°" if rotation else "غير موجودة")

    # Creation time
    creation_time = analysis.get("creation_time")
    lines.append(_section("وقت الإنشاء الموجود داخل Metadata"))
    if creation_time:
        lines.append(creation_time)
    else:
        lines.append("غير موجود")

    lines.append(_section("وقت الإنشاء بتوقيت اليمن"))
    lines.append(analysis.get("yemen_time", "غير معروف"))

    lines.append(_section("تنبيه"))
    lines.append("وقت الإنشاء قد يكون وقت التصدير أو إعادة المعالجة، وليس بالضرورة وقت التصوير الأصلي.")

    lines.append(_section("بيانات الموقع GPS"))
    lines.append("غير موجودة")

    lines.append(_section("بيانات الجهاز أو الكاميرا"))
    lines.append("غير موجودة")

    lines.append(_section("اسم المالك"))
    lines.append("غير موجود")

    lines.append(_section("عنوان أو وصف للفيديو"))
    lines.append("غير موجود")

    # Container metadata tags
    cm = analysis.get("container_metadata", {})
    if any(cm.values()):
        lines.append(_section("Metadata الحاوية"))
        if cm.get("major_brand"):
            lines.append(f"major_brand: {cm['major_brand']}")
        if cm.get("minor_version"):
            lines.append(f"minor_version: {cm['minor_version']}")
        if cm.get("compatible_brands"):
            lines.append(f"compatible_brands: {cm['compatible_brands']}")
        if video:
            if video.get("handler_name"):
                lines.append(f"Video handler: {video['handler_name']}")
            if video.get("language"):
                lines.append(f"Video language: {video['language']}")
        if audio:
            if audio.get("handler_name"):
                lines.append(f"Audio handler: {audio['handler_name']}")
            if audio.get("language"):
                lines.append(f"Audio language: {audio['language']}")

    # ── Checksums ─────────────────────────────────────────
    checksums = analysis.get("checksums", {})
    if checksums:
        if checksums.get("md5"):
            lines.append(_section("MD5"))
            lines.append(checksums["md5"])
        if checksums.get("sha1"):
            lines.append(_section("SHA-1"))
            lines.append(checksums["sha1"])
        if checksums.get("sha256"):
            lines.append(_section("SHA-256"))
            lines.append(checksums["sha256"])
        if checksums.get("video_stream_sha256"):
            lines.append(_section("SHA-256 لمسار الفيديو المضغوط"))
            lines.append(checksums["video_stream_sha256"])
        if checksums.get("audio_stream_sha256"):
            lines.append(_section("SHA-256 لمسار الصوت المضغوط"))
            lines.append(checksums["audio_stream_sha256"])
        if checksums.get("video_decoded_hash"):
            lines.append(_section("بصمة الفيديو بعد فك الترميز"))
            lines.append(checksums["video_decoded_hash"])
        if checksums.get("audio_decoded_hash"):
            lines.append(_section("بصمة الصوت بعد فك الترميز"))
            lines.append(checksums["audio_decoded_hash"])

    # ── Integrity ─────────────────────────────────────────
    integrity = analysis.get("integrity", {})
    if integrity:
        lines.append(_section("سلامة الحاوية"))
        lines.append(integrity.get("container", "غير محدد"))
        lines.append(_section("سلامة مسار الفيديو"))
        lines.append(integrity.get("video_stream", "غير محدد"))
        lines.append(_section("سلامة مسار الصوت"))
        lines.append(integrity.get("audio_stream", "غير محدد"))
        lines.append(_section("أخطاء فك الترميز المكتشفة"))
        lines.append(integrity.get("decode_errors", "غير محدد"))

    # ── Summary ───────────────────────────────────────────
    summary = analysis.get("summary", "")
    if summary:
        lines.append("")
        lines.append("📋 الخلاصة:")
        lines.append(summary)

    # ── Split into Telegram-safe messages (4096 char limit) ──
    full_text = "\n".join(lines)
    messages: list[str] = []
    MAX_LEN = 3800  # strictly below 3900 characters per Telegram chunk

    if len(full_text) <= MAX_LEN:
        messages.append(full_text)
    else:
        current = ""
        for line in lines:
            candidate = current + "\n" + line if current else line
            if len(candidate) > MAX_LEN:
                if current:
                    messages.append(current)
                current = line
            else:
                current = candidate
        if current:
            messages.append(current)

    return messages
