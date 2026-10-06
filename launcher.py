"""
Startup script: launches both FastAPI (uvicorn) and Telegram bot in one process.
Uses Python subprocess to avoid bash line-ending issues on Railway/Linux.
"""
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

# ── Load .env before spawning subprocesses (inherited by children) ──────────
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    with open(_env_file, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _key, _, _val = _line.partition("=")
            _key = _key.strip()
            _val = _val.strip().strip('"').strip("'")
            if _key and _key not in os.environ:
                os.environ[_key] = _val
    print(f"✅ Loaded .env from {_env_file}")
else:
    print("⚠️  .env not found — relying on Railway environment variables")

PORT = os.environ.get("PORT", "8080")
API_STARTUP_TIMEOUT_SECONDS = max(5, int(os.environ.get("API_STARTUP_TIMEOUT_SECONDS", "60")))

# Railway exposes PORT. The bot talks to the API over loopback inside the same container.
os.environ["DOWNLOAD_API_URL"] = f"http://127.0.0.1:{PORT}"
HEALTH_URL = f"{os.environ['DOWNLOAD_API_URL']}/"
print(f"🔧 DOWNLOAD_API_URL set to {os.environ['DOWNLOAD_API_URL']}")

# Fail early with a clear diagnostic instead of a background FileNotFoundError.
if importlib.util.find_spec("yt_dlp") is None:
    print("❌ yt-dlp Python package is not installed. Install requirements.txt before startup.")
    sys.exit(1)

print(f"🚀 Starting FastAPI on port {PORT}...")
api_proc = subprocess.Popen([
    sys.executable, "-m", "uvicorn", "main:app",
    "--host", "0.0.0.0",
    "--port", PORT,
    "--log-level", "info",
])


def wait_for_api_ready() -> bool:
    deadline = time.monotonic() + API_STARTUP_TIMEOUT_SECONDS
    last_error = "not ready"

    while time.monotonic() < deadline:
        if api_proc.poll() is not None:
            print(f"❌ API process exited during startup with code {api_proc.returncode}")
            return False

        try:
            with urlopen(HEALTH_URL, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if 200 <= response.status < 300 and payload.get("status") == "ok":
                    print("✅ FastAPI health check passed")
                    return True
                last_error = f"HTTP {response.status}: {payload!r}"
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            last_error = str(exc)

        time.sleep(0.5)

    print(f"❌ FastAPI did not become ready within {API_STARTUP_TIMEOUT_SECONDS}s: {last_error}")
    return False


if not wait_for_api_ready():
    api_proc.terminate()
    sys.exit(1)

print("🤖 Starting Telegram bot...")
bot_proc = subprocess.Popen([sys.executable, "bot.py"])

print(f"✅ API PID={api_proc.pid} | Bot PID={bot_proc.pid}")


def shutdown(signum, frame):
    print("⚠️ Shutting down...")
    api_proc.terminate()
    bot_proc.terminate()
    sys.exit(0)


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)

# Monitor both processes — restart container if either dies
while True:
    time.sleep(5)
    if api_proc.poll() is not None:
        print(f"❌ API process exited with code {api_proc.returncode}. Exiting...")
        bot_proc.terminate()
        sys.exit(1)
    if bot_proc.poll() is not None:
        print(f"❌ Bot process exited with code {bot_proc.returncode}. Exiting...")
        api_proc.terminate()
        sys.exit(1)
