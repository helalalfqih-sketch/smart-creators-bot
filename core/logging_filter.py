"""
core/logging_filter.py
Centralized logging filter for redacting sensitive credentials and identifiers:
- Telegram Bot Tokens (e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ)
- Chat IDs (masked to ***last4)
- Sensitive URL query parameters (e.g. ?token=..., ?sig=..., ?key=...)
- S3 / R2 presigned signature tokens and access keys
"""
from __future__ import annotations

import logging
import re
from typing import Any

# Pattern for Telegram Bot Token: 8-12 digits followed by colon and 30-45 alphanumeric/dash/underscore chars
_BOT_TOKEN_PATTERN = re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,45}\b")

# Pattern for Redis auth passwords in URLs: redis://:password@host or redis://user:password@host
_REDIS_AUTH_PATTERN = re.compile(r"(redis(?:s)?://)(?:[^@/\s]+@)")

# Pattern for URLs with sensitive query parameters: mask query strings or tracking/signature params
_URL_QUERY_PATTERN = re.compile(
    r"(https?://[^\s\"\'<>]+)\?([^\s\"\'<>]+)"
)

# Pattern for ChatID logging: "ChatID: 123456789" or "chat_id=123456789"
_CHAT_ID_PATTERN = re.compile(r"(?i)\b(chat[-_]?id\s*[:=]\s*)([+-]?\d+)\b")

# Pattern for S3 Access Key ID (AKIA... or standard 20-32 alnum keys)
_S3_KEY_PATTERN = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


def redact_text(text: str) -> str:
    """Sanitize any sensitive credentials, identifiers, and parameters from a string."""
    if not text or not isinstance(text, str):
        return text

    # Redact Telegram Bot Token
    text = _BOT_TOKEN_PATTERN.sub("[REDACTED_BOT_TOKEN]", text)

    # Redact Redis Auth
    text = _REDIS_AUTH_PATTERN.sub(r"\1***@", text)

    # Redact S3 Key
    text = _S3_KEY_PATTERN.sub("[REDACTED_S3_KEY]", text)

    # Mask ChatIDs: keep only last 4 digits
    def _mask_cid(m: re.Match) -> str:
        prefix = m.group(1)
        cid = m.group(2)
        if len(cid) > 4:
            masked = f"***{cid[-4:]}"
        else:
            masked = "***"
        return f"{prefix}{masked}"

    text = _CHAT_ID_PATTERN.sub(_mask_cid, text)

    # Clean query parameters in URLs to prevent leak of signatures/tokens
    def _clean_url_query(m: re.Match) -> str:
        base_url = m.group(1)
        query = m.group(2)
        # If the query string contains tokens, sigs, keys, or auth, strip the query string
        sensitive_keys = ("token", "sig", "key", "auth", "secret", "pass", "credential", "expires")
        if any(k in query.lower() for k in sensitive_keys):
            return f"{base_url}?[REDACTED_QUERY]"
        return m.group(0)

    text = _URL_QUERY_PATTERN.sub(_clean_url_query, text)

    return text


class RedactingFilter(logging.Filter):
    """Logging filter that scrubs sensitive information from all log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact_text(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {k: redact_text(v) if isinstance(v, str) else v for k, v in record.args.items()}
                elif isinstance(record.args, tuple):
                    record.args = tuple(redact_text(a) if isinstance(a, str) else a for a in record.args)
        except Exception:
            pass
        return True


def install_redacting_filter(logger: logging.Logger | None = None) -> None:
    """Attach RedactingFilter to the given logger and its handlers (or root logger if None)."""
    target = logger or logging.getLogger()
    flt = RedactingFilter()
    target.addFilter(flt)
    for h in target.handlers:
        h.addFilter(flt)
