from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from core import worker


class FakeExtractor:
    extension = "mp4"

    def extract(self, _url: str, *, out_template: str, **_kwargs):
        output = Path(out_template.replace("%(ext)s", self.extension))
        output.write_bytes(b"media")
        return SimpleNamespace(output_lines=[])


class WorkerVideoContractTests(unittest.IsolatedAsyncioTestCase):
    def test_all_video_qualities_require_a_video_format(self):
        for quality, selector in worker._QUALITY_FORMAT.items():
            if quality == "audio":
                continue
            with self.subTest(quality=quality):
                self.assertIn("bestvideo*", selector)
                self.assertTrue(
                    all(alternative.startswith("bestvideo*") for alternative in selector.split("/"))
                )

    def test_audio_quality_remains_explicitly_audio_only(self):
        self.assertEqual(worker._QUALITY_FORMAT["audio"], "bestaudio/best")

    async def test_video_request_rejects_and_deletes_audio_only_result(self):
        class AudioExtractor(FakeExtractor):
            extension = "m4a"

        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(worker, "DOWNLOAD_DIR", Path(directory)),
                patch.object(worker, "SmartExtractor", AudioExtractor),
                patch.object(
                    worker,
                    "get_video_metadata",
                    return_value={"duration": 10, "width": 0, "height": 0},
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "بلا مسار فيديو"):
                    await worker.download_video("https://example.com/video", quality="best")

            self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_audio_request_accepts_audio_result(self):
        class AudioExtractor(FakeExtractor):
            extension = "m4a"

        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(worker, "DOWNLOAD_DIR", Path(directory)),
                patch.object(worker, "SmartExtractor", AudioExtractor),
            ):
                result = await worker.download_video(
                    "https://example.com/audio",
                    quality="audio",
                )

            self.assertEqual(result.suffix, ".m4a")
            self.assertTrue(result.exists())


if __name__ == "__main__":
    unittest.main()
