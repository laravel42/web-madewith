#!/usr/bin/env python3
"""One-command drivers for the MadeWithWhat data pipeline.

Every underlying step is idempotent (finished work is skipped), so every command
here is safe to re-run and resumes where the last run stopped.

    python workers/pipeline.py status     queue counts (DB) + local coverage
    python workers/pipeline.py projects   crawl GitHub → Postgres → src/data/*.json
    python workers/pipeline.py videos     crawl → transcribe → enrich → rewrite → publish
    python workers/pipeline.py github:discover / github:import   (scheduled GitHub service)
    python workers/pipeline.py blog       generate → prune assets → hydrate → audit
    python workers/pipeline.py build      full site build (prebuild re-hydrates everything)
    python workers/pipeline.py all        videos + build
    python workers/pipeline.py ship       all + commit data/blog/assets + push to main
    python workers/pipeline.py deploy     rsync dist/ to the web server (atomic symlink swap)
    python workers/pipeline.py deploy:s3  upload dist/ to S3 + purge changed URLs from Cloudflare

`blog` is deliberately not part of `all`/`ship`: every other step is bounded by
pending work, whereas each blog run mints BLOG_COUNT brand new articles and
bills an LLM for them. Run it when you want more articles.

workers/posts/output/ is gitignored, so src/content/blog + public/assets are the
only durable copy of generated articles — `ship` commits both.

Tunables (env vars): VPN_DIR (default ~/vpn-wg), LIMIT (1000), WORKERS (8),
BLOG_COUNT (10), BLOG_CONCURRENCY (3), DEPLOY_TARGET (user@host, required for
deploy), DEPLOY_PATH (default /home/ploi/madewithwhat.net; the nginx root must
be $DEPLOY_PATH/current).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKERS_DIR = Path(__file__).resolve().parent
ROOT = WORKERS_DIR.parent
VENV_PYTHON = WORKERS_DIR / ".venv" / "bin" / "python"
SCRAPY = WORKERS_DIR / ".venv" / "bin" / "scrapy"

PROJECTS = WORKERS_DIR / "projects"
VIDEOS = WORKERS_DIR / "videos"
POSTS = WORKERS_DIR / "posts"
GITHUB = WORKERS_DIR / "github"
UTILS = WORKERS_DIR / "utils"

VPN_DIR = Path(os.getenv("VPN_DIR", str(Path.home() / "vpn-wg")))
LIMIT = os.getenv("LIMIT", "1000")
WORKER_COUNT = os.getenv("WORKERS", "8")
BLOG_COUNT = os.getenv("BLOG_COUNT", "10")
BLOG_CONCURRENCY = os.getenv("BLOG_CONCURRENCY", "3")

BLOCK_EXIT = 75  # transcriber's "this IP is flagged" signal
ARTICLES_PER_DATE = 5

_warnings: list[str] = []


def step(message: str) -> None:
    print(f"\n\033[1m== {message} ==\033[0m", flush=True)


def warn(message: str) -> None:
    _warnings.append(message)
    print(f"WARNING: {message}", file=sys.stderr, flush=True)


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def need_venv() -> None:
    if not VENV_PYTHON.exists():
        die(
            "workers/.venv missing — run:\n"
            "  python3 -m venv workers/.venv && "
            "workers/.venv/bin/pip install -r workers/requirements.txt"
        )


def run(args: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> int:
    merged = {**os.environ, **(env or {})}
    return subprocess.run([str(a) for a in args], cwd=str(cwd or ROOT), env=merged).returncode


def py(script: Path, *args: str, cwd: Path | None = None, env: dict[str, str] | None = None) -> int:
    return run([VENV_PYTHON, script, *args], cwd=cwd, env=env)


def node(script: Path, *args: str) -> int:
    return run(["node", str(script), *args])


# --------------------------------------------------------------------------- status


def cmd_status() -> None:
    need_venv()
    step("Pipeline status")
    try:
        from dotenv import load_dotenv

        load_dotenv(ROOT / ".env")
        import psycopg

        with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(transcript_status,'pending') s, COUNT(*) "
                "FROM youtube_videos GROUP BY 1 ORDER BY 2 DESC"
            )
            print("transcript queue (DB):")
            for status, count in cur.fetchall():
                print(f"  {status:<12} {count}")
    except Exception as exc:  # noqa: BLE001 - status must never hard-fail
        print(f"DB unreachable ({type(exc).__name__}) — queue counts unavailable")

    def count(path: Path, pattern: str = "*.json") -> int:
        return len(list(path.glob(pattern))) if path.exists() else 0

    rewrites = 0
    descriptions = ROOT / "src" / "data" / "video-descriptions.json"
    if descriptions.exists():
        rewrites = len(json.loads(descriptions.read_text()))

    blog = ROOT / "src" / "content" / "blog"
    articles = sorted(blog.rglob("*.md")) if blog.exists() else []
    dates = sorted({p.parent.relative_to(blog).as_posix() for p in articles})

    print("local coverage:")
    print(f"  raw transcripts:      {count(VIDEOS / 'data' / 'transcripts')}")
    print(f"  enriched (published): {count(ROOT / 'src' / 'data' / 'transcripts')}")
    print(f"  description rewrites: {rewrites}")
    print(f"  video lists:          {count(ROOT / 'src' / 'data' / 'videos')} domains")
    suffix = f" (through {dates[-1].replace('/', '-')})" if dates else ""
    print(f"  blog articles:        {len(articles)}{suffix}")
    print(f"  staged articles:      {len(list((POSTS / 'output' / 'articles').rglob('*.md')))} (gitignored)")


# --------------------------------------------------------------------------- projects


def cmd_projects_scrape() -> None:
    need_venv()
    step("Crawl GitHub repositories into Postgres")
    if run([SCRAPY, "crawl", "github"], cwd=PROJECTS) != 0:
        die("project crawl failed")


def cmd_projects_publish() -> None:
    need_venv()
    step("Publish project catalogs (Postgres → src/data/*.json)")
    if py(PROJECTS / "publish.py") != 0:
        die("project publish failed")
    # Post-publish guards: evict cross-domain contamination, then preserve or
    # assign per-project addedAt (the feeds sort by it).
    if node(UTILS / "scrub-cross-domain.mjs") != 0:
        warn("cross-domain scrub failed — src/data may contain foreign projects")
    if node(UTILS / "stamp-added-at.mjs") != 0:
        warn("addedAt stamping failed — new projects may sort incorrectly")


def cmd_projects() -> None:
    cmd_projects_scrape()
    cmd_projects_publish()


def cmd_github_discover() -> None:
    need_venv()
    step("GitHub discovery (logs to workers/github/logs/discover.log)")
    if py(GITHUB / "scheduled.py", "discover") != 0:
        warn("discover run failed — see workers/github/logs/discover.log")


def cmd_github_import() -> None:
    need_venv()
    step("Replay published JSON into Postgres, then qualify")
    if py(GITHUB / "scheduled.py", "import") != 0:
        warn("import run failed — see workers/github/logs/import.log")


# --------------------------------------------------------------------------- videos


def cmd_videos_scrape() -> None:
    need_venv()
    step("Discover curated tutorial videos into Postgres")
    if run([SCRAPY, "crawl", "youtube"], cwd=VIDEOS) != 0:
        die("video crawl failed")


def cmd_videos_publish() -> None:
    """Transcribe → enrich → rewrite → publish.

    Transcription is first because everything downstream reads its output, and
    it is the only stage that can be throttled by YouTube; the rest are local
    or LLM calls that retry cleanly on the next run.
    """
    need_venv()

    step("1/4 Transcribe pending videos")
    if list(VPN_DIR.glob("*.conf")):
        code = py(VIDEOS / "transcribe_rotate.py", str(VPN_DIR), "--chunk", "100", "--workers", "2")
    else:
        print(f"(no VPN configs in {VPN_DIR} — running without rotation)")
        code = py(VIDEOS / "transcribe_youtube.py", "--limit", LIMIT, "--workers", "2")
    if code == BLOCK_EXIT:
        warn("transcription stopped on IP blocks — continuing with what was fetched; re-run later for the rest")
    elif code != 0:
        die(f"transcription failed with exit {code} — aborting", code)

    step("2/4 Enrich transcripts (chapters, summary, SEO)")
    if py(VIDEOS / "enrich_transcripts.py", "--limit", LIMIT, "--workers", WORKER_COUNT,
          "--max-output-tokens", "32000") != 0:
        warn("some enrichments failed — they retry automatically on the next run")

    step("3/4 Rewrite descriptions for non-enriched videos")
    if py(VIDEOS / "rewrite_descriptions.py", "--limit", LIMIT) != 0:
        warn("some description rewrites failed — they retry automatically on the next run")

    step("4/4 Publish video JSON")
    if py(VIDEOS / "publish_videos.py") != 0:
        die("video publish failed")


def cmd_videos() -> None:
    cmd_videos_scrape()
    cmd_videos_publish()


# --------------------------------------------------------------------------- blog


def cmd_blog_generate() -> None:
    need_venv()
    step(f"Generate {BLOG_COUNT} editorial articles")
    # --start-date defaults to resuming after the newest published date, so
    # repeat runs extend the archive instead of double-booking dates.
    if py(POSTS / "content_factory.py", "--count", BLOG_COUNT, "--concurrency", BLOG_CONCURRENCY,
          cwd=POSTS, env={"PYTHONUNBUFFERED": "1"}) != 0:
        warn("article batch ended early — re-run blog:generate to top it up")


def cmd_blog_hydrate() -> None:
    need_venv()
    step("1/3 Prune unreferenced article images")
    # Must precede hydrate: hydrate only ever copies, so an orphan that reaches
    # public/assets stays there.
    if py(POSTS / "content_factory.py", "--prune-assets", cwd=POSTS) != 0:
        warn("asset prune failed — orphans may be copied into public/assets")

    step("2/3 Hydrate into src/content/blog + public/assets")
    if node(UTILS / "hydrate-blog.mjs") != 0:
        die("hydrate failed")

    step("3/3 Audit published articles")
    if not blog_audit():
        warn("blog audit reported problems — see above before shipping")


def cmd_blog() -> None:
    cmd_blog_generate()
    cmd_blog_hydrate()


def blog_audit() -> bool:
    """hydrate-blog copies but never deletes, so renaming or removing an article
    strands its old copy in src/content/blog. Nothing else catches that."""
    blog = ROOT / "src" / "content" / "blog"
    articles = sorted(blog.rglob("*.md"))
    if not articles:
        print("  no articles in src/content/blog")
        return True

    def field(text: str, name: str) -> str:
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
            if not (ROOT / "public" / ref.lstrip("/")).exists():
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
    # published too. content_factory --prune-assets only cleans the staging tree.
    assets = ROOT / "public" / "assets"
    if assets.is_dir():
        orphans = [
            p for p in sorted(assets.rglob("*"))
            if p.is_file() and f"/assets/{p.relative_to(assets).as_posix()}" not in referenced
        ]
        if orphans:
            size = sum(p.stat().st_size for p in orphans) / 1_048_576
            notes.append(
                f"{len(orphans)} unreferenced image(s) in public/assets "
                f"({size:.1f} MB) — ship would commit them"
            )

    print(f"  articles: {len(articles)}   unique slugs: {len(slugs)}   unique titles: {len(titles)}")
    for error in errors[:20]:
        print(f"  ERROR: {error}")
    if len(errors) > 20:
        print(f"  ... and {len(errors) - 20} more errors")
    for note in notes[:5]:
        print(f"  note:  {note}")
    if len(notes) > 5:
        print(f"  note:  ... and {len(notes) - 5} more stale filenames")
    return not errors


# --------------------------------------------------------------------------- build / ship / deploy


def cmd_build() -> None:
    step("Site build (prebuild hydrates projects, videos, and blog)")
    if run(["pnpm", "build"]) != 0:
        die("build failed")


def cmd_ship() -> None:
    step("Commit & push data")
    # workers/posts/output/ is gitignored, so src/content/blog and public/assets
    # are the only durable copy of generated articles — commit them or they are
    # lost on the next checkout.
    run(["git", "add", "src/data", "src/content/blog", "public/assets"])
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(ROOT))
    if staged.returncode == 0:
        print("no data changes to commit")
    else:
        run(["git", "commit", "-m", "Data refresh: projects, videos, transcripts, blog"])
    if run(["git", "push", "origin", "main"]) != 0:
        die("push failed — pull/rebase first, then re-run ship")


def cmd_deploy_s3(argv: list[str] | None = None) -> None:
    need_venv()
    step("Upload dist/ to S3 and purge the changed URLs from Cloudflare")
    if py(UTILS / "deploy_s3.py", *(argv or [])) != 0:
        die("S3 deploy failed")


def cmd_deploy() -> None:
    """Push the locally built dist/ to the web server — no server-side build, no
    CI. Atomic: rsync into a timestamped release, then flip the `current`
    symlink nginx serves. Keeps 3 releases."""
    target = os.getenv("DEPLOY_TARGET")
    if not target:
        die("set DEPLOY_TARGET=user@host (e.g. ploi@1.2.3.4)")
    deploy_path = os.getenv("DEPLOY_PATH", "/home/ploi/madewithwhat.net")
    index = ROOT / "dist" / "index.html"
    if not index.exists() or index.stat().st_size == 0:
        die("dist/ missing or empty — run build first")

    pages = len(list((ROOT / "dist").rglob("index.html")))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    step(f"Deploy {pages} pages → {target}:{deploy_path} (release {stamp})")
    if run(["ssh", target, f"mkdir -p '{deploy_path}/releases/{stamp}'"]) != 0:
        die("could not create the remote release directory")
    if run(["rsync", "-a", "--delete", "--info=stats1", f"{ROOT / 'dist'}/",
            f"{target}:{deploy_path}/releases/{stamp}/"]) != 0:
        die("rsync failed")
    flip = (
        f"cd '{deploy_path}' "
        f"&& ln -sfn 'releases/{stamp}' current-next && mv -Tf current-next current "
        f"&& ls -dt releases/*/ | tail -n +4 | xargs -r rm -rf "
        f"&& echo 'live: releases/{stamp}'"
    )
    if run(["ssh", target, flip]) != 0:
        die("symlink flip failed — the release was uploaded but is not live")


# --------------------------------------------------------------------------- dispatch

COMMANDS = {
    "status": cmd_status,
    "projects": cmd_projects,
    "projects:scrape": cmd_projects_scrape,
    "projects:publish": cmd_projects_publish,
    "github:discover": cmd_github_discover,
    "github:import": cmd_github_import,
    "videos": cmd_videos,
    "videos:scrape": cmd_videos_scrape,
    "videos:publish": cmd_videos_publish,
    "blog": cmd_blog,
    "blog:generate": cmd_blog_generate,
    "blog:hydrate": cmd_blog_hydrate,
    "build": cmd_build,
    "deploy": cmd_deploy,
    "deploy:s3": cmd_deploy_s3,
}


def usage() -> int:
    print(__doc__.strip())
    return 1


def finish() -> None:
    if _warnings:
        print(f"\n\033[1mDone with {len(_warnings)} warning(s):\033[0m")
        for message in _warnings:
            print(f"  - {message}")
    else:
        print("\n\033[1mDone.\033[0m")


def main(argv: list[str]) -> int:
    if not argv:
        return usage()
    command = argv[0]
    if command == "all":
        cmd_videos()
        cmd_build()
    elif command == "ship":
        cmd_videos()
        cmd_build()
        cmd_ship()
    elif command in COMMANDS:
        COMMANDS[command]()
    else:
        return usage()
    if command != "status":
        finish()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
