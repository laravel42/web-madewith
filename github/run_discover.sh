#!/usr/bin/env bash
# Scheduled launcher for `madewith-github discover` (see the LaunchAgent
# com.madewith.github-discover). Runs from the github package directory so the
# CLI picks up .env and the venv, logs to github/logs/discover.log, and uses a
# lockfile so a still-running (or manual) run never overlaps the next one.
set -uo pipefail
cd "$(dirname "$0")"

LOG_DIR="$(pwd)/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/discover.log"
LOCK="$LOG_DIR/discover.lock"

# Rotate once the log passes ~10 MB.
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then
  mv -f "$LOG" "$LOG.1"
fi

# Atomic lock via mkdir; skip this run if a previous one is still active.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') skip — previous discover run still active" >>"$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

echo "===== $(date '+%F %T') discover start =====" >>"$LOG"
.venv/bin/madewith-github discover >>"$LOG" 2>&1
code=$?
echo "===== $(date '+%F %T') discover end (exit $code) =====" >>"$LOG"
exit "$code"
