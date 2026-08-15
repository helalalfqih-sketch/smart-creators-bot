from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from engine.extractors.smart_extractor import SmartExtractor


class SmartExtractorFallbackTests(TestCase):
    @patch.object(SmartExtractor, "_run_cmd")
    def test_tiktok_non_cookie_failure_uses_browser_fallback(self, run_cmd):
        run_cmd.side_effect = [
            (1, ["ERROR: Unexpected response from webpage request"]),
            (0, ["download complete"]),
        ]

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
