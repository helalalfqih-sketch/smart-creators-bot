from __future__ import annotations

import asyncio
import logging
import re

import requests
from telegram import Update
from telegram.error import Forbidden
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from core.config import BOT_TOKEN, DOWNLOAD_API_URL

logger = logging.getLogger("bot")


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

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        level=logging.INFO,
    )

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
