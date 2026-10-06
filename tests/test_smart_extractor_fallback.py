import os
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from engine.extractors.smart_extractor import ExtractResult, SmartExtractor


class SmartExtractorFallbackTests(TestCase):
    @patch.object(SmartExtractor, "_run_cmd")
    def test_local_tiktok_non_cookie_failure_can_use_browser_fallback(self, run_cmd):
        run_cmd.side_effect = [
            (1, ["ERROR: Unexpected response from webpage request"]),
            (0, ["download complete"]),
        ]

        with patch.dict(os.environ, {"ENABLE_BROWSER_COOKIE_FALLBACK": "true"}, clear=False):
            result = SmartExtractor().extract(
                "https://www.tiktok.com/@owner/video/123",
                out_template="/tmp/%(id)s.%(ext)s",
                format_string="bestvideo*+bestaudio/bestvideo*",
                max_bytes=50_000_000,
            )

        self.assertEqual(result.mode, "browser")
        self.assertEqual(run_cmd.call_count, 2)
        browser_cmd = run_cmd.call_args_list[1].args[0]
        self.assertIn("--cookies-from-browser", browser_cmd)

    @patch.object(SmartExtractor, "_extract_via_proxy_api")
    @patch.object(SmartExtractor, "_run_cmd")
    def test_render_douyin_skips_browser_cookie_database(self, run_cmd, extract_proxy):
        run_cmd.side_effect = [
            (1, ["ERROR: Douyin anti-bot response"]),
            (1, ["ERROR: retry blocked"]),
        ]
        extract_proxy.return_value = ExtractResult(
            output_lines=["[proxy_api] success"],
            mode="proxy_api",
        )

        with patch.dict(
            os.environ,
            {"RENDER_SERVICE_NAME": "smart-creators-media-worker-p0"},
            clear=False,
        ):
            result = SmartExtractor().extract(
                "https://v.douyin.com/example",
                out_template="/tmp/%(id)s.%(ext)s",
                format_string="bestvideo*+bestaudio/bestvideo*",
                max_bytes=50_000_000,
            )

        self.assertEqual(result.mode, "proxy_api")
        self.assertEqual(run_cmd.call_count, 2)
        for call in run_cmd.call_args_list:
            self.assertNotIn("--cookies-from-browser", call.args[0])
        extract_proxy.assert_called_once()

    @patch.object(SmartExtractor, "_run_cmd")
    def test_generic_non_cookie_failure_stops_after_primary(self, run_cmd):
        run_cmd.return_value = (1, ["ERROR: Unsupported URL"])

        with self.assertRaises(RuntimeError):
            SmartExtractor().extract(
                "https://example.com/video",
                out_template="/tmp/%(id)s.%(ext)s",
                format_string="bestvideo*+bestaudio/bestvideo*",
                max_bytes=50_000_000,
            )

        self.assertEqual(run_cmd.call_count, 1)

    @patch.object(SmartExtractor, "_extract_via_proxy_api")
    @patch.object(SmartExtractor, "_run_cmd")
    def test_tiktok_yt_dlp_failure_triggers_proxy_api_fallback(self, run_cmd, extract_proxy):
        run_cmd.return_value = (1, ["ERROR: TikTok anti-bot block"])
        extract_proxy.return_value = ExtractResult(
            output_lines=["[proxy_api] success"],
            mode="proxy_api",
        )

        with patch.dict(os.environ, {"ENABLE_BROWSER_COOKIE_FALLBACK": "false"}, clear=False):
            result = SmartExtractor().extract(
                "https://www.tiktok.com/@owner/video/123",
                out_template="/tmp/%(id)s.%(ext)s",
                format_string="bestvideo*+bestaudio/bestvideo*",
                max_bytes=50_000_000,
            )

        self.assertEqual(result.mode, "proxy_api")
        self.assertTrue(extract_proxy.called)

    def test_yt_dlp_runs_via_active_python_interpreter(self):
        cmd = SmartExtractor()._common_args(
            "https://example.com/video",
            "/tmp/%(id)s.%(ext)s",
            "best",
            50_000_000,
        )
        self.assertEqual(cmd[:3], [sys.executable, "-m", "yt_dlp"])
