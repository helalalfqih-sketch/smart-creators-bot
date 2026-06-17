"""
Telegram Bot (Polling mode) - Fully Automated High-Quality Downloader.

Flow:
  1. User sends a video URL.
  2. Bot automatically extracts URL and starts downloading at the platform's highest quality (8K/4K/Best).
  3. Bot polls /result/{job_id} every 3 s, updating a temporary status message.
  4. Once done, bot sends the final file to the channel permanently.
  5. Bot automatically deletes the user's link message and the status message to keep the feed pristine.
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

# Quality options: kept for labels mapping
QUALITY_OPTIONS = [
    ("🎧 صوت MP3",   "audio"),
    ("📱 144p",  "144"),
    ("📺 360p",  "360"),
    ("🎞 480p",  "480"),
    ("🎬 720p",  "720"),
    ("🖥 1080p", "1080"),
    ("⚡ أفضل جودة", "best"),
    ("✨ تحسين الجودة", "enhance"),
    ("🚀 نشر احترافي", "pro"),
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


def _store_url(context: ContextTypes.DEFAULT_TYPE, url: str) -> str:
    """Store URL in bot_data with a short key and return the key."""
    key = uuid.uuid4().hex[:12]   # 12 chars – well within 64-byte limit
    context.bot_data[key] = url
    return key


def _get_url(context: ContextTypes.DEFAULT_TYPE, key: str) -> str | None:
    """Retrieve a stored URL by key."""
    return context.bot_data.get(key)


async def _safe_delete(context: ContextTypes.DEFAULT_TYPE, chat_id: int, message_id: int | None) -> None:
    """Safely delete a message without crashing if it doesn't exist or if permissions lack."""
    if message_id:
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=message_id)
        except Exception:
            pass


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


# ── Core download flow ────────────────────────────────────────────────────────

async def _run_download(message: Message, context: ContextTypes.DEFAULT_TYPE,
                        url: str, quality: str, status_msg: Message, user_msg_id: int | None = None) -> None:
    """Shared download logic used by both direct URL and quality button handlers."""
    timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS)

    quality_labels = {q: l for l, q in QUALITY_OPTIONS}
    quality_label = quality_labels.get(quality, "جودة المنصة الأصلية")

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
                    if "Unsupported URL" in err and "/photo/" in err:
                        await status_msg.edit_text(
                            "❌ هذا منشور صور وليس فيديو.\n"
                            "⚠️ سيتم تنظيف القناة تلقائياً..."
                        )
                    else:
                        await status_msg.edit_text(
                            "❌ فشل التحميل: الرابط غير مدعوم أو غير صحيح.\n"
                            "⚠️ سيتم تنظيف القناة تلقائياً..."
                        )
                    
                    await asyncio.sleep(4)
                    await _safe_delete(context, message.chat_id, user_msg_id)
                    await _safe_delete(context, message.chat_id, status_msg.message_id)
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
                    pass  # ignore if message unchanged

                await asyncio.sleep(POLL_INTERVAL)

            else:
                await status_msg.edit_text("⌛ انتهت مهلة الانتظار. سيتم حذف هذا التنبيه...")
                await asyncio.sleep(4)
                await _safe_delete(context, message.chat_id, user_msg_id)
                await _safe_delete(context, message.chat_id, status_msg.message_id)
                return

            # Step 3 – send video
            file_path = Path(job.get("file", ""))
            if not file_path.exists():
                await status_msg.edit_text("❌ الملف غير موجود على السيرفر.")
                await asyncio.sleep(4)
                await _safe_delete(context, message.chat_id, user_msg_id)
                await _safe_delete(context, message.chat_id, status_msg.message_id)
                return

            duration = job.get("duration", 0)
            width = job.get("width", 0)
            height = job.get("height", 0)
            thumbnail_path_str = job.get("thumbnail")
            thumbnail_path = Path(thumbnail_path_str) if thumbnail_path_str else None

            _pure_audio_exts = {".mp3", ".wav", ".ogg", ".flac"}
            _maybe_audio_exts = {".m4a", ".aac", ".opus"}
            _ext = file_path.suffix.lower()
            is_audio = (
                quality == "audio"
                or _ext in _pure_audio_exts
                or (_ext in _maybe_audio_exts and width == 0 and height == 0)
                or (width == 0 and height == 0 and quality != "audio" and _ext not in _pure_audio_exts
                    and _ext not in _maybe_audio_exts)
            )

            if is_audio:
                await status_msg.edit_text("📤 جاري إرسال الصوت إليك...")
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
                            write_timeout=300,
                            read_timeout=300,
                            connect_timeout=300,
                        )
                    else:
                        await message.reply_video(
                            video=media_file,
                            thumbnail=thumbnail_file,
                            duration=duration if duration > 0 else None,
                            width=width if width > 0 else None,
                            height=height if height > 0 else None,
                            caption=f"✅ تم التحميل بالجودة الأصلية للمنصة 💎\n🔗 @smart_creators_bot",
                            reply_markup=keyboard,
                            supports_streaming=True,
                            write_timeout=300,
                            read_timeout=300,
                            connect_timeout=300,
                        )
            finally:
                if thumbnail_file:
                    thumbnail_file.close()

            # التخلص النهائي من الرسائل المؤقتة ورابط المستخدم لتصفية القناة تماماً
            await _safe_delete(context, message.chat_id, user_msg_id)
            await _safe_delete(context, message.chat_id, status_msg.message_id)

    except aiohttp.ClientError as exc:
        logger.exception("Network error")
        await status_msg.edit_text("❌ خطأ في الاتصال بالسيرفر الخلفي.")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, user_msg_id)
        await _safe_delete(context, message.chat_id, status_msg.message_id)
    except Exception as exc:
        logger.exception("Unhandled error")
        await status_msg.edit_text("❌ حدث خطأ غير متوقع أثناء المعالجة.")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, user_msg_id)
        await _safe_delete(context, message.chat_id, status_msg.message_id)


