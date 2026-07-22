#!/usr/bin/env bash
# One-command drivers for the MadeWithWhat data pipeline.
#
# Every underlying step is idempotent (finished work is skipped), so every
# command here is safe to re-run and resumes where the last run stopped.
#
#   ./pipeline.sh status     queue counts (DB) + local coverage
#   ./pipeline.sh videos     transcribe → enrich → rewrite descriptions → publish video JSON
#   ./pipeline.sh projects   publish project catalogs from Postgres (scrub + addedAt included)
#   ./pipeline.sh build      full site build (prebuild re-hydrates projects+videos from Postgres)
#   ./pipeline.sh all        videos + build
#   ./pipeline.sh ship       all + commit src/data + push to main
#
# Tunables (env vars): VPN_DIR (default ~/vpn-wg), LIMIT (1000), WORKERS (8).
set -uo pipefail
cd "$(dirname "$0")"

YT_PY="youtube/.venv/bin/python"
VPN_DIR="${VPN_DIR:-$HOME/vpn-wg}"
LIMIT="${LIMIT:-1000}"
WORKERS="${WORKERS:-8}"
warnings=()

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
warn() { warnings+=("$*"); echo "WARNING: $*" >&2; }

need_yt_venv() {
  if [ ! -x "$YT_PY" ]; then
    echo "youtube/.venv missing — run: python3 -m venv youtube/.venv && youtube/.venv/bin/pip install -r youtube/requirements.txt" >&2
    exit 1
  fi
}

cmd_status() {
  need_yt_venv
  step "Pipeline status"
  "$YT_PY" - <<'PY'
import json, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(".env")
try:
    import psycopg
    with psycopg.connect(os.environ["DATABASE_URL"]) as c, c.cursor() as cur:
        cur.execute("SELECT COALESCE(transcript_status,'pending') s, COUNT(*) FROM youtube_videos GROUP BY 1 ORDER BY 2 DESC")
        print("transcript queue (DB):")
        for s, n in cur.fetchall():
            print(f"  {s:<12} {n}")
except Exception as e:
    print(f"DB unreachable ({type(e).__name__}) — queue counts unavailable")
def count(p, pat="*.json"):
    p = Path(p)
    return len(list(p.glob(pat))) if p.exists() else 0
rw = 0
vd = Path("src/data/video-descriptions.json")
if vd.exists():
    rw = len(json.loads(vd.read_text()))
print("local coverage:")
print(f"  raw transcripts:      {count('youtube/data/transcripts')}")
print(f"  enriched (published): {count('src/data/transcripts')}")
print(f"  description rewrites: {rw}")
print(f"  video lists:          {count('src/data/videos')} domains")
PY
}

cmd_videos() {
  need_yt_venv

  step "1/4 Transcribe pending videos"
  if ls "$VPN_DIR"/*.conf >/dev/null 2>&1; then
    youtube/transcribe_rotate.sh "$VPN_DIR" 100 1 2
  else
    echo "(no VPN configs in $VPN_DIR — running without rotation)"
    "$YT_PY" youtube/transcribe_youtube.py --limit "$LIMIT" --workers 2
  fi
  code=$?
  if [ "$code" -eq 75 ]; then
    warn "transcription stopped on IP blocks — continuing with what was fetched; re-run later for the rest"
  elif [ "$code" -ne 0 ]; then
    echo "transcription failed with exit $code — aborting" >&2
    exit "$code"
  fi

  step "2/4 Enrich transcripts (chapters, summary, SEO)"
  "$YT_PY" youtube/enrich_transcripts.py --limit "$LIMIT" --workers "$WORKERS" --max-output-tokens 32000 \
    || warn "some enrichments failed — they retry automatically on the next run"

  step "3/4 Rewrite descriptions for non-enriched videos"
  "$YT_PY" youtube/rewrite_descriptions.py --limit "$LIMIT" \
    || warn "some description rewrites failed — they retry automatically on the next run"

  step "4/4 Publish video JSON"
  "$YT_PY" youtube/publish_videos.py || { echo "video publish failed" >&2; exit 1; }
}

cmd_projects() {
  step "Publish project catalogs (scrub + addedAt included)"
  bash scraper/publish.sh || { echo "project publish failed" >&2; exit 1; }
}

cmd_build() {
  step "Site build (prebuild hydrates from Postgres when DATABASE_URL is set)"
  pnpm build || { echo "build failed" >&2; exit 1; }
}

cmd_ship() {
  step "Commit & push data"
  git add src/data
  if git diff --cached --quiet; then
    echo "no data changes to commit"
  else
    git commit -m "Data refresh: projects, videos, transcripts"
  fi
  git push origin main || { echo "push failed — pull/rebase first, then re-run ./pipeline.sh ship" >&2; exit 1; }
}

finish() {
  if [ "${#warnings[@]}" -gt 0 ]; then
    printf '\n\033[1mDone with %d warning(s):\033[0m\n' "${#warnings[@]}"
    printf '  - %s\n' "${warnings[@]}"
  else
    printf '\n\033[1mDone.\033[0m\n'
  fi
}

case "${1:-}" in
  status)   cmd_status ;;
  videos)   cmd_videos; finish ;;
  projects) cmd_projects; finish ;;
  build)    cmd_build; finish ;;
  all)      cmd_videos; cmd_build; finish ;;
  ship)     cmd_videos; cmd_build; cmd_ship; finish ;;
  *)        awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 1 ;;
esac
