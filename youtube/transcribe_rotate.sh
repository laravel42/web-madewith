#!/usr/bin/env bash
# Rotate VPN exit locations between transcription chunks so a YouTube IP flag
# on one location doesn't stall the whole queue.
#
# Works with any provider that offers manual WireGuard configs (SurfShark:
# dashboard → VPN → Manual setup → WireGuard → download one .conf per
# location). The transcriber fails fast after 3 consecutive blocked requests
# and exits 75; this wrapper catches that, switches to the next location, and
# resumes — the queue is DB-driven and idempotent, so nothing is lost.
#
# Setup (macOS):
#   brew install wireguard-tools
#   mkdir -p ~/vpn-wg && <download configs there>
#
# Usage (run as your normal user; sudo is used only for wg-quick):
#   youtube/transcribe_rotate.sh ~/vpn-wg [chunk-size] [sleep-seconds] [workers]
# workers: concurrent fetchers per location (default 2). All workers share one
# exit IP, so more workers = faster fetching but faster location burn; 2-3 is
# the sweet spot, rotation absorbs the burns.
set -uo pipefail

CONF_DIR="${1:?usage: transcribe_rotate.sh <wireguard-conf-dir> [chunk] [sleep] [workers]}"
CHUNK="${2:-100}"
SLEEP="${3:-1}"
WORKERS="${4:-2}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$DIR/.venv/bin/python"
BLOCK_EXIT=75
MAX_PASSES=3   # full cycles through every location before giving up

configs=("$CONF_DIR"/*.conf)
if [ ! -e "${configs[0]}" ]; then
  echo "No .conf files in $CONF_DIR" >&2
  exit 1
fi

# wg-quick is a bash script that needs bash 4+; macOS ships 3.2 and sudo's
# PATH finds only that one. Run it through Homebrew's bash explicitly.
WG_QUICK="$(command -v wg-quick || true)"
if [ -z "$WG_QUICK" ]; then
  echo "wg-quick not found — brew install wireguard-tools" >&2
  exit 1
fi
MODERN_BASH=""
for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash /usr/bin/bash /bin/bash; do
  if [ -x "$candidate" ] && [ "$("$candidate" -c 'echo "${BASH_VERSINFO[0]}"')" -ge 4 ]; then
    MODERN_BASH="$candidate"
    break
  fi
done
if [ -z "$MODERN_BASH" ]; then
  echo "wg-quick needs bash 4+ and only bash 3 was found — run: brew install bash" >&2
  exit 1
fi

echo "${#configs[@]} location(s), chunk=$CHUNK, sleep=${SLEEP}s, workers=$WORKERS"

current=""
came_up=0
wg() { sudo "$MODERN_BASH" "$WG_QUICK" "$@"; }
vpn_down() {
  if [ -n "$current" ]; then
    wg down "$current" >/dev/null 2>&1 || true
    current=""
  fi
}
vpn_up() {
  vpn_down
  if ! wg up "$1"; then
    echo "wg-quick up failed for $(basename "$1") — skipping location" >&2
    return 1
  fi
  came_up=1
  current="$1"
  local ip
  ip="$(curl -s --max-time 10 https://api.ipify.org || echo '?')"
  echo ""
  echo "=== location $(basename "$1" .conf) — exit IP $ip ==="
}
trap vpn_down EXIT

log="$(mktemp "${TMPDIR:-/tmp}/transcribe-rotate.XXXXXX")"
loc=0
pass=0
while [ "$pass" -lt "$MAX_PASSES" ]; do
  conf="${configs[$((loc % ${#configs[@]}))]}"
  if ! vpn_up "$conf"; then
    loc=$((loc + 1))
    [ $((loc % ${#configs[@]})) -eq 0 ] && pass=$((pass + 1))
    continue
  fi

  # Run chunks on this location until it gets blocked or the queue empties.
  while true; do
    "$PY" "$DIR/transcribe_youtube.py" --limit "$CHUNK" --sleep "$SLEEP" --workers "$WORKERS" | tee "$log"
    code=${PIPESTATUS[0]}
    if grep -q "Processing 0 videos" "$log"; then
      echo ""
      echo "Queue empty — all pending videos transcribed."
      exit 0
    fi
    if [ "$code" -eq "$BLOCK_EXIT" ]; then
      echo "Location burned — rotating."
      break
    fi
    if [ "$code" -ne 0 ]; then
      echo "Transcriber failed with exit $code (not an IP block) — stopping." >&2
      exit "$code"
    fi
    sleep 3
  done

  loc=$((loc + 1))
  [ $((loc % ${#configs[@]})) -eq 0 ] && pass=$((pass + 1))
done

if [ "$came_up" -eq 0 ]; then
  echo "No location could be brought up at all — see the wg-quick errors above (VPN app still connected? bad configs?)." >&2
  exit 1
fi
echo "Every location was blocked across $MAX_PASSES passes — wait a few hours and re-run." >&2
exit "$BLOCK_EXIT"