# ── Pro Pipeline ──────────────────────────────────────────────────────────────

async def _run_pro_pipeline(
    message: Message,
    context: ContextTypes.DEFAULT_TYPE,
    video_path: Path,
    watermark: str,
    status_msg: Message,
    user_msg_id: int | None = None,
    watermark_msg_id: int | None = None,
) -> None:
    """تشغيل البايبلاين الاحترافي: تفريغ صوتي + كابشن + watermark."""
    from core.captions import make_pro_video

    async def on_progress(text: str, pct: float) -> None:
        bar = _progress_bar(pct)
        try:
            await status_msg.edit_text(f"{text}\n{bar}")
        except Exception:
            pass

    try:
        pro_path = await make_pro_video(
            video_path=video_path,
            watermark=watermark,
            on_progress=on_progress,
        )

        await status_msg.edit_text("📤 جاري إرسال الفيديو الاحترافي... 🚀")

        with open(pro_path, "rb") as f:
            await message.reply_video(
                video=f,
                caption=f"🚀 فيديو احترافي | {watermark}\n🔗 @smart_creators_bot",
                supports_streaming=True,
                write_timeout=300,
                read_timeout=300,
                connect_timeout=60,
            )

        # مسح شامل لرسائل النشر الاحترافي لتبقى نظيفة
        await _safe_delete(context, message.chat_id, user_msg_id)
        await _safe_delete(context, message.chat_id, watermark_msg_id)
        await _safe_delete(context, message.chat_id, status_msg.message_id)

        try:
            pro_path.unlink()
        except OSError:
            pass

    except Exception as exc:
        logger.exception("Pro pipeline error")
        await status_msg.edit_text("❌ حدث خطأ أثناء معالجة الفيديو الاحترافي.")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, user_msg_id)
        await _safe_delete(context, message.chat_id, watermark_msg_id)
        await _safe_delete(context, message.chat_id, status_msg.message_id)


