#!/usr/bin/env bash
# One-command drivers for the MadeWithWhat data pipeline.
#
# Every underlying step is idempotent (finished work is skipped), so every
# command here is safe to re-run and resumes where the last run stopped.
#
#   ./pipeline.sh status     queue counts (DB) + local coverage
#   ./pipeline.sh videos     transcribe → enrich → rewrite descriptions → publish video JSON
#   ./pipeline.sh projects   publish project catalogs from Postgres (scrub + addedAt included)
#   ./pipeline.sh blog       generate editorial articles → prune assets → hydrate → audit
#   ./pipeline.sh build      full site build (prebuild re-hydrates projects+videos+blog)
#   ./pipeline.sh all        videos + build
#   ./pipeline.sh ship       all + commit src/data, src/content/blog, public/assets + push
#   ./pipeline.sh deploy     rsync dist/ to the web server (atomic symlink swap)
#
# `blog` is deliberately NOT part of `all`/`ship`: every other step is bounded
# by pending work and idempotent, whereas each blog run mints BLOG_COUNT brand
# new articles and bills an LLM for them. Run it when you want more articles.
#
# factory/output/ is gitignored, so src/content/blog + public/assets are the
# only durable copy of generated articles — `ship` commits both.
#
# Tunables (env vars): VPN_DIR (default ~/vpn-wg), LIMIT (1000), WORKERS (8),
# BLOG_COUNT (10), BLOG_CONCURRENCY (3), DEPLOY_TARGET (user@host, required for
# deploy), DEPLOY_PATH (default /home/ploi/madewithwhat.net; nginx root must be
# $DEPLOY_PATH/current).
set -uo pipefail
cd "$(dirname "$0")"

YT_PY="youtube/.venv/bin/python"
FACTORY_PY="factory/.venv/bin/python"
VPN_DIR="${VPN_DIR:-$HOME/vpn-wg}"
LIMIT="${LIMIT:-1000}"
WORKERS="${WORKERS:-8}"
BLOG_COUNT="${BLOG_COUNT:-10}"
BLOG_CONCURRENCY="${BLOG_CONCURRENCY:-3}"
warnings=()

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
warn() { warnings+=("$*"); echo "WARNING: $*" >&2; }

need_yt_venv() {
  if [ ! -x "$YT_PY" ]; then
    echo "youtube/.venv missing — run: python3 -m venv youtube/.venv && youtube/.venv/bin/pip install -r youtube/requirements.txt" >&2
    exit 1
  fi
}

