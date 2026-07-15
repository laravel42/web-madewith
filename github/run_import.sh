#!/usr/bin/env bash
# Scheduled resume-and-qualify for the published-JSON backfill (LaunchAgent
# com.madewith.github-import). Each run resumes `import_published.py` until the
# GitHub quota is exhausted, then re-runs `qualify` so the just-imported repos
# get domain-assigned under the current gate. Repos already imported are skipped
# for free, so it converges: once everything is imported the import step is a
# fast no-op and only qualify runs. Lockfile prevents overlap.
set -uo pipefail
cd "$(dirname "$0")"

LOG_DIR="$(pwd)/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/import.log"
LOCK="$LOG_DIR/import.lock"

if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then
  mv -f "$LOG" "$LOG.1"
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') skip — previous import run still active" >>"$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

echo "===== $(date '+%F %T') resume import =====" >>"$LOG"
.venv/bin/python import_published.py --apply >>"$LOG" 2>&1
code=$?
# import exits 0 only when it imported new repos; 10 = nothing new (skip the
# expensive qualify), anything else = error (also skip).
if [ "$code" -eq 0 ]; then
  echo "----- $(date '+%F %T') qualify (assign domains to newly imported repos) -----" >>"$LOG"
  .venv/bin/madewith-github qualify -q >>"$LOG" 2>&1
else
  echo "----- $(date '+%F %T') skip qualify (no new repos imported, exit $code) -----" >>"$LOG"
fi
echo "===== $(date '+%F %T') cycle done =====" >>"$LOG"