async def handle_watermark_reply(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """يستقبل اسم الواترمارك من المستخدم ويبدأ البايبلاين."""
    message = update.effective_message
    if not message or not message.text:
        return

    user_id = update.effective_user.id if update.effective_user else 0
    pending_key = f"pro_pending_{user_id}"
    pending = context.bot_data.get(pending_key)

    if not pending:
        await handle_url(update, context)
        return

    del context.bot_data[pending_key]

    video_path = Path(pending["video_path"])
    watermark = message.text.strip()
    
    user_msg_id = pending.get("user_msg_id")
    watermark_msg_id = message.message_id

    if not video_path.exists():
        await message.reply_text("❌ الفيديو انتهت صلاحيته. أرسل الرابط من جديد.")
        return

    status_msg = await message.reply_text(
        f"✅ سيتم إضافة \"*{watermark}*\" كفاصل 🚀\n"
        f"🎤 جاري تفريغ الكلام...",
        parse_mode="Markdown",
    )

    await _run_pro_pipeline(
        message=message,
        context=context,
        video_path=video_path,
        watermark=watermark,
        status_msg=status_msg,
        user_msg_id=user_msg_id,
        watermark_msg_id=watermark_msg_id,
    )


# ── Handlers ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "👋 *مرحباً!*\n\n"
        "أرسل لي رابط فيديو من أي منصة مدعومة وسأقوم بتحميله تلقائياً بأعلى جودة متاحة للمنشور الأصل (4K/8K/Best).\n\n"
        "📌 الحد الأقصى للحجم: 50 MB",
        parse_mode="Markdown",
    )


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    url = _extract_url(message.text)
    if not url:
        # إذا لم يكن الرابط صحيحاً، يرسل تنبيه ثم يمسحه ومعه رسالة المستخدم لتنظيف القناة
        err_msg = await message.reply_text("❌ الرجاء إرسال رابط صحيح يبدأ بـ http/https")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, message.message_id)
        await _safe_delete(context, message.chat_id, err_msg.message_id)
        return

    # 1. إرسال رسالة حالة مؤقتة تفيد بفحص الرابط والتحميل بالجودة الأصلية للمنصة
    status_msg = await message.reply_text(
        "⏳ *جاري فحص الرابط والتحميل بالجودة الأصلية للمنصة تلقائياً...*",
        parse_mode="Markdown"
    )

    # 2. استدعاء دالة التحميل وتمرير "best" ليتكيف السيرفر مع جودة الفيديو الأصلية (8K, 4K, 1080p...)
    await _run_download(
        message=message,
        context=context,
        url=url,
        quality="best",  # <--- تضمن النزول التلقائي والذكي حسب جودة الفيديو الأصلية
        status_msg=status_msg,
        user_msg_id=message.message_id, # تمرير رقم رسالة المستخدم لحذفها لاحقاً وتصفية القناة
    )


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    await query.answer()

    data = query.data or ""

    if data.startswith("rd|"):
        rd_key = data.split("|", 1)[1]
        url = _get_url(context, rd_key)
        if not url:
            await query.message.reply_text("❌ انتهت صلاحية الطلب.")
            return
        
        # عند إعادة التحميل يتم التنزيل المباشر بأعلى جودة أصلية تلقائياً دون إظهار أزرار
        status_msg = await query.message.reply_text(
            "⏳ *جاري إعادة تحميل المقطع بالجودة الأصلية للمنصة تلقائياً...*",
            parse_mode="Markdown"
        )
        
        await _run_download(
            message=query.message,
            context=context,
            url=url,
            quality="best",
            status_msg=status_msg,
            user_msg_id=None,
        )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    if isinstance(context.error, Forbidden):
        logger.warning("⚠️ Bot was blocked by the user or lacks permissions.")
        return
    logger.error("❌ Exception while handling an update:", exc_info=context.error)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("❌ TELEGRAM_BOT_TOKEN مفقود – ضعه في ملف .env")

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

    app = Application.builder().token(BOT_TOKEN).request(request_config).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_watermark_reply))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_error_handler(error_handler)

    logger.info("🤖 Bot polling started | API: %s", DOWNLOAD_API_URL)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
