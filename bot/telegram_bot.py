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

from core.config import ADMIN_API_TOKEN, BOT_TOKEN, DOWNLOAD_API_URL
from core.logging_filter import install_redacting_filter
from core.url_normalizer import get_active_job_for_url, normalize_media_url

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

def _redact_chat_id(cid: Any) -> str:
    s = str(cid or "")
    if len(s) > 4:
        return f"***{s[-4:]}"
    return "***"


def _redact_url(url_str: str) -> str:
    try:
        p = urlparse(url_str)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:
        return "[REDACTED_URL]"


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


def confirm_job_delivery(job_id: str) -> None:
    endpoint = f"{DOWNLOAD_API_URL.rstrip('/')}/jobs/{job_id}/delivered"
    headers = {"X-Admin-Token": ADMIN_API_TOKEN} if ADMIN_API_TOKEN else {}
    response = requests.post(endpoint, headers=headers, timeout=API_REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()


async def _send_result_media(context: ContextTypes.DEFAULT_TYPE, chat_id: int, result: dict) -> None:
    media_source = _telegram_media_source(result.get("file"))
    if media_source is None:
        raise ValueError(f"Result file is neither an existing file nor a public URL: {result.get('file')!r}")

    thumbnail = _telegram_media_source(result.get("thumbnail"))
    media_type = str(result.get("media_type") or "").lower()
    duration = _positive_int(result.get("duration"))
    width = _positive_int(result.get("width"))
    height = _positive_int(result.get("height"))
    job_id = result.get("job_id", "")

    if media_type == "video":
        try:
            await context.bot.send_video(
                chat_id=chat_id,
                video=media_source,
                duration=duration,
                width=width,
                height=height,
                thumbnail=thumbnail,
                supports_streaming=True,
            )
            logger.info("TELEGRAM_VIDEO_SENT job_id=%s", job_id)
        except (BadRequest, TelegramError) as exc:
            logger.warning("sendVideo rejected result; falling back to document: %s", exc)
            await context.bot.send_document(chat_id=chat_id, document=media_source)
            logger.info("TELEGRAM_DOCUMENT_SENT job_id=%s", job_id)
    elif media_type == "audio":
        try:
            await context.bot.send_audio(
                chat_id=chat_id,
                audio=media_source,
                duration=duration,
                thumbnail=thumbnail,
            )
            logger.info("TELEGRAM_AUDIO_SENT job_id=%s", job_id)
        except TelegramError as exc:
            logger.warning("sendAudio failed; falling back to document: %s", exc)
            await context.bot.send_document(chat_id=chat_id, document=media_source)
    else:
        await context.bot.send_document(chat_id=chat_id, document=media_source)
        logger.info("TELEGRAM_DOCUMENT_SENT job_id=%s", job_id)

    await asyncio.to_thread(confirm_job_delivery, job_id)


async def wait_and_send_result(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    job_id: str,
    timeout_seconds: float = 300,
    poll_interval_seconds: float = 2,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds

    conversion_notice_sent = False
    while loop.time() < deadline:
        try:
            job = await asyncio.to_thread(get_job_status, job_id)
            status = str(job.get("status") or "").lower()

            if status in {"queued", "running"}:
                if (
                    not conversion_notice_sent
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
                if not conversion_notice_sent and result.get("media_type") == "video":
                    await context.bot.send_message(
                        chat_id=chat_id,
                        text="🎬 جارٍ تجهيز نسخة 4K بمعدل 60 إطارًا...",
                    )
                    conversion_notice_sent = True
                result["job_id"] = job_id
                await _send_result_media(context, chat_id, result)
                logger.info("Telegram delivery confirmed for job %s", job_id)
                return

            if status in {"error", "failed"}:
                err_text = str(job.get("error") or "")
                err_type = "ExtractionFailed" if "extractor" in err_text.lower() else "DownloadFailed"
                logger.error("Download job %s failed: error_type=%s", job_id, err_type)
                await context.bot.send_message(chat_id=chat_id, text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")
                return

            if status == "cancelled":
                logger.warning("Download job %s was cancelled", job_id)
                await context.bot.send_message(chat_id=chat_id, text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")
                return

            logger.error("Unexpected status %r for job %s", status, job_id)
            await context.bot.send_message(chat_id=chat_id, text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")
            return

        except JobResultError as exc:
            logger.error("Cannot retrieve result for job %s (HTTP %s): %s", job_id, exc.status_code, exc)
            await context.bot.send_message(chat_id=chat_id, text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")
            return
        except Exception as exc:
            logger.error("Error polling result for job %s: %s", job_id, exc)
            await asyncio.sleep(poll_interval_seconds)

    logger.error("Timed out waiting for result of job %s (%ss)", job_id, timeout_seconds)
    await context.bot.send_message(
        chat_id=chat_id,
        text="❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.",
    )


# ── Handlers ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.info("Telegram /start command received")
    await update.effective_message.reply_text(
        "👋 *مرحباً!*\n\nأرسل الروابط مباشرة وسأقوم بتحميلها متوازية فوراً بأعلى جودة.",
        parse_mode="Markdown",
    )


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    chat_id = message.chat_id
    logger.info("TELEGRAM_UPDATE_RECEIVED update_id=%s", update.update_id)

    # In-memory update_id deduplication fallback
    seen_updates: set[int] = getattr(handle_url, "_seen_updates", None)
    if seen_updates is None:
        seen_updates = set()
        setattr(handle_url, "_seen_updates", seen_updates)
    if update.update_id in seen_updates:
        logger.info("Duplicate telegram update %s skipped (memory)", update.update_id)
        return
    seen_updates.add(update.update_id)
    if len(seen_updates) > 2000:
        seen_updates.pop()

    # Redis idempotency check
    from job_queue.connection import get_redis_connection
    redis_conn = get_redis_connection()
    if redis_conn is not None:
        try:
            key = f"media:telegram_update:{update.update_id}"
            if not redis_conn.set(key, "1", nx=True, ex=86400):
                logger.info("Duplicate telegram update %s skipped (redis)", update.update_id)
                return
        except Exception as exc:
            logger.warning("Redis idempotency check failed: %s", exc)

    url = _extract_url(message.text)
    if not url:
        err_msg = await message.reply_text("❌ الرجاء إرسال رابط صحيح يبدأ بـ http/https")
        await asyncio.sleep(4)
        await _safe_delete(context, message.chat_id, message.message_id)
        await _safe_delete(context, message.chat_id, err_msg.message_id)
        return

    # P0-3: Check if an active download already exists for this normalized URL
    norm_url = normalize_media_url(url)
    existing_job_id = get_active_job_for_url(norm_url)
    if existing_job_id:
        logger.info("JOB_DEDUPLICATED original_job_id=%s", existing_job_id)
        context.application.create_task(
            wait_and_send_result(
                context=context,
                chat_id=message.chat_id,
                job_id=existing_job_id,
            )
        )
        return

    try:
        job_id = await asyncio.to_thread(send_job, url, message.chat_id)
        logger.info("JOB_ENQUEUED job_id=%s", job_id)
        await message.reply_text("⏳ جارٍ تحميل وتجهيز الفيديو بأعلى جودة...")
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
    except Exception as exc:
        logger.error("Failed to create download job: %s", type(exc).__name__)
        await message.reply_text("❌ تعذر تنزيل أو تجهيز هذا الفيديو حاليًا.")


async def handle_other_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None:
        return
    logger.info("Non-text Telegram media received")
    await message.reply_text("ℹ️ يرجى إرسال رابط الوسائط (فيديو/ريلز/تيك توك) لتحميله مباشرة.")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    if isinstance(context.error, Forbidden):
        return
    from telegram.error import Conflict
    if isinstance(context.error, Conflict):
        logger.warning("⚠️ [Telegram] 409 Conflict: Another bot instance is active. Retrying with delay...")
        await asyncio.sleep(8)
        return
    logger.error(f"❌ [Telegram] Error while handling update: {context.error}", exc_info=context.error)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("❌ TELEGRAM_BOT_TOKEN مفقود")

    bot_log = RotatingFileHandler(
        "bot.log",
        maxBytes=10_000_000,
        backupCount=2,
        encoding="utf-8",
    )
    dash_log = RotatingFileHandler(
        "dashboard.log",
        maxBytes=10_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    log_formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    bot_log.setFormatter(log_formatter)
    dash_log.setFormatter(log_formatter)

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        level=logging.INFO,
        handlers=[logging.StreamHandler(), bot_log, dash_log],
        force=True,
    )
    install_redacting_filter()
    # Prevent httpx from logging full Telegram API URLs containing bot tokens
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    from telegram.request import HTTPXRequest

    request_config = HTTPXRequest(
        connect_timeout=60.0,
        read_timeout=60.0,
        write_timeout=120.0,
    )

    import uuid
    import time
    from job_queue.connection import get_redis_connection

    instance_id = str(uuid.uuid4())
    r = None
    try:
        r = get_redis_connection()
    except Exception:
        pass

    if r is not None:
        # Acquire leader lock to prevent overlapping polling instances during Render rolling deploys
        for _ in range(10):
            try:
                acquired = r.set("media:telegram:polling_leader", instance_id, nx=True, ex=15)
                if acquired:
                    logger.info(f"👑 [Telegram] Polling leader lock acquired ({instance_id[:8]})")
                    break
                current_leader = r.get("media:telegram:polling_leader")
                if current_leader == instance_id:
                    break
                logger.info("⏳ [Telegram] Waiting for previous bot instance to hand over polling...")
                time.sleep(2)
            except Exception:
                break

    async def _post_init(application: Application) -> None:
        async def _heartbeat_loop():
            while True:
                try:
                    conn = get_redis_connection()
                    if conn is not None:
                        conn.set("media:bot:polling_heartbeat", str(time.time()), ex=60)
                        if conn.get("media:telegram:polling_leader") == instance_id:
                            conn.expire("media:telegram:polling_leader", 15)
                except Exception:
                    pass
                await asyncio.sleep(8)

        asyncio.create_task(_heartbeat_loop())

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .request(request_config)
        .concurrent_updates(True)
        .post_init(_post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    app.add_handler(MessageHandler(~filters.COMMAND & ~filters.TEXT, handle_other_media))
    app.add_error_handler(error_handler)

    logger.info("🤖 [Telegram] Bot polling started | Real-time Dashboard Sync active")
    try:
        app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=False)
    finally:
        if r is not None:
            try:
                if r.get("media:telegram:polling_leader") == instance_id:
                    r.delete("media:telegram:polling_leader")
            except Exception:
                pass


if __name__ == "__main__":
    main()
