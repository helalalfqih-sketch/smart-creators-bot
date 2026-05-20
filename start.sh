#!/bin/bash
# start.sh – Launches both the FastAPI server and the Telegram bot together.
# Cloud Run only needs the HTTP port open; the bot uses long-polling (no inbound port needed).

set -e

echo "🚀 Starting FastAPI server on port ${PORT:-8080}..."
uvicorn main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8080}" \
    --workers 1 \
    --log-level info &
API_PID=$!

echo "🤖 Starting Telegram bot (polling)..."
python bot.py &
BOT_PID=$!

echo "✅ Both services started. API PID=$API_PID | Bot PID=$BOT_PID"

# If either process dies, kill the other and exit (Cloud Run will restart the container)
wait -n $API_PID $BOT_PID
EXIT_CODE=$?
echo "⚠️ A process exited with code $EXIT_CODE. Stopping all..."
kill $API_PID $BOT_PID 2>/dev/null || true
exit $EXIT_CODE
