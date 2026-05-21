"""
Startup script: launches both FastAPI (uvicorn) and Telegram bot in one process.
Uses Python subprocess to avoid bash line-ending issues on Railway/Linux.
"""
import os
import subprocess
import sys
import signal
import time
from pathlib import Path

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
            if _key and _key not in os.environ:   # don't override Railway vars
                os.environ[_key] = _val
    print(f"✅ Loaded .env from {_env_file}")
else:
    print("⚠️  .env not found — relying on Railway environment variables")

PORT = os.environ.get("PORT", "8080")

# ── Fix port mismatch ──────────────────────────────────────────────────────────
# Railway sets PORT (e.g. 8080) for external traffic.
# We run uvicorn on that same PORT, so override DOWNLOAD_API_URL to match.
os.environ["DOWNLOAD_API_URL"] = f"http://localhost:{PORT}"
print(f"🔧 DOWNLOAD_API_URL set to http://localhost:{PORT}")

print(f"🚀 Starting FastAPI on port {PORT}...")
api_proc = subprocess.Popen([
    sys.executable, "-m", "uvicorn", "main:app",
    "--host", "0.0.0.0",
    "--port", PORT,
    "--log-level", "info",
])

# Give API a moment to start before launching bot
time.sleep(3)

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
