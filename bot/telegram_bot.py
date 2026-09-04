from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import os
import re
import tempfile
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest, Forbidden, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from core.config import ADMIN_API_TOKEN, BOT_TOKEN, DOWNLOAD_API_URL
from core.logging_filter import install_redacting_filter
from core.url_normalizer import get_active_job_for_url, normalize_media_url

logger = logging.getLogger("bot")

API_REQUEST_TIMEOUT_SECONDS = 30
RESULT_POLL_INTERVAL_SECONDS = 2
RESULT_WAIT_TIMEOUT_SECONDS = int(os.getenv("TELEGRAM_RESULT_TIMEOUT_SECONDS", "2100"))
RECENT_URL_DEDUP_SECONDS = int(os.getenv("TELEGRAM_RECENT_URL_DEDUP_SECONDS", "30"))
OPTIONAL_4K_QUALITY = "4k60"
_recent_url_claims: dict[str, float] = {}


class JobResultError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


def _extract_url(text: str) -> str | None:
    if not text:
        return None
    match = re.search(r"(https?://[^\s，]+)", text)
    if not match:
        return None
    return match.group(1).strip().rstrip(".:,;?)\"'/،")


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
        pass
    return candidate if _is_public_http_url(candidate) else None


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _claim_recent_url(chat_id: int, normalized_url: str) -> bool:
    import time

    key = f"{chat_id}:{normalized_url}"
    now = time.monotonic()
    for stale_key, claimed_at in list(_recent_url_claims.items()):
        if now - claimed_at >= RECENT_URL_DEDUP_SECONDS:
            _recent_url_claims.pop(stale_key, None)
    if key in _recent_url_claims:
        return False

    from job_queue.connection import get_redis_connection

    redis_conn = get_redis_connection()
    if redis_conn is not None:
        digest = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()
        redis_key = f"media:telegram_recent_url:{digest}:{chat_id}"
        try:
            if not redis_conn.set(redis_key, "1", nx=True, ex=RECENT_URL_DEDUP_SECONDS):
                return False
        except Exception as exc:
            logger.warning("Recent URL idempotency unavailable: %s", type(exc).__name__)
    _recent_url_claims[key] = now
    return True


def send_job(url: str, chat_id: int, quality: str = "best") -> str:
    response = requests.post(
        f"{DOWNLOAD_API_URL.rstrip('/')}/media/download",
        json={"url": url, "quality": quality, "chat_id": chat_id},
        timeout=API_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["job_id"]


def get_job_status(job_id: str) -> dict:
    response = requests.get(
        f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}",
        timeout=API_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def get_job_result(job_id: str) -> dict:
    response = requests.get(
        f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}/result",
        timeout=API_REQUEST_TIMEOUT_SECONDS,
    )
    if response.status_code == 202:
        return {"status": "pending"}
    if response.status_code in {404, 409, 410}:
        raise JobResultError(response.status_code, "result unavailable")
    response.raise_for_status()
    return response.json()


def confirm_job_delivery(job_id: str) -> None:
    headers = {"X-Admin-Token": ADMIN_API_TOKEN} if ADMIN_API_TOKEN else {}
    response = requests.post(
        f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}/delivered",
        headers=headers,
        timeout=API_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()


def _four_k_markup(job_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🎬 تحويل إلى 4K 60FPS", callback_data=f"convert4k:{job_id}")]]
    )


def _download_remote_to_temp(url: str, suffix: str = ".mp4") -> Path:
    fd, raw_path = tempfile.mkstemp(prefix="telegram-media-", suffix=suffix)
    os.close(fd)
    path = Path(raw_path)
    try:
        with requests.get(url, stream=True, timeout=(20, 180)) as response:
            response.raise_for_status()
            with path.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        output.write(chunk)
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


