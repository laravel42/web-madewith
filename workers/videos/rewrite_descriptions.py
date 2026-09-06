#!/usr/bin/env python3
"""Rewrite published video descriptions with an LLM — descriptions only.

Enriched videos already get a transcript-derived seoDescription at publish
time; this script covers the rest (or everything with --force): it turns the
raw YouTube description — sponsor plugs, discount codes, link piles, chapter
indexes — into one neutral editorial paragraph describing what the video
teaches, using only the title and original description as input.

Results accumulate in src/data/video-descriptions.json (a videoId → text
map). publish_videos.py prefers: seoDescription (enriched) > this rewrite >
sanitized raw description. Idempotent: already-rewritten videos are skipped
unless --force.

Provider: OpenAI direct via OPENAI_API_KEY by default (gpt-5-mini), OpenRouter
only when no OpenAI key is configured (default model google/gemini-2.5-flash —
short rewrites don't need a frontier model). Override with DESC_MODEL or
--model; pass --base-url explicitly for any other OpenAI-compatible server
(a bare OPENAI_BASE_URL env var is intentionally ignored so a stray shell
export can't silently redirect an "OpenAI direct" run elsewhere).

Usage:
    rewrite_descriptions.py                  # rewrite all non-enriched videos
    rewrite_descriptions.py --slug laravel   # one catalog slug only
    rewrite_descriptions.py --force          # redo existing rewrites too
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
# override=True: this project's .env is the source of truth for LLM
# credentials/endpoint — an already-exported shell OPENAI_API_KEY/
# OPENAI_BASE_URL (e.g. left over from routing some other tool through
# OpenRouter) must not silently win over it.
load_dotenv(ROOT / ".env", override=True)

TRANSCRIPTS_DIR = ROOT / "src" / "data" / "transcripts"
OUT_PATH = ROOT / "src" / "data" / "video-descriptions.json"
DESC_MAX = 280
_URL = re.compile(r"https?://\S+|www\.\S+")

PROMPT = """Rewrite this YouTube video description as one neutral, editorial paragraph
of at most 280 characters describing what the video teaches or covers.

Rules:
- factual and specific; mention the core technologies and topics
- no marketing language, sponsor mentions, or calls to action
- no links, no emojis, no hashtags, no "in this video"
- plain text only, no quotes around the output

