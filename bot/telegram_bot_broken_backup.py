from __future__ import annotations

import asyncio
import logging
import re  # تم إضافة مكتبة التعبيرات النمطية لتنظيف الروابط
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from telegram import (
    Message,
    Update,
)
from telegram.constants import ChatAction
from telegram.error import Forbidden

from telegram.ext import (
    Application,
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

# إعدادات تسجيل الأخطاء
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

logger = logging.getLogger("bot")

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.error(f"Update {update} caused error {context.error}")
    await context.bot.send_message(chat_id='YOUR_CHAT_ID', text=f"Error: {context.error}")

# إعداد التطبيق
application = Application.builder().token(BOT_TOKEN).build()

# إضافة معالج الأخطاء
application.add_error_handler(error_handler)

POLL_INTERVAL = 3          
MAX_POLL_ATTEMPTS = 100    
