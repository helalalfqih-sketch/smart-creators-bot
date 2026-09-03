from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import tempfile

# Mock optional/external libraries if not installed in sandbox
if "requests" not in sys.modules:
    sys.modules["requests"] = MagicMock()
try:
    import telegram
    import telegram.error
    import telegram.ext
except ImportError:
    class TelegramError(Exception): pass
    class BadRequest(TelegramError): pass
    class Forbidden(TelegramError): pass
    import types
    tg_error_mod = types.ModuleType("telegram.error")
    tg_error_mod.TelegramError = TelegramError
    tg_error_mod.BadRequest = BadRequest
    tg_error_mod.Forbidden = Forbidden
    sys.modules["telegram.error"] = tg_error_mod
    sys.modules["telegram"] = MagicMock()
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

            with patch.object(telegram_bot, "confirm_job_delivery"):
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

            with patch.object(telegram_bot, "confirm_job_delivery"):
                await telegram_bot._send_result_media(context, 123456, result)

            context.bot.send_audio.assert_called_once()
            call_kwargs = context.bot.send_audio.call_args.kwargs
            self.assertEqual(call_kwargs["chat_id"], 123456)
            self.assertEqual(str(call_kwargs["audio"]), file_path)
            self.assertEqual(call_kwargs["duration"], 180)

    async def test_send_result_media_never_sends_report_or_analysis_txt(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            file_path = f.name
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_message = AsyncMock()
            context.bot.send_video = AsyncMock()
            context.bot.send_document = AsyncMock()

            result = {
                "file": file_path,
                "filename": "my_test_video.mp4",
                "media_type": "video",
                "duration": 30,
                "width": 1280,
                "height": 720,
                "report_text": ["القسم الأول من التقرير", "القسم الثاني من التقرير"],
            }

            with patch.object(telegram_bot, "confirm_job_delivery") as confirm:
                await telegram_bot._send_result_media(context, 123456, result)

            context.bot.send_message.assert_not_called()
            context.bot.send_video.assert_called_once()
            context.bot.send_document.assert_not_called()
            confirm.assert_called_once()
            self.assertNotIn("caption", context.bot.send_video.call_args.kwargs)

    async def test_send_result_media_video_rejection_falls_back_to_document(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            file_path = f.name
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_video = AsyncMock(side_effect=telegram_bot.BadRequest("Video file too big or invalid format"))
            context.bot.send_document = AsyncMock()

            result = {
                "file": file_path,
                "media_type": "video",
                "duration": 30,
                "width": 1280,
                "height": 720,
            }

            with patch.object(telegram_bot, "confirm_job_delivery"):
                await telegram_bot._send_result_media(context, 123456, result)
            # send_document should be called as fallback for the video
            context.bot.send_document.assert_called_once()


    async def test_send_video_timeout_falls_back_to_document(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_video = AsyncMock(side_effect=telegram_bot.asyncio.TimeoutError())
            context.bot.send_document = AsyncMock()
            result = {"file": f.name, "media_type": "video", "duration": 1, "width": 3840, "height": 2160}
            with patch.object(telegram_bot, "confirm_job_delivery"):
                await telegram_bot._send_result_media(context, 123456, result)
            context.bot.send_document.assert_called_once()

    async def test_delivery_confirmation_is_not_called_when_both_sends_fail(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_video = AsyncMock(side_effect=telegram_bot.BadRequest("rejected"))
            context.bot.send_document = AsyncMock(side_effect=telegram_bot.BadRequest("rejected"))
            result = {"file": f.name, "media_type": "video"}
            with patch.object(telegram_bot, "confirm_job_delivery") as confirm:
                with self.assertRaises(telegram_bot.BadRequest):
                    await telegram_bot._send_result_media(context, 123456, result)
            confirm.assert_not_called()

    async def test_delivery_ignores_all_report_fields(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            context = MagicMock()
            context.bot = MagicMock()
            context.bot.send_video = AsyncMock()
            result = {
                "file": f.name,
                "media_type": "video",
                "analysis": {"checksums": {"md5": "secret"}},
                "report_text": ["technical report"],
                "analysis_file": "analysis.txt",
            }
            with patch.object(telegram_bot, "confirm_job_delivery"):
                await telegram_bot._send_result_media(context, 123456, result)
            self.assertNotIn("caption", context.bot.send_video.call_args.kwargs)
            context.bot.send_message.assert_not_called()

    def test_recent_url_claim_is_idempotent_per_chat_and_url(self):
        telegram_bot._recent_url_claims.clear()
        self.assertTrue(telegram_bot._claim_recent_url(5660048569, "https://example.com/video"))
        self.assertFalse(telegram_bot._claim_recent_url(5660048569, "https://example.com/video"))
        self.assertTrue(telegram_bot._claim_recent_url(5660048569, "https://example.com/other"))
        self.assertTrue(telegram_bot._claim_recent_url(100, "https://example.com/video"))


if __name__ == "__main__":
    unittest.main()