Technology context: {tech}
Video title: {title}
Original description:
{description}"""


def load_videos(slug: str | None) -> list[dict]:
    import psycopg
    from psycopg.rows import dict_row

    sql = """SELECT youtube_video_id, catalog_slug, title, description
             FROM youtube_videos
             WHERE COALESCE(description, '') <> ''
               AND (%s::text IS NULL OR catalog_slug = %s)
             ORDER BY quality_score DESC NULLS LAST, view_count DESC"""
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, (slug, slug))
            return cur.fetchall()


def is_enriched(video_id: str) -> bool:
    path = TRANSCRIPTS_DIR / f"{video_id}.json"
    if not path.exists():
        return False
    try:
        return len(str(json.loads(path.read_text()).get("seoDescription") or "").strip()) >= 40
    except (OSError, json.JSONDecodeError):
        return False


def clean_reply(text: str) -> str | None:
    """Validate/normalize a model reply; None means keep the fallback path."""
    text = re.sub(r"\s+", " ", str(text or "")).strip().strip('"“”')
    if len(text) < 40 or _URL.search(text):
        return None
    if len(text) > DESC_MAX:
        cut = text[:DESC_MAX].rsplit(" ", 1)[0].rstrip(",;:.")
        text = cut + "…"
    return text


def rewrite_one(client, model: str, video: dict, log) -> str | None:
    import openai

    fatal = (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError, openai.BadRequestError)
    prompt = PROMPT.format(tech=video.get("catalog_slug") or "software development",
                           title=video["title"],
                           description=(video.get("description") or "")[:4000])
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=model, messages=[{"role": "user", "content": prompt}])
            return clean_reply(response.choices[0].message.content)
        except fatal:
            raise
        except Exception as exc:
            if attempt == 2:
                log(f"    giving up: {type(exc).__name__}: {str(exc)[:120]}")
                return None
            wait = min(15, 2 ** attempt)
            log(f"    attempt {attempt + 1}/3 {type(exc).__name__}: {str(exc)[:120]} — retrying in {wait}s")
            time.sleep(wait)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", help="Limit to one catalog slug")
    parser.add_argument("--limit", type=int, default=2000, help="Max videos to rewrite this run")
    parser.add_argument("--model", help="Model id; defaults to DESC_MODEL, else per-backend default")
    parser.add_argument("--base-url",
                        help="OpenAI-compatible endpoint override (default: OpenAI direct, "
                             "or OpenRouter when no OPENAI_API_KEY is set). Ignores the "
                             "ambient OPENAI_BASE_URL env var — pass this flag explicitly.")
    parser.add_argument("--workers", type=int, default=8,
                        help="Concurrent rewrites (default 8 — the calls are small)")
    parser.add_argument("--force", action="store_true",
                        help="Rewrite even videos already in the map or enriched")
    parser.add_argument("--dry-run", action="store_true", help="List candidates without calling the LLM")
    args = parser.parse_args()

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    if not args.base_url:
        # OpenAI direct is the default whenever a key is configured; OpenRouter
        # only kicks in as a fallback, and only via this explicit key check —
        # never via an ambient OPENAI_BASE_URL env var.
        args.base_url = "https://api.openai.com/v1" if openai_key else (
            "https://openrouter.ai/api/v1" if openrouter_key else "https://api.openai.com/v1")
    on_openrouter = "openrouter" in args.base_url
    if on_openrouter:
        api_key = openrouter_key or openai_key
    else:
        api_key = openai_key or openrouter_key
    is_local = bool(args.base_url) and ("localhost" in args.base_url or "127.0.0.1" in args.base_url)
    if not api_key and not is_local:
        raise SystemExit("An API key is required: OPENAI_API_KEY or OPENROUTER_API_KEY")
    if args.model:
        model = args.model
    elif os.getenv("DESC_MODEL"):
        model = os.environ["DESC_MODEL"]
    elif on_openrouter:
        model = "google/gemini-2.5-flash"
    elif is_local:
        raise SystemExit("--model (or DESC_MODEL) is required for a local server")
    else:
        model = "gpt-5-mini"

    existing: dict[str, str] = {}
    if OUT_PATH.exists():
        try:
            existing = {k: str(v) for k, v in json.loads(OUT_PATH.read_text()).items()}
        except (OSError, json.JSONDecodeError):
            print(f"warning: {OUT_PATH.name} unreadable, starting fresh")

    videos = load_videos(args.slug)
    queue = [
        v for v in videos
        if args.force or (v["youtube_video_id"] not in existing and not is_enriched(v["youtube_video_id"]))
    ][: args.limit]
    skipped = len(videos) - len(queue)
    print(f"model={model}" + (f"  base_url={args.base_url}" if args.base_url else "  (OpenAI direct)")
          + f"  workers={args.workers}")
    print(f"{len(videos)} videos with a description: {skipped} already covered "
          f"(enriched/rewritten), {len(queue)} to rewrite\n")
    if args.dry_run:
        for v in queue:
            print(f"{v['youtube_video_id']}  {v['catalog_slug']:<14} {v['title'][:70]}")
        return 0
    if not queue:
        print("Nothing to do.")
        return 0

    from openai import OpenAI
    import openai
    client = OpenAI(api_key=api_key or "ollama", base_url=args.base_url)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    written = failed = 0
    t0 = time.time()

    def run(video: dict) -> tuple[dict, str | None, list[str], Exception | None]:
        lines: list[str] = []
        try:
            return video, rewrite_one(client, model, video, lines.append), lines, None
        except Exception as exc:
            return video, None, lines, exc

    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, len(queue)))) as pool:
        futures = [pool.submit(run, v) for v in queue]
        for done, future in enumerate(as_completed(futures), 1):
            video, text, lines, exc = future.result()
            vid = video["youtube_video_id"]
            for line in lines:
                print(line)
            if text:
                existing[vid] = text
                written += 1
                print(f"[{done:>3}/{len(queue)}] {vid}  {video['catalog_slug']:<14} ok  {text[:70]}")
            else:
                failed += 1
                print(f"[{done:>3}/{len(queue)}] {vid}  {video['catalog_slug']:<14} FAIL"
                      + (f"  {type(exc).__name__}: {exc}" if exc else "  (invalid reply)"))
            if done % 25 == 0 or done == len(queue):
                OUT_PATH.write_text(json.dumps(dict(sorted(existing.items())),
                                               indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError)):
                pool.shutdown(wait=False, cancel_futures=True)
                raise SystemExit(f"Aborting: {type(exc).__name__} — check the API key and model "
                                 f"(model={model}).")

    print(f"\nDone in {time.time() - t0:.0f}s — rewritten={written} failed={failed} "
          f"map={len(existing)} entries → {OUT_PATH.relative_to(ROOT)}")
    print("Re-run publish to apply: pnpm youtube:publish")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
