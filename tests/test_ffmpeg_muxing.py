from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class RealFFmpegMuxingTests(unittest.TestCase):
    def setUp(self):
        self.ffmpeg = shutil.which("ffmpeg")
        self.ffprobe = shutil.which("ffprobe")

    def test_ffmpeg_and_ffprobe_exist(self):
        self.assertIsNotNone(self.ffmpeg, "FFmpeg binary must exist in PATH")
        self.assertIsNotNone(self.ffprobe, "FFprobe binary must exist in PATH")

        ffmpeg_ver = subprocess.run([self.ffmpeg, "-version"], capture_output=True, text=True, check=True)
        self.assertIn("ffmpeg version", ffmpeg_ver.stdout)

        ffprobe_ver = subprocess.run([self.ffprobe, "-version"], capture_output=True, text=True, check=True)
        self.assertIn("ffprobe version", ffprobe_ver.stdout)

    def test_synthetic_fixture_muxing_and_probing(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            video_file = tmp / "test_v.mp4"
            audio_file = tmp / "test_a.m4a"
            muxed_file = tmp / "test_muxed.mp4"

            # 1. Generate 2-second synthetic 720p H.264 video
            subprocess.run(
                [
                    self.ffmpeg,
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=duration=2:size=1280x720:rate=30",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(video_file),
                ],
                capture_output=True,
                check=True,
            )
            self.assertTrue(video_file.exists())

            # 2. Generate 2-second synthetic 1000Hz AAC audio
            subprocess.run(
                [
                    self.ffmpeg,
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=1000:duration=2",
                    "-c:a",
                    "aac",
                    str(audio_file),
                ],
                capture_output=True,
                check=True,
            )
            self.assertTrue(audio_file.exists())

            # 3. Mux into MP4 with faststart
            subprocess.run(
                [
                    self.ffmpeg,
                    "-y",
                    "-i",
                    str(video_file),
                    "-i",
                    str(audio_file),
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    str(muxed_file),
                ],
                capture_output=True,
                check=True,
            )
            self.assertTrue(muxed_file.exists())

            # 4. Probe stream composition
            probe = subprocess.run(
                [
                    self.ffprobe,
                    "-v",
                    "quiet",
                    "-print_format",
                    "json",
                    "-show_streams",
                    str(muxed_file),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            data = json.loads(probe.stdout)
            streams = data.get("streams", [])
            video_streams = [s for s in streams if s.get("codec_type") == "video"]
            audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

            self.assertEqual(len(video_streams), 1)
            self.assertEqual(len(audio_streams), 1)
            self.assertEqual(video_streams[0].get("width"), 1280)
            self.assertEqual(video_streams[0].get("height"), 720)


if __name__ == "__main__":
    unittest.main()
