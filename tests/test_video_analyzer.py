from __future__ import annotations

import unittest
from core.report_formatter import format_analysis_report
from core.video_analyzer import _aspect_ratio, _classify_resolution, _format_codec, _format_yemen_time


class VideoAnalyzerTests(unittest.TestCase):
    def test_classify_resolution(self):
        self.assertIn("4K UHD", _classify_resolution(2160, 3840))
        self.assertIn("عمودي", _classify_resolution(2160, 3840))
        self.assertIn("Full HD", _classify_resolution(1920, 1080))
        self.assertIn("أفقي", _classify_resolution(1920, 1080))

    def test_aspect_ratio(self):
        self.assertEqual(_aspect_ratio(1920, 1080), "16:9")
        self.assertEqual(_aspect_ratio(1080, 1920), "9:16")

    def test_format_codec(self):
        self.assertEqual(_format_codec("hevc"), "H.265 / HEVC")
        self.assertEqual(_format_codec("h264"), "H.264 / AVC")
        self.assertEqual(_format_codec("aac", "HE-AAC"), "HE-AAC")

    def test_format_yemen_time(self):
        utc = "2026-09-03T17:41:37Z"
        yemen = _format_yemen_time(utc)
        self.assertEqual(yemen, "2026-09-03 20:41:37")

    def test_report_formatter(self):
        dummy_analysis = {
            "filename": "test_video.mp4",
            "file_size_bytes": 17084471,
            "file_size_mb": 17.08,
            "file_size_mib": 16.29,
            "duration": 15.256104,
            "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            "format_long_name": "QuickTime / MOV",
            "stream_count": 2,
            "stream_description": "فيديو، صوت",
            "overall_bitrate": 8958759,
            "creation_time": "2026-09-03T17:41:37Z",
            "yemen_time": "2026-09-03 20:41:37",
            "video": {
                "codec_display": "H.265 / HEVC",
                "width": 2160,
                "height": 3840,
                "resolution_label": "4K UHD عمودي",
                "aspect_ratio": "9:16",
                "fps": 60.0,
                "fps_type": "ثابت CFR",
                "bitrate": 8696376,
            },
            "audio": {
                "codec_display": "HE-AAC",
                "channels_display": "قناتان — Stereo",
                "sample_rate": 44100,
                "bitrate": 56003,
                "integrated_loudness": "−22.7 LUFS",
                "loudness_range": "4.9 LU",
                "true_peak": "−4.3 dBFS",
            },
            "checksums": {
                "md5": "56ea858770e53701ae0a9f4e2fd3ff68",
                "sha1": "2dd8dee4dceb56a53e4344df7dac940768fff5f0",
                "sha256": "80511e939a29aa5fbf8cc806dcabfc7bb790769a6c117cf5f9aa2781219a5642",
            },
            "integrity": {
                "container": "سليمة",
                "video_stream": "سليم وقابل لفك الترميز بالكامل",
                "audio_stream": "سليم وقابل لفك الترميز بالكامل",
                "decode_errors": "لم تظهر أخطاء",
            },
            "summary": "الفيديو عمودي بدقة 4K UHD.",
        }
        report = format_analysis_report(dummy_analysis)
        self.assertIsInstance(report, list)
        self.assertTrue(len(report) > 0)
        # Ensure all chunks are under 3800 chars
        for part in report:
            self.assertLess(len(part), 3800)
        full_text = "\n".join(report)
        self.assertIn("بيانات الفيديو: test_video.mp4", full_text)
        self.assertIn("4K UHD عمودي", full_text)
        self.assertIn("H.265 / HEVC", full_text)
        self.assertIn("−22.7 LUFS", full_text)
        self.assertIn("2026-09-03 20:41:37", full_text)
        self.assertIn("56ea858770e53701ae0a9f4e2fd3ff68", full_text)


if __name__ == "__main__":
    unittest.main()
