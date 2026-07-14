#!/usr/bin/env python3
"""Fetch raw YouTube captions into scraper/data/transcripts/<videoId>.json.

Idempotent: skips videos that already have a transcript file on disk.
Tracks status in youtube_videos.transcript_status (pending → fetched | failed | unavailable).

Usage:
    transcribe_youtube.py [--slug SLUG] [--limit N] [--lang en] [--force]

Examples:
    transcribe_youtube.py --slug laravel           # 18 Laravel videos
    transcribe_youtube.py --slug laravel --limit 3 # first 3 only
    transcribe_youtube.py --limit 50              # 50 from any slug
    transcribe_youtube.py --force                 # re-fetch even if file exists
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # /Users/secret/Code/web-madewith
sys.path.insert(0, str(ROOT / "scraper"))

OUT_DIR = ROOT / "scraper" / "data" / "transcripts"
LANG_PRIORITY = ["en", "en-US", "en-GB"]
USER_AGENT = "Mozilla/5.0 (compatible; madewithwhat-transcribe/1.0)"


def db_connect():
    import os
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    import psycopg
    return psycopg.connect(os.environ["DATABASE_URL"])  # type: ignore[arg-type]


def _dict_cursor(conn):
    from psycopg.rows import dict_row
    return conn.cursor(row_factory=dict_row)


def get_videos(conn, slug: str | None, limit: int) -> list[dict]:
    sql = """SELECT id, youtube_video_id, catalog_slug, title, default_language, duration_seconds
             FROM youtube_videos
             WHERE (%s::text IS NULL OR catalog_slug = %s)
               AND (transcript_status = 'pending' OR transcript_status IS NULL)
             ORDER BY quality_score DESC NULLS LAST, view_count DESC
             LIMIT %s"""
    with _dict_cursor(conn) as cur:
        cur.execute(sql, (slug, slug, limit))
        return cur.fetchall()


def mark_status(conn, video_db_id: int, status: str, language: str | None = None, segment_count: int | None = None) -> None:
    with conn.cursor() as cur:
        if status == "fetched":
            cur.execute(
                """UPDATE youtube_videos
                   SET transcript_status = 'fetched',
                       transcript_fetched_at = NOW(),
                       transcript_language = %s,
                       transcript_segment_count = %s
                   WHERE id = %s""",
                (language, segment_count, video_db_id),
            )
        else:
            cur.execute(
                """UPDATE youtube_videos
                   SET transcript_status = %s,
                       transcript_fetched_at = NOW()
                   WHERE id = %s""",
                (status, video_db_id),
            )
    conn.commit()


def fetch_one(video_id: str, langs: list[str]) -> dict:
    """Fetch a transcript and normalize to the project's Transcript shape."""
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    # Try preferred languages in order
    fetched = None
    last_error: Exception | None = None
    for lang in langs:
        try:
            fetched = api.fetch(video_id, languages=[lang])
            break
        except Exception as e:
            last_error = e
            continue
    if fetched is None:
        raise last_error or RuntimeError("transcript fetch returned no data")

    snippets = list(fetched)
    segments = [{"start": float(s.start), "text": s.text} for s in snippets]
    text = " ".join(s.text.strip() for s in snippets if s.text.strip())
    # Source: 'manual' if it was a human-written transcript, else 'auto'
    source = "manual" if any(getattr(s, "source", None) == "manual" for s in snippets) else "auto"
    language = langs[0] if fetched is not None else None
    return {
        "videoId": video_id,
        "language": language,
        "source": source,
        "segments": segments,
        "text": text,
    }


def write_transcript(out_dir: Path, video_id: str, transcript: dict) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{video_id}.json"
    path.write_text(json.dumps(transcript, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", help="Limit to one catalog slug (e.g. laravel)")
    ap.add_argument("--limit", type=int, default=100, help="Max videos to process (default 100)")
    ap.add_argument("--lang", default="en", help="Preferred language code (default en)")
    ap.add_argument("--force", action="store_true", help="Re-fetch even if file exists")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--sleep", type=float, default=0.5, help="Seconds to sleep between requests (default 0.5)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    langs = [args.lang]
    for fallback in LANG_PRIORITY:
        if fallback not in langs:
            langs.append(fallback)

    conn = db_connect()
    try:
        videos = get_videos(conn, args.slug, args.limit)
        print(f"Processing {len(videos)} videos (slug={args.slug or '*'}, limit={args.limit}, sleep={args.sleep}s)\n")
        fetched = failed = skipped = unavailable = 0
        t0 = time.time()
        for i, v in enumerate(videos, 1):
            vid = v["youtube_video_id"]
            out_path = out_dir / f"{vid}.json"
            if out_path.exists() and not args.force:
                print(f"  [{i:>3}/{len(videos)}] {vid:<12}  skip (exists)")
                skipped += 1
                continue
            try:
                tr = fetch_one(vid, langs)
                write_transcript(out_dir, vid, tr)
                mark_status(conn, v["id"], "fetched", tr.get("language"), len(tr["segments"]))
                print(f"  [{i:>3}/{len(videos)}] {vid:<12}  ok   {len(tr['segments']):>4} segments  {v['catalog_slug']:<14} {v['title'][:50]}")
                fetched += 1
            except Exception as e:
                err_name = type(e).__name__
                err_msg = str(e)[:200]
                # Permanent: video really has no captions
                if "TranscriptsDisabled" in err_name or "NoTranscriptFound" in err_name or "NotTranslatable" in err_name or "VideoUnavailable" in err_name or "VideoUnplayable" in err_name or "InvalidVideoId" in err_name:
                    mark_status(conn, v["id"], "unavailable")
                    unavailable += 1
                    print(f"  [{i:>3}/{len(videos)}] {vid:<12}  unavailable  {v['catalog_slug']:<14} {v['title'][:50]}")
                # Transient: rate-limited / IP-blocked / network — retry later
                elif any(s in err_name for s in ("IpBlocked", "RequestBlocked", "PoTokenRequired", "HTTPError", "YouTubeRequestFailed", "CookieError", "FailedToCreateConsentCookie", "ConnectionError", "Timeout")) or "blocked" in err_msg.lower():
                    mark_status(conn, v["id"], "failed")
                    failed += 1
                    print(f"  [{i:>3}/{len(videos)}] {vid:<12}  retry  {err_name}  {v['title'][:50]}")
                else:
                    mark_status(conn, v["id"], "failed")
                    failed += 1
                    print(f"  [{i:>3}/{len(videos)}] {vid:<12}  FAIL  {err_name}: {err_msg[:80]}")
            # Polite spacing to avoid IP bans
            if args.sleep > 0 and i < len(videos):
                time.sleep(args.sleep)
        dt = time.time() - t0
        print(f"\nDone in {dt:.1f}s — fetched={fetched} skipped={skipped} unavailable={unavailable} failed={failed}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