async def _send_result_media(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    result: dict,
    *,
    offer_4k: bool,
) -> None:
    media_source = _telegram_media_source(result.get("file"))
    if media_source is None:
        raise ValueError("Result media source is unavailable")

    media_type = str(result.get("media_type") or "").lower()
    duration = _positive_int(result.get("duration"))
    width = _positive_int(result.get("width"))
    height = _positive_int(result.get("height"))
    job_id = str(result.get("job_id") or "")
    reply_markup = _four_k_markup(job_id) if offer_4k and media_type == "video" else None

    if media_type != "video":
        await context.bot.send_document(chat_id=chat_id, document=media_source)
        logger.info("TELEGRAM_DOCUMENT_SENT job_id=%s", job_id)
        await asyncio.to_thread(confirm_job_delivery, job_id)
        return

    try:
        await context.bot.send_video(
            chat_id=chat_id,
            video=media_source,
            duration=duration,
            width=width,
            height=height,
            supports_streaming=True,
            reply_markup=reply_markup,
        )
        logger.info("TELEGRAM_VIDEO_SENT job_id=%s", job_id)
    except (BadRequest, TelegramError, asyncio.TimeoutError, ValueError) as exc:
        logger.warning("TELEGRAM_VIDEO_DIRECT_FAILED job_id=%s error_type=%s", job_id, type(exc).__name__)
        temp_path: Path | None = None
        try:
            document_source: Path | str = media_source
            if isinstance(media_source, str) and _is_public_http_url(media_source):
                logger.info("TELEGRAM_MEDIA_MATERIALIZE_STARTED job_id=%s", job_id)
                temp_path = await asyncio.to_thread(_download_remote_to_temp, media_source)
                document_source = temp_path
                logger.info("TELEGRAM_MEDIA_MATERIALIZE_COMPLETED job_id=%s", job_id)

            await context.bot.send_document(
                chat_id=chat_id,
                document=document_source,
                reply_markup=reply_markup,
            )
            logger.info("TELEGRAM_DOCUMENT_SENT job_id=%s", job_id)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    await asyncio.to_thread(confirm_job_delivery, job_id)


async def wait_and_send_result(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    job_id: str,
    timeout_seconds: float = RESULT_WAIT_TIMEOUT_SECONDS,
    poll_interval_seconds: float = RESULT_POLL_INTERVAL_SECONDS,
    *,
    conversion_notice_already_sent: bool = False,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    conversion_notice_sent = conversion_notice_already_sent

    while loop.time() < deadline:
        try:
            job = await asyncio.to_thread(get_job_status, job_id)
            status = str(job.get("status") or "").lower()
            quality = str(job.get("quality") or "best").lower()

            if status in {"queued", "running"}:
                if (
                    quality == OPTIONAL_4K_QUALITY
                    and not conversion_notice_sent
                    and str(job.get("text") or "").startswith("🎬")
                ):
                    await context.bot.send_message(
                        chat_id=chat_id,
                        text="🎬 جارٍ تجهيز نسخة 4K بمعدل 60 إطارًا...",
                    )
                    conversion_notice_sent = True
                await asyncio.sleep(poll_interval_seconds)
                continue

            if status in {"ready", "done", "completed"}:
                result = await asyncio.to_thread(get_job_result, job_id)
                if result.get("status") == "pending":
                    await asyncio.sleep(poll_interval_seconds)
                    continue
                result["job_id"] = job_id
                await _send_result_media(
                    context,
                    chat_id,
                    result,
                    offer_4k=(quality != OPTIONAL_4K_QUALITY),
                )
                logger.info("Telegram delivery confirmed for job %s", job_id)
                return

            if status in {"error", "failed", "cancelled"}:
                logger.error("Job %s ended unsuccessfully", job_id)
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.",
                )
                return

            await asyncio.sleep(poll_interval_seconds)
        except JobResultError:
            await context.bot.send_message(
                chat_id=chat_id,
                text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.",
            )
            return
        except Exception as exc:
            logger.error("Error polling job %s: %s", job_id, type(exc).__name__)
            await asyncio.sleep(poll_interval_seconds)

    logger.error("Timed out waiting for job %s", job_id)
    await context.bot.send_message(
        chat_id=chat_id,
        text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.",
    )


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message is not None:
        await update.effective_message.reply_text("أرسل رابط الفيديو وسأرسله لك بأعلى جودة متاحة.")


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    chat_id = message.chat_id
    logger.info("TELEGRAM_UPDATE_RECEIVED update_id=%s", update.update_id)

    from job_queue.connection import get_redis_connection

    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:telegram_update:{update.update_id}"
            if not redis_conn.set(key, "1", nx=True, ex=86400):
                return
        except Exception:
            pass

    url = _extract_url(message.text)
    if not url:
        return

    norm_url = normalize_media_url(url)
    if not _claim_recent_url(chat_id, norm_url):
        return

    existing_job_id = get_active_job_for_url(norm_url)
    if existing_job_id:
        logger.info("JOB_DEDUPLICATED original_job_id=%s", existing_job_id)
        context.application.create_task(
            wait_and_send_result(context, chat_id, existing_job_id),
            update=update,
            name=f"telegram-delivery-{existing_job_id}",
        )
        return

    await message.reply_text("⏳ جارٍ تنزيل الفيديو بأعلى جودة...")
    try:
        job_id = await asyncio.to_thread(send_job, url, chat_id, "best")
        logger.info("JOB_ENQUEUED job_id=%s", job_id)
        context.application.create_task(
            wait_and_send_result(context, chat_id, job_id),
            update=update,
            name=f"telegram-delivery-{job_id}",
        )
    except Exception as exc:
        logger.error("Failed to create download job: %s", type(exc).__name__)
        await message.reply_text("❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")


