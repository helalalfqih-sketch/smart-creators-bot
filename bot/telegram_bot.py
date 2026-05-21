"""
Telegram Bot (Polling mode).

Flow:
  1. User sends a video URL
  2. Bot shows quality selection buttons
  3. User picks a quality → Bot POSTs to FastAPI /download with quality → gets job_id
  4. Bot polls /result/{job_id} every 3 s, updating a status message
  5. Once done, bot reads the local file and sends it as a video
  6. On error, bot shows the error message
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)
from telegram.constants import ChatAction
from telegram.error import Forbidden

from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from core.config import (
    BOT_TOKEN,
    DOWNLOAD_API_URL,
    HTTP_TIMEOUT_SECONDS,
)

logger = logging.getLogger("bot")

POLL_INTERVAL = 3          # seconds between /result polls
MAX_POLL_ATTEMPTS = 100    # 300 s total before giving up

# Quality options: (label, yt-dlp height value sent to API)
QUALITY_OPTIONS = [
    ("📱 144p",  "144"),
    ("📺 360p",  "360"),
    ("🎞 480p",  "480"),
    ("🎬 720p",  "720"),
    ("🖥 1080p", "1080"),
    ("⚡ أفضل جودة", "best"),
    ("✨ تحسين الجودة", "enhance"),
]

# ── Utilities ─────────────────────────────────────────────────────────────────

def _extract_url(text: str) -> str | None:
    for word in text.split():
        if word.startswith(("http://", "https://")):
            try:
                p = urlparse(word)
                if p.netloc:
                    return word.strip()
            except Exception:
                pass
    return None


def _progress_bar(pct: float, width: int = 10) -> str:
    filled = int(pct / 100 * width)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {pct:.0f}%"


def _quality_keyboard(url_key: str) -> InlineKeyboardMarkup:
    """Build quality selection keyboard. url_key is a short UUID stored in bot_data."""
    buttons = []
    row = []
    for label, quality in QUALITY_OPTIONS:
        row.append(
            InlineKeyboardButton(label, callback_data=f"q|{quality}|{url_key}")
        )
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return InlineKeyboardMarkup(buttons)


def _store_url(context: ContextTypes.DEFAULT_TYPE, url: str) -> str:
    """Store URL in bot_data with a short key and return the key."""
    key = uuid.uuid4().hex[:12]   # 12 chars – well within 64-byte limit
    context.bot_data[key] = url
    return key


def _get_url(context: ContextTypes.DEFAULT_TYPE, key: str) -> str | None:
    """Retrieve a stored URL by key."""
    return context.bot_data.get(key)


# ── API helpers ───────────────────────────────────────────────────────────────

async def _post_download(session: aiohttp.ClientSession, url: str, quality: str = "best") -> str:
    """Start a download job and return job_id."""
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/download"
    async with session.post(endpoint, params={"url": url, "quality": quality}) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"API {resp.status}: {body[:300]}")
        data = await resp.json()
        return data["job_id"]


async def _poll_result(session: aiohttp.ClientSession, job_id: str) -> dict:
    """Fetch current job state."""
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/result/{job_id}"
    async with session.get(endpoint) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Result endpoint {resp.status}")
        return await resp.json()


# ── Core download flow (reusable) ─────────────────────────────────────────────

async def _run_download(message: Message, context: ContextTypes.DEFAULT_TYPE,
                        url: str, quality: str, status_msg: Message) -> None:
    """Shared download logic used by both direct URL and quality button handlers."""
    timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS)

    quality_labels = {q: l for l, q in QUALITY_OPTIONS}
    quality_label = quality_labels.get(quality, quality)

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # Step 1 – start job
            job_id = await _post_download(session, url, quality)
            await status_msg.edit_text(
                f"✅ تم استلام الطلب\n"
                f"📊 الجودة: *{quality_label}*\n"
                f"🆔 `{job_id[:8]}…`\n\n"
                f"⏳ في انتظار بدء التحميل...",
                parse_mode="Markdown",
            )

            # Step 2 – poll until done
            for attempt in range(MAX_POLL_ATTEMPTS):
                job = await _poll_result(session, job_id)
                status = job.get("status", "")
                pct = job.get("progress", 0.0)
                text = job.get("text", "")

                if status == "done":
                    break

                if status == "error":
                    err = job.get("error", "خطأ غير معروف")
                    await status_msg.edit_text(f"❌ فشل التحميل:\n{err[:500]}")
                    return

                # Update progress message every poll
                bar = _progress_bar(pct)
                try:
                    await status_msg.edit_text(
                        f"{text}\n{bar}",
                        parse_mode=None,
                    )
                    await context.bot.send_chat_action(
                        chat_id=message.chat_id,
                        action=ChatAction.UPLOAD_VIDEO,
                    )
                except Exception:
                    pass  # ignore if message unchanged (Telegram rejects identical edits)

                await asyncio.sleep(POLL_INTERVAL)

            else:
                await status_msg.edit_text("⌛ انتهت مهلة الانتظار. حاول مجدداً.")
                return

            # Step 3 – send video
            file_path = Path(job.get("file", ""))
            if not file_path.exists():
                await status_msg.edit_text("❌ الملف غير موجود على السيرفر.")
                return

            duration = job.get("duration", 0)
            width = job.get("width", 0)
            height = job.get("height", 0)
            thumbnail_path_str = job.get("thumbnail")
            thumbnail_path = Path(thumbnail_path_str) if thumbnail_path_str else None

            is_audio = file_path.suffix.lower() in {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".opus"} or (width == 0 and height == 0)

            # ── Enhancement step ──────────────────────────────────────────────
            if quality == "enhance" and not is_audio:
                from core.worker import enhance_video
                await status_msg.edit_text(
                    "✨ *جاري تحسين الجودة بـ FFmpeg...*\n"
                    "هذا يستغرق لحظة إضافية ⏳",
                    parse_mode="Markdown",
                )
                file_path = await enhance_video(file_path)

            if is_audio:
                await status_msg.edit_text("📤 جاري إرسال الصوت إليك...")
            elif quality == "enhance":
                await status_msg.edit_text("📤 جاري إرسال الفيديو المحسّن إليك... ✨")
            else:
                await status_msg.edit_text("📤 جاري إرسال الفيديو إليك...")


            redownload_key = _store_url(context, url)
            keyboard = InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔄 تحميل مجدداً", callback_data=f"rd|{redownload_key}")]]
            )

            thumbnail_file = None
            try:
                if thumbnail_path and thumbnail_path.exists():
                    thumbnail_file = open(thumbnail_path, "rb")

                with open(file_path, "rb") as media_file:
                    if is_audio:
                        await message.reply_audio(
                            audio=media_file,
                            duration=duration if duration > 0 else None,
                            title="مقطع صوتي",
                            performer="بوت التحميل",
                            caption=f"✅ تم التحميل بنجاح\n🔗 @smart_creators_bot",
                            reply_markup=keyboard,
                            write_timeout=120,
                            read_timeout=120,
                            connect_timeout=120,
                        )
                    else:
                        await message.reply_video(
                            video=media_file,
                            thumbnail=thumbnail_file,
                            duration=duration if duration > 0 else None,
                            width=width if width > 0 else None,
                            height=height if height > 0 else None,
                            caption=f"✅ تم التحميل بنجاح | {quality_label}\n🔗 @smart_creators_bot",
                            reply_markup=keyboard,
                            supports_streaming=True,
                            write_timeout=120,
                            read_timeout=120,
                            connect_timeout=120,
                        )
            finally:
                if thumbnail_file:
                    thumbnail_file.close()

            await status_msg.delete()

    except aiohttp.ClientError as exc:
        logger.exception("Network error")
        await status_msg.edit_text(f"❌ خطأ في الاتصال بالسيرفر:\n{exc}")
    except Exception as exc:
        logger.exception("Unhandled error")
        await status_msg.edit_text(f"❌ خطأ:\n{exc}")


# ── Handlers ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "👋 *مرحباً!*\n\n"
        "أرسل لي رابط فيديو من أي منصة مدعومة (يوتيوب، تيك توك، انستغرام…) "
        "وسأعطيك خيار تحديد جودة الفيديو قبل التحميل.\n\n"
        "📌 الحد الأقصى للحجم: 50 MB",
        parse_mode="Markdown",
    )


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    url = _extract_url(message.text)
    if not url:
        await message.reply_text("❌ الرجاء إرسال رابط صحيح يبدأ بـ http/https")
        return

    # Show quality selection keyboard
    url_key = _store_url(context, url)
    await message.reply_text(
        "🎬 *اختر جودة الفيديو:*\n\n"
        f"🔗 `{url[:60]}{'…' if len(url) > 60 else ''}`",
        parse_mode="Markdown",
        reply_markup=_quality_keyboard(url_key),
    )


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    await query.answer()

    data = query.data or ""

    # ── Quality selection ──────────────────────────────────────────────────────
    if data.startswith("q|"):
        parts = data.split("|", 2)
        if len(parts) != 3:
            return
        _, quality, url_key = parts
        url = _get_url(context, url_key)
        if not url:
            await query.message.edit_text("❌ انتهت صلاحية الطلب. أرسل الرابط من جديد.")
            return

        quality_labels = {q: l for l, q in QUALITY_OPTIONS}
        quality_label = quality_labels.get(quality, quality)

        # Edit the selection message to show "downloading" status
        await query.message.edit_text(
            f"🚀 جاري بدء التحميل...\n"
            f"📊 الجودة المختارة: *{quality_label}*",
            parse_mode="Markdown",
        )

        await _run_download(
            message=query.message,
            context=context,
            url=url,
            quality=quality,
            status_msg=query.message,
        )

    # ── Re-download ────────────────────────────────────────────────────────────
    elif data.startswith("rd|"):
        rd_key = data.split("|", 1)[1]
        url = _get_url(context, rd_key)
        if not url:
            await query.message.reply_text("❌ انتهت صلاحية الطلب. أرسل الرابط من جديد.")
            return
        url_key = _store_url(context, url)
        await query.message.reply_text(
            "🎬 *اختر جودة الفيديو للتحميل مجدداً:*",
            parse_mode="Markdown",
            reply_markup=_quality_keyboard(url_key),
        )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle exceptions gracefully, especially when a user blocks the bot."""
    if isinstance(context.error, Forbidden):
        logger.warning("⚠️ Bot was blocked by the user or lacks permissions.")
        return
    logger.error("❌ Exception while handling an update:", exc_info=context.error)


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError(
            "❌ TELEGRAM_BOT_TOKEN مفقود – ضعه في ملف .env"
        )

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        level=logging.INFO,
    )

    from telegram.request import HTTPXRequest

    # Configure custom HTTP client timeouts globally for all requests
    request_config = HTTPXRequest(
        connect_timeout=60.0,
        read_timeout=60.0,
        write_timeout=120.0,
    )

    app = Application.builder().token(BOT_TOKEN).request(request_config).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_error_handler(error_handler)

    logger.info("🤖 Bot polling started | API: %s", DOWNLOAD_API_URL)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
