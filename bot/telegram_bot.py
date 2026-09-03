from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from telegram import Update
from telegram.error import BadRequest, Forbidden, TelegramError
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from core.config import BOT_TOKEN, DOWNLOAD_API_URL

logger = logging.getLogger("bot")

API_REQUEST_TIMEOUT_SECONDS = 30
RESULT_POLL_INTERVAL_SECONDS = 2
RESULT_WAIT_TIMEOUT_SECONDS = int(os.getenv("TELEGRAM_RESULT_TIMEOUT_SECONDS", "300"))


class JobResultError(RuntimeError):
    """A terminal API response while retrieving a download result."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


# ── Utilities ─────────────────────────────────────────────────────────────────

def _extract_url(text: str) -> str | None:
    """استخراج رابط الـ URL الحقيقي بدقة وتنظيفه من النصوص والرموز الصينية الملتصقة به"""
    if not text:
        return None

    url_pattern = r'(https?://[^\s，]+)'
    match = re.search(url_pattern, text)

    if match:
        url = match.group(1).strip()
        url = url.rstrip('.:,;?)"\'/،')
        return url

    return None


async def _safe_delete(context: ContextTypes.DEFAULT_TYPE, chat_id: int, message_id: int | None) -> None:
    if message_id:
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=message_id)
        except Exception:
            pass


def _error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip() or f"HTTP {response.status_code}"

    detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
    if isinstance(detail, dict):
        return str(detail.get("error") or detail.get("message") or detail)
    return str(detail)


def _is_public_http_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username or parsed.password or parsed.hostname.lower() == "localhost":
            return False
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            return "." in parsed.hostname
        return address.is_global
    except (TypeError, ValueError):
        return False


def _telegram_media_source(value: Any) -> Path | str | None:
    if not isinstance(value, str) or not value.strip():
        return None

    candidate = value.strip()
    path = Path(candidate).expanduser()
    try:
        if path.is_file():
            return path
    except OSError:
        # URL-like or otherwise invalid filesystem values can exceed OS path limits.
        pass
    if _is_public_http_url(candidate):
        return candidate
    return None


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


# ── API Gateway ───────────────────────────────────────────────────────────────

def send_job(url: str, chat_id: int, quality: str = "best") -> str:
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/media/download"
    res = requests.post(
        endpoint,
        json={"url": url, "quality": quality, "chat_id": chat_id},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["job_id"]


def get_job_status(job_id: str) -> dict:
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}"
    response = requests.get(endpoint, timeout=API_REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def get_job_result(job_id: str) -> dict:
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}/result"
    response = requests.get(endpoint, timeout=API_REQUEST_TIMEOUT_SECONDS)

    if response.status_code == 202:
        return {"status": "pending"}
    if response.status_code == 409:
        raise JobResultError(409, _error_detail(response))
    if response.status_code == 410:
        raise JobResultError(410, _error_detail(response))
    if response.status_code == 404:
        raise JobResultError(404, _error_detail(response))

    response.raise_for_status()
    return response.json()


async def _send_result_media(context: ContextTypes.DEFAULT_TYPE, chat_id: int, result: dict) -> None:
    media_source = _telegram_media_source(result.get("file"))
    if media_source is None:
        raise ValueError(f"Result file is neither an existing file nor a public URL: {result.get('file')!r}")

    thumbnail = _telegram_media_source(result.get("thumbnail"))
    media_type = str(result.get("media_type") or "").lower()
    duration = _positive_int(result.get("duration"))
    width = _positive_int(result.get("width"))
    height = _positive_int(result.get("height"))
    caption = "✅ اكتمل التحميل"

    if media_type == "video":
        try:
            await context.bot.send_video(
                chat_id=chat_id,
                video=media_source,
                caption=caption,
                duration=duration,
                width=width,
                height=height,
                thumbnail=thumbnail,
                supports_streaming=True,
            )
            return
        except BadRequest as exc:
            logger.warning("sendVideo rejected result; falling back to document: %s", exc)
            await context.bot.send_document(chat_id=chat_id, document=media_source, caption=caption)
            return

    if media_type == "audio":
        try:
            await context.bot.send_audio(
                chat_id=chat_id,
                audio=media_source,
                caption=caption,
                duration=duration,
                thumbnail=thumbnail,
            )
            return
        except TelegramError as exc:
            logger.warning("sendAudio failed; falling back to document: %s", exc)
            await context.bot.send_document(chat_id=chat_id, document=media_source, caption=caption)
            return

    await context.bot.send_document(chat_id=chat_id, document=media_source, caption=caption)


async def wait_and_send_result(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    job_id: str,
    timeout_seconds: float = 300,
    poll_interval_seconds: float = 2,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds

    while loop.time() < deadline:
        try:
            job = await asyncio.to_thread(get_job_status, job_id)
            status = str(job.get("status") or "").lower()

            if status in {"queued", "running"}:
                await asyncio.sleep(poll_interval_seconds)
                continue

            if status == "done":
                result = await asyncio.to_thread(get_job_result, job_id)
                if result.get("status") == "pending":
                    await asyncio.sleep(poll_interval_seconds)
                    continue
                await _send_result_media(context, chat_id, result)
                logger.info("Delivered result for job %s to chat %s", job_id, chat_id)
                return

            if status == "error":
                logger.error("Download job %s failed: %s", job_id, job.get("error"))
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="❌ فشل تحميل الوسائط. حاول مرة أخرى أو أرسل رابطًا مختلفًا.",
                )
                return

            if status == "cancelled":
                logger.warning("Download job %s was cancelled", job_id)
                await context.bot.send_message(chat_id=chat_id, text="⚠️ تم إلغاء مهمة التحميل.")
                return

            logger.error("Unexpected status %r for job %s", status, job_id)
            await context.bot.send_message(chat_id=chat_id, text="❌ تعذر تحديد حالة مهمة التحميل.")
            return

        except JobResultError as exc:
            logger.error("Cannot retrieve result for job %s (HTTP %s): %s", job_id, exc.status_code, exc)
            if exc.status_code == 410:
                text = "⚠️ تم إلغاء مهمة التحميل."
            elif exc.status_code == 409:
                text = "❌ فشل تحميل الوسائط. حاول مرة أخرى أو أرسل رابطًا مختلفًا."
            elif exc.status_code == 404:
                text = "❌ اكتملت المهمة لكن لم يتم العثور على ملف النتيجة."
            else:
                text = "❌ تعذر استلام نتيجة التحميل."
            await context.bot.send_message(chat_id=chat_id, text=text)
            return
        except requests.RequestException as exc:
            logger.warning("Polling job %s failed temporarily: %s", job_id, exc)
            await asyncio.sleep(poll_interval_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Failed to deliver result for job %s", job_id)
            await context.bot.send_message(
                chat_id=chat_id,
                text="❌ اكتمل التحميل لكن تعذر إرسال الملف. يرجى المحاولة مرة أخرى.",
            )
            return

    logger.error("Timed out waiting for job %s after %.1f seconds", job_id, timeout_seconds)
    await context.bot.send_message(
        chat_id=chat_id,
        text="⌛ استغرقت عملية التحميل وقتًا أطول من المتوقع. يرجى المحاولة مرة أخرى.",
    )


# ── Handlers ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "👋 *مرحباً!*\n\nأرسل الروابط مباشرة وسأقوم بتحميلها متوازية فوراً بأعلى جودة.",
        parse_mode="Markdown",
    )


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    url = _extract_url(message.text)
    if not url:
        err_msg = await message.reply_text("❌ الرجاء إرسال رابط صحيح يبدأ بـ http/https")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, message.message_id)
        await _safe_delete(context, message.chat_id, err_msg.message_id)
        return

    try:
        job_id = await asyncio.to_thread(send_job, url, message.chat_id)
        await message.reply_text(f"📥 تم إنشاء المهمة: {job_id}")
        context.application.create_task(
            wait_and_send_result(
                context,
                message.chat_id,
                job_id,
                timeout_seconds=RESULT_WAIT_TIMEOUT_SECONDS,
                poll_interval_seconds=RESULT_POLL_INTERVAL_SECONDS,
            ),
            update=update,
            name=f"telegram-delivery-{job_id}",
        )
    except Exception:
        logger.exception("Failed to create download job")
        await message.reply_text("❌ فشل إنشاء المهمة. تأكد أن API Gateway يعمل.")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    if isinstance(context.error, Forbidden):
        return
    logger.error("❌ Exception while handling an update:", exc_info=context.error)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("❌ TELEGRAM_BOT_TOKEN مفقود")

    bot_log = RotatingFileHandler(
        "bot.log",
        maxBytes=5_000_000,
        backupCount=2,
        encoding="utf-8",
    )
    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        level=logging.INFO,
        handlers=[logging.StreamHandler(), bot_log],
        force=True,
    )
    # Prevent httpx from logging full Telegram API URLs containing bot tokens
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    from telegram.request import HTTPXRequest

    request_config = HTTPXRequest(
        connect_timeout=60.0,
        read_timeout=60.0,
        write_timeout=120.0,
    )

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .request(request_config)
        .concurrent_updates(True)
        .build()
    )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    app.add_error_handler(error_handler)

    logger.info("🤖 Bot polling started | API Gateway mode")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
