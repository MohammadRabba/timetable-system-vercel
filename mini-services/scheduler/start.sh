#!/bin/bash
# Start the OR-Tools CP-SAT scheduler microservice, fully detached.
# The Next.js dev server's hot-reload would otherwise kill a normally-backgrounded
# Python process. Using setsid -f puts the service in its own session so it
# survives Next.js reloads.

set -e
cd "$(dirname "$0")"

# Check if already running
if curl -s http://127.0.0.1:3040/health > /dev/null 2>&1; then
  echo "✓ Scheduler already running on port 3040"
  exit 0
fi

echo "→ Starting scheduler..."
setsid -f python3 -m uvicorn app.main:app --port 3040 --host 127.0.0.1 \
  > /tmp/scheduler.log 2>&1 < /dev/null &

# Wait for it
for i in $(seq 1 10); do
  if curl -s http://127.0.0.1:3040/health > /dev/null 2>&1; then
    echo "✓ Scheduler started (PID: $(pgrep -f 'uvicorn.*3040' | head -1))"
    curl -s http://127.0.0.1:3040/health
    echo
    exit 0
  fi
  sleep 0.5
done

echo "✗ Scheduler failed to start"
tail -10 /tmp/scheduler.log
exit 1
