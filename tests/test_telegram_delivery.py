from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock
import tempfile

# Mock optional/external libraries if not installed in sandbox
if "requests" not in sys.modules:
    sys.modules["requests"] = MagicMock()
if "telegram" not in sys.modules:
    tg_mock = MagicMock()
    sys.modules["telegram"] = tg_mock
    sys.modules["telegram.error"] = MagicMock()
    sys.modules["telegram.ext"] = MagicMock()

from bot import telegram_bot


class TelegramDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_result_media_dispatches_video_to_send_video(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            file_path = f.name
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_video = AsyncMock()

            result = {
                "file": file_path,
                "media_type": "video",
                "duration": 30,
                "width": 1280,
                "height": 720,
                "thumbnail": None,
            }

            await telegram_bot._send_result_media(context, 123456, result)

            context.bot.send_video.assert_called_once()
            call_kwargs = context.bot.send_video.call_args.kwargs
            self.assertEqual(call_kwargs["chat_id"], 123456)
            self.assertEqual(str(call_kwargs["video"]), file_path)
            self.assertEqual(call_kwargs["width"], 1280)
            self.assertEqual(call_kwargs["height"], 720)
            self.assertTrue(call_kwargs["supports_streaming"])

    async def test_send_result_media_dispatches_audio_to_send_audio(self):
        with tempfile.NamedTemporaryFile(suffix=".m4a") as f:
            file_path = f.name
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_audio = AsyncMock()

            result = {
                "file": file_path,
                "media_type": "audio",
                "duration": 180,
                "width": 0,
                "height": 0,
                "thumbnail": None,
            }

            await telegram_bot._send_result_media(context, 123456, result)

            context.bot.send_audio.assert_called_once()
            call_kwargs = context.bot.send_audio.call_args.kwargs
            self.assertEqual(call_kwargs["chat_id"], 123456)
            self.assertEqual(str(call_kwargs["audio"]), file_path)
            self.assertEqual(call_kwargs["duration"], 180)


if __name__ == "__main__":
    unittest.main()
