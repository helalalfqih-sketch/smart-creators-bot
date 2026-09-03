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

# ── Auto-detect Worker service on Render ──────────────────────────────────────
_svc_name = os.environ.get("RENDER_SERVICE_NAME", "").lower()
_svc_type = os.environ.get("SERVICE_TYPE", "").lower()
if "worker" in _svc_name or _svc_type == "worker":
    print(f"👷 Detected Worker service ({_svc_name or 'worker'}). Starting run_worker.py...")
    _proc = subprocess.run([sys.executable, "run_worker.py"])
    sys.exit(_proc.returncode)

PORT = os.environ.get("PORT", "8080")

# ── Fix port mismatch ──────────────────────────────────────────────────────────
# Railway/Render sets PORT for external traffic.
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

print("👷 Starting background RQ worker...")
worker_proc = subprocess.Popen([sys.executable, "run_worker.py"])

print(f"✅ API PID={api_proc.pid} | Bot PID={bot_proc.pid} | Worker PID={worker_proc.pid}")


def shutdown(signum, frame):
    print("⚠️ Shutting down...")
    api_proc.terminate()
    if bot_proc and bot_proc.poll() is None:
        bot_proc.terminate()
    if worker_proc and worker_proc.poll() is None:
        worker_proc.terminate()
    sys.exit(0)


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)

# Monitor processes — keep API alive even if bot exits due to bad token
while True:
    time.sleep(5)
    if api_proc.poll() is not None:
        print(f"❌ API process exited with code {api_proc.returncode}. Exiting...")
        if bot_proc and bot_proc.poll() is None:
            bot_proc.terminate()
        if worker_proc and worker_proc.poll() is None:
            worker_proc.terminate()
        sys.exit(1)
    if bot_proc and bot_proc.poll() is not None:
        print(f"⚠️ Bot process exited with code {bot_proc.returncode}. Keeping API & Dashboard alive.")
        bot_proc = None
    if worker_proc and worker_proc.poll() is not None:
        print(f"⚠️ Worker process exited with code {worker_proc.returncode}. Restarting worker...")
        worker_proc = subprocess.Popen([sys.executable, "run_worker.py"])