async def handle_convert_4k(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or not query.data or not query.data.startswith("convert4k:"):
        return

    await query.answer()
    original_job_id = query.data.split(":", 1)[1]
    if query.message is not None:
        chat_id = query.message.chat_id
    elif update.effective_chat is not None:
        chat_id = update.effective_chat.id
    else:
        return

    try:
        original = await asyncio.to_thread(get_job_status, original_job_id)
        url = str(original.get("url") or "")
        if not url:
            raise RuntimeError("source unavailable")

        from job_queue.connection import get_redis_connection
        from job_queue.job_store import create_job, mark_error
        from job_queue.queue import enqueue_download

        redis_conn = get_redis_connection()
        if redis_conn is not None:
            click_key = f"media:4k_click:{original_job_id}:{chat_id}"
            if not redis_conn.set(click_key, "1", nx=True, ex=3600):
                return

        conversion_job_id = str(uuid.uuid4())
        create_job(
            conversion_job_id,
            url=url,
            quality=OPTIONAL_4K_QUALITY,
            chat_id=chat_id,
        )
        if not enqueue_download(conversion_job_id, url, OPTIONAL_4K_QUALITY, chat_id):
            mark_error(conversion_job_id, error="Queue unavailable")
            raise RuntimeError("queue unavailable")

        if query.message is not None:
            try:
                await query.edit_message_reply_markup(reply_markup=None)
            except TelegramError:
                pass

        await context.bot.send_message(
            chat_id=chat_id,
            text="🎬 جارٍ تجهيز نسخة 4K بمعدل 60 إطارًا...",
        )
        context.application.create_task(
            wait_and_send_result(
                context,
                chat_id,
                conversion_job_id,
                conversion_notice_already_sent=True,
            ),
            update=update,
            name=f"telegram-4k-{conversion_job_id}",
        )
    except Exception as exc:
        logger.error("Failed to start optional 4K job: %s", type(exc).__name__)
        await context.bot.send_message(
            chat_id=chat_id,
            text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.",
        )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    if isinstance(context.error, Forbidden):
        return
    logger.error("Telegram handler error: %s", type(context.error).__name__)


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")

    bot_log = RotatingFileHandler(
        "bot.log", maxBytes=10_000_000, backupCount=2, encoding="utf-8"
    )
    dash_log = RotatingFileHandler(
        "dashboard.log", maxBytes=10_000_000, backupCount=3, encoding="utf-8"
    )
    formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    bot_log.setFormatter(formatter)
    dash_log.setFormatter(formatter)
    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        level=logging.INFO,
        handlers=[logging.StreamHandler(), bot_log, dash_log],
        force=True,
    )
    install_redacting_filter()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    app = Application.builder().token(BOT_TOKEN).concurrent_updates(True).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CallbackQueryHandler(handle_convert_4k, pattern=r"^convert4k:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    app.add_error_handler(error_handler)

    logger.info("Telegram production poller started")
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=False)


if __name__ == "__main__":
    main()
