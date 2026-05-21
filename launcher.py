"""
Startup script: launches both FastAPI (uvicorn) and Telegram bot in one process.
Uses Python subprocess to avoid bash line-ending issues on Railway/Linux.
"""
import os
import subprocess
import sys
import signal
import time

PORT = os.environ.get("PORT", "8080")

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