need_factory_venv() {
  if [ ! -x "$FACTORY_PY" ]; then
    echo "factory/.venv missing — run: python3 -m venv factory/.venv && factory/.venv/bin/pip install -r factory/requirements.txt" >&2
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
blog = Path("src/content/blog")
articles = sorted(blog.rglob("*.md")) if blog.exists() else []
dates = sorted({str(p.parent).split("blog/")[-1] for p in articles})
print("local coverage:")
print(f"  raw transcripts:      {count('youtube/data/transcripts')}")
print(f"  enriched (published): {count('src/data/transcripts')}")
print(f"  description rewrites: {rw}")
print(f"  video lists:          {count('src/data/videos')} domains")
print(f"  blog articles:        {len(articles)}" + (f" (through {dates[-1].replace('/', '-')})" if dates else ""))
print(f"  factory output:       {count('factory/output/articles', '**/*.md')} staged (gitignored)")
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

cmd_blog() {
  need_factory_venv

  step "1/4 Generate $BLOG_COUNT editorial articles"
  # --start-date defaults to resuming after the newest published date, so
  # repeat runs extend the archive instead of double-booking dates.
  ( cd factory && PYTHONUNBUFFERED=1 .venv/bin/python content_factory.py \
      --count "$BLOG_COUNT" --concurrency "$BLOG_CONCURRENCY" ) \
    || warn "article batch ended early — re-run ./pipeline.sh blog to top it up"

  step "2/4 Prune unreferenced article images"
  # Must precede hydrate: hydrate only ever copies, so an orphan that reaches
  # public/assets stays there.
  ( cd factory && .venv/bin/python content_factory.py --prune-assets ) \
    || warn "asset prune failed — orphans may be copied into public/assets"

  step "3/4 Hydrate into src/content/blog + public/assets"
  node scripts/hydrate-blog.mjs || { echo "hydrate failed" >&2; exit 1; }

  step "4/4 Audit published articles"
  cmd_blog_audit || warn "blog audit reported problems — see above before shipping"
}

cmd_blog_audit() {
  # hydrate-blog copies but never deletes, so renaming or removing a factory
  # article strands its old copy in src/content/blog. Nothing else catches that.
  "${FACTORY_PY}" - <<'PY'
import re, sys
from pathlib import Path

blog = Path("src/content/blog")
articles = sorted(blog.rglob("*.md"))
if not articles:
    print("  no articles in src/content/blog")
    sys.exit(0)


def field(text, name):
    match = re.search(rf'^{name}: "(.*)"$', text, re.M)
    return match.group(1) if match else ""


slugs: dict[str, list[Path]] = {}
titles: dict[str, list[Path]] = {}
errors: list[str] = []
notes: list[str] = []
referenced: set[str] = set()

for path in articles:
    text = path.read_text(encoding="utf-8")
    slug = field(text, "slug") or path.stem
    slugs.setdefault(slug, []).append(path)
    title = field(text, "title")
    if title:
        titles.setdefault(title, []).append(path)

    canonical = field(text, "canonical").rsplit("/", 1)[-1]
    if canonical and canonical != slug:
        errors.append(f"canonical {canonical!r} != slug {slug!r} in {path}")
    for ref in sorted(set(re.findall(r"/assets/[^\s)\"'\\]+", text))):
        referenced.add(ref)
        if not Path("public" + ref).exists():
            errors.append(f"missing image {ref} referenced by {path.name}")
    # Routing uses the front-matter slug (src/pages/blog/[slug].astro), so a
    # stale filename publishes fine — it just makes the tree confusing.
    if slug != path.stem:
        notes.append(f"filename {path.name} does not match slug {slug!r}")

errors += [
    f"duplicate slug {slug!r}: {', '.join(str(p) for p in paths)}"
    for slug, paths in slugs.items() if len(paths) > 1
]
errors += [
    f"duplicate title {title!r}: {', '.join(str(p) for p in paths)}"
    for title, paths in titles.items() if len(paths) > 1
]

# `ship` commits public/assets wholesale, so unreferenced images there get
# published too. factory --prune-assets only cleans the staging tree.
public_assets = Path("public/assets")
orphans = [
    path for path in sorted(public_assets.rglob("*"))
    if path.is_file() and f"/assets/{path.relative_to(public_assets).as_posix()}" not in referenced
]
if orphans:
    size = sum(path.stat().st_size for path in orphans) / 1_048_576
    notes.append(f"{len(orphans)} unreferenced image(s) in public/assets ({size:.1f} MB) — ship would commit them")

print(f"  articles: {len(articles)}   unique slugs: {len(slugs)}   unique titles: {len(titles)}")
for error in errors[:20]:
    print(f"  ERROR: {error}")
if len(errors) > 20:
    print(f"  ... and {len(errors) - 20} more errors")
for note in notes[:5]:
    print(f"  note:  {note}")
if len(notes) > 5:
    print(f"  note:  ... and {len(notes) - 5} more stale filenames")
sys.exit(1 if errors else 0)
PY
}

cmd_build() {
  step "Site build (prebuild hydrates from Postgres when DATABASE_URL is set)"
  pnpm build || { echo "build failed" >&2; exit 1; }
}

cmd_deploy() {
  # Push the locally built dist/ to the web server — no server-side build, no
  # CI. Atomic: rsync into a timestamped release, then flip the `current`
  # symlink nginx serves (root /home/ploi/<site>/current). Keeps 3 releases.
  : "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host (e.g. ploi@1.2.3.4)}"
  DEPLOY_PATH="${DEPLOY_PATH:-/home/ploi/madewithwhat.net}"
  [ -s dist/index.html ] || { echo "dist/ missing or empty — run ./pipeline.sh build first" >&2; exit 1; }
  pages=$(find dist -name index.html | wc -l | tr -d ' ')
  stamp=$(date +%Y%m%d-%H%M%S)
  step "Deploy $pages pages → $DEPLOY_TARGET:$DEPLOY_PATH (release $stamp)"
  ssh "$DEPLOY_TARGET" "mkdir -p '$DEPLOY_PATH/releases/$stamp'"
  rsync -a --delete --info=stats1 dist/ "$DEPLOY_TARGET:$DEPLOY_PATH/releases/$stamp/"
  ssh "$DEPLOY_TARGET" "cd '$DEPLOY_PATH' \
    && ln -sfn 'releases/$stamp' current-next && mv -Tf current-next current \
    && ls -dt releases/*/ | tail -n +4 | xargs -r rm -rf \
    && echo 'live: releases/$stamp'"
}

cmd_ship() {
  step "Commit & push data"
  # factory/output/ is gitignored, so src/content/blog and public/assets are
  # the only durable copy of generated articles — commit them or they are lost
  # on the next checkout.
  git add src/data src/content/blog public/assets
  if git diff --cached --quiet; then
    echo "no data changes to commit"
  else
    git commit -m "Data refresh: projects, videos, transcripts, blog"
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
  blog)     cmd_blog; finish ;;
  build)    cmd_build; finish ;;
  all)      cmd_videos; cmd_build; finish ;;
  ship)     cmd_videos; cmd_build; cmd_ship; finish ;;
  deploy)   cmd_deploy; finish ;;
  *)        awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 1 ;;
esac
