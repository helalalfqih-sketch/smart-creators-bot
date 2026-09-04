from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.video_converter import VideoProbe, build_ffmpeg_command, prepare_video


def probe(width, height, fps=30, codec="h264", pixel="yuv420p", audio=True, container="mp4"):
    return VideoProbe(width, height, fps, codec, pixel, container, audio, 1)


class VideoConverterCommandTests(unittest.TestCase):
    def command(self, value):
        return build_ffmpeg_command(Path("in.mp4"), Path("out.mp4"), value)

    def test_vertical_720p_to_2160x3840_60(self):
        command = self.command(probe(720, 1280))
        vf = command[command.index("-vf") + 1]
        self.assertIn("scale=2160:3840:force_original_aspect_ratio=decrease", vf)
        self.assertIn("pad=2160:3840", vf)
        self.assertIn("fps=60", vf)

    def test_horizontal_1080p_to_3840x2160_60(self):
        vf = self.command(probe(1920, 1080))[5]
        self.assertIn("scale=3840:2160", vf)
        self.assertIn("pad=3840:2160", vf)

    def test_square_preserves_ratio_with_padding(self):
        vf = self.command(probe(1080, 1080))[5]
        self.assertIn("force_original_aspect_ratio=decrease", vf)
        self.assertIn("pad=3840:2160", vf)

    def test_4k60_hevc_mp4_is_remuxed(self):
        command = self.command(probe(3840, 2160, 60, "hevc"))
        self.assertNotIn("-vf", command)
        self.assertEqual(command[command.index("-c") + 1], "copy")

    def test_video_without_audio_uses_an(self):
        command = self.command(probe(1920, 1080, audio=False))
        self.assertIn("-an", command)
        self.assertNotIn("-c:a", command)

    def test_higher_than_4k_is_not_spatially_downscaled(self):
        command = self.command(probe(7680, 4320, 30))
        vf = command[command.index("-vf") + 1]
        self.assertEqual(vf, "fps=60")

    def test_interpolate_mode_uses_minterpolate(self):
        with patch("core.video_converter.VIDEO_FPS_MODE", "interpolate"):
            vf = self.command(probe(1920, 1080))[5]
        self.assertIn("minterpolate=fps=60", vf)


class VideoConverterFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_ffmpeg_failure_removes_partial_output(self):
        class FailedProcess:
            returncode = 1
            async def communicate(self):
                return b"", b"encoder failed"

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, "source.mp4")
            source.write_bytes(b"source")
            with (
                patch("core.video_converter.probe_video", return_value=probe(1920, 1080)),
                patch("asyncio.create_subprocess_exec", return_value=FailedProcess()),
            ):
                with self.assertRaisesRegex(RuntimeError, "FFmpeg conversion failed"):
                    await prepare_video(source)
            self.assertFalse(Path(directory, "source_4k60.mp4").exists())

    async def test_conversion_timeout_kills_process(self):
        class HungProcess:
            returncode = None
            killed = False
            async def communicate(self):
                await asyncio.sleep(1)
            def kill(self):
                self.killed = True
            async def wait(self):
                self.returncode = -9

        process = HungProcess()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, "source.mp4")
            source.write_bytes(b"source")
            with (
                patch("core.video_converter.probe_video", return_value=probe(1920, 1080)),
                patch("asyncio.create_subprocess_exec", return_value=process),
                patch("core.video_converter.VIDEO_CONVERSION_TIMEOUT_SECONDS", 0.001),
            ):
                with self.assertRaisesRegex(TimeoutError, "timed out"):
                    await prepare_video(source)
            self.assertTrue(process.killed)


if __name__ == "__main__":
    unittest.main()


class VideoConverterAudioTests(unittest.TestCase):
    def test_incompatible_audio_is_normalized_to_aac_44100_stereo(self):
        value = VideoProbe(3840, 2160, 60, "hevc", "yuv420p", "mp4", True, 1, "opus", 48000, 2)
        command = build_ffmpeg_command(Path("in.mp4"), Path("out.mp4"), value)
        self.assertIn("-c:a", command)
        self.assertEqual(command[command.index("-c:a") + 1], "aac")
        self.assertEqual(command[command.index("-ar") + 1], "44100")
        self.assertEqual(command[command.index("-ac") + 1], "2")
        self.assertNotIn("-c", command)
