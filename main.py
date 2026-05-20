"""
Entry point: FastAPI server (uvicorn).

Run with:
    python main.py
or:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""
import logging
import os
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

logging.basicConfig(
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    level=getattr(logging, LOG_LEVEL, logging.INFO),
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=False,
        log_level=LOG_LEVEL.lower(),
    )
