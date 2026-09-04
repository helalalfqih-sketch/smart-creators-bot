"""
Startup script: launches FastAPI and Telegram bot.
On Render, heavy RQ work stays on the dedicated worker service.
"""
import os
import subprocess
import sys
import signal
import time
from pathlib import Path

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
    print(f"Loaded .env from {_env_file}")
else:
    print(".env not found; relying on environment variables")

_svc_name = os.environ.get("RENDER_SERVICE_NAME", "").lower()
_svc_type = os.environ.get("SERVICE_TYPE", "").lower()
if "worker" in _svc_name or _svc_type == "worker":
    print(f"Detected Worker service ({_svc_name or 'worker'}). Starting run_worker.py...")
    _proc = subprocess.run([sys.executable, "run_worker.py"])
    sys.exit(_proc.returncode)

PORT = os.environ.get("PORT", "8080")
os.environ["DOWNLOAD_API_URL"] = f"http://localhost:{PORT}"
print(f"DOWNLOAD_API_URL configured for local API on port {PORT}")

print(f"Starting FastAPI on port {PORT}...")
api_proc = subprocess.Popen([
    sys.executable, "-m", "uvicorn", "main:app",
    "--host", "0.0.0.0",
    "--port", PORT,
    "--log-level", "info",
])

time.sleep(3)

print("Starting Telegram bot...")
bot_proc = subprocess.Popen([sys.executable, "bot.py"])

# Production Render services must not consume the media queue here; otherwise
# multiple processes can run expensive 4K/60 FFmpeg conversions concurrently.
# Local development keeps the old convenience behavior unless explicitly disabled.
_default_embedded_worker = "false" if _svc_name else "true"
_run_embedded_worker = os.environ.get("RUN_EMBEDDED_WORKER", _default_embedded_worker).lower() in {
    "1", "true", "yes", "on"
}
worker_proc = None
if _run_embedded_worker:
    print("Starting embedded RQ worker (local/development mode)...")
    worker_proc = subprocess.Popen([sys.executable, "run_worker.py"])
else:
    print("Embedded RQ worker disabled; dedicated worker service owns media queue")

worker_pid = worker_proc.pid if worker_proc is not None else "disabled"
print(f"API PID={api_proc.pid} | Bot PID={bot_proc.pid} | Worker={worker_pid}")


def shutdown(signum, frame):
    print("Shutting down...")
    api_proc.terminate()
    if bot_proc and bot_proc.poll() is None:
        bot_proc.terminate()
    if worker_proc and worker_proc.poll() is None:
        worker_proc.terminate()
    sys.exit(0)


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)

while True:
    time.sleep(5)
    if api_proc.poll() is not None:
        print(f"API process exited with code {api_proc.returncode}. Exiting...")
        if bot_proc and bot_proc.poll() is None:
            bot_proc.terminate()
        if worker_proc and worker_proc.poll() is None:
            worker_proc.terminate()
        sys.exit(1)

    if bot_proc and bot_proc.poll() is not None:
        print(f"Bot process exited with code {bot_proc.returncode}. Restarting...")
        bot_proc = subprocess.Popen([sys.executable, "bot.py"])

    if worker_proc and worker_proc.poll() is not None:
        print(f"Embedded worker exited with code {worker_proc.returncode}. Restarting...")
        worker_proc = subprocess.Popen([sys.executable, "run_worker.py"])
