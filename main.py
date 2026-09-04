"""
Entry point: FastAPI server (uvicorn).

Run with:
    python main.py
or:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


def _load_env(env_path: Path = Path(".env")) -> None:
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env()

from core.config import API_HOST, API_PORT, LOG_LEVEL  # noqa: E402 (after env load)
from api.server import app  # noqa: E402  (re-export for uvicorn)
from fastapi import Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from core.logging_filter import install_redacting_filter

_dashboard_log = RotatingFileHandler(
    "dashboard.log",
    maxBytes=5_000_000,
    backupCount=2,
    encoding="utf-8",
)
logging.basicConfig(
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    handlers=[logging.StreamHandler(), _dashboard_log],
    force=True,
)
install_redacting_filter()
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


@app.middleware("http")
async def disable_legacy_telegram_dashboard_paths(request: Request, call_next):
    """Keep Telegram polling single-owner in bot.py.

    The legacy dashboard used /api/telegram/toggle-daemon and
    /api/telegram/recent-updates to start an extra poller and to synthesize
    historical jobs back into fake Telegram updates. That caused 409 conflicts,
    duplicate UI events, and exposed URL/chat data. Production Telegram ingress
    now belongs exclusively to bot.py.
    """
    path = request.url.path
    if path == "/api/telegram/toggle-daemon":
        return JSONResponse(
            {
                "ok": True,
                "isRunning": True,
                "running": True,
                "managedBy": "bot.py",
                "message": "Telegram polling is managed by the production bot service",
            }
        )
    if path == "/api/telegram/recent-updates":
        return JSONResponse({"ok": True, "updates": []})
    return await call_next(request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=False,
        log_level=LOG_LEVEL.lower(),
    )
