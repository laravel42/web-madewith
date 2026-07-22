#!/usr/bin/env python3
"""Fetch raw YouTube captions into youtube/data/transcripts/<videoId>.json.

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
sys.path.insert(0, str(Path(__file__).resolve().parent))

OUT_DIR = Path(__file__).resolve().parent / "data" / "transcripts"
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


def proxy_config():
    """Optional proxy for youtube-transcript-api, configured from env. YouTube
    IP-blocks datacenter ranges, so bulk runs often need a residential proxy.
    Webshare (WEBSHARE_PROXY_USERNAME/WEBSHARE_PROXY_PASSWORD) is the most
    reliable; a generic proxy (YT_PROXY_HTTP/YT_PROXY_HTTPS, or YT_PROXY_URL for
    both) also works. Returns None when nothing is configured."""
    import os

    user = os.environ.get("WEBSHARE_PROXY_USERNAME")
    password = os.environ.get("WEBSHARE_PROXY_PASSWORD")
    if user and password:
        from youtube_transcript_api.proxies import WebshareProxyConfig
        return WebshareProxyConfig(proxy_username=user, proxy_password=password)
    http = os.environ.get("YT_PROXY_HTTP") or os.environ.get("YT_PROXY_URL")
    https = os.environ.get("YT_PROXY_HTTPS") or os.environ.get("YT_PROXY_URL")
    if http or https:
        from youtube_transcript_api.proxies import GenericProxyConfig
        return GenericProxyConfig(http_url=http, https_url=https)
    return None


def build_api():
    from youtube_transcript_api import YouTubeTranscriptApi
    proxy = proxy_config()
    if proxy:
        print(f"Using proxy: {type(proxy).__name__}")
        return YouTubeTranscriptApi(proxy_config=proxy)
    return YouTubeTranscriptApi()


def fetch_one(api, video_id: str, langs: list[str]) -> dict:
    """Fetch a transcript and normalize to the project's Transcript shape."""
    # Try preferred languages in order
    fetched = None
    last_error: Exception | None = None
    for lang in langs:
        try:
            fetched = api.fetch(video_id, languages=[lang])
            break
        except Exception as e:
            last_error = e
            name = type(e).__name__
            # IP-level failures hit every language identically — don't burn
            # extra requests on a blocked IP just to try en-US/en-GB.
            if any(s in name for s in ("IpBlocked", "RequestBlocked", "PoTokenRequired")) or "blocked" in str(e).lower():
                raise
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
    ap.add_argument("--sleep", type=float, default=0.5, help="Seconds each worker sleeps between requests (default 0.5)")
    ap.add_argument("--workers", type=int, default=1,
                    help="Concurrent fetchers (default 1). Blocks are per-IP and rate-triggered: "
                         "high counts are only sensible behind a rotating proxy; from a single "
                         "IP/VPN location keep this at 1-3.")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    langs = [args.lang]
    for fallback in LANG_PRIORITY:
        if fallback not in langs:
            langs.append(fallback)

    import threading
    from concurrent.futures import ThreadPoolExecutor

    has_proxy = proxy_config() is not None
    workers = max(1, args.workers)
    if workers > 3 and not has_proxy:
        print(f"warning: --workers {workers} from a single IP multiplies the request rate and "
              "gets the IP flagged sooner; 1-3 is recommended without a rotating proxy.\n")

    # requests.Session isn't thread-safe — one API client per worker thread.
    api_local = threading.local()

    def get_api():
        if not hasattr(api_local, "api"):
            api_local.api = build_api()
        return api_local.api

    aborted_blocked = False
    conn = db_connect()
    db_lock = threading.Lock()   # single shared connection; serialize writes
    stop = threading.Event()

    def mark(video_db_id: int, status: str, language: str | None = None, segment_count: int | None = None) -> None:
        with db_lock:
            mark_status(conn, video_db_id, status, language, segment_count)

    def process(v: dict) -> tuple[str, str]:
        """Returns (outcome, line) — outcome in ok|skip|unavailable|blocked|failed|stopped."""
        vid = v["youtube_video_id"]
        if stop.is_set():
            return "stopped", ""
        out_path = out_dir / f"{vid}.json"
        if out_path.exists() and not args.force:
            return "skip", f"{vid:<12}  skip (exists)"
        try:
            tr = fetch_one(get_api(), vid, langs)
            write_transcript(out_dir, vid, tr)
            mark(v["id"], "fetched", tr.get("language"), len(tr["segments"]))
            outcome, line = "ok", f"{vid:<12}  ok   {len(tr['segments']):>4} segments  {v['catalog_slug']:<14} {v['title'][:50]}"
        except Exception as e:
            err_name = type(e).__name__
            err_msg = str(e)[:200]
            # Permanent: video really has no captions
            if any(s in err_name for s in ("TranscriptsDisabled", "NoTranscriptFound", "NotTranslatable",
                                           "VideoUnavailable", "VideoUnplayable", "InvalidVideoId")):
                mark(v["id"], "unavailable")
                outcome, line = "unavailable", f"{vid:<12}  unavailable  {v['catalog_slug']:<14} {v['title'][:50]}"
            # Transient: rate-limited / IP-blocked / network. Leave the video
            # 'pending' so the next run picks it up again.
            elif any(s in err_name for s in ("IpBlocked", "RequestBlocked", "PoTokenRequired", "HTTPError",
                                             "YouTubeRequestFailed", "CookieError", "FailedToCreateConsentCookie",
                                             "ConnectionError", "Timeout")) or "blocked" in err_msg.lower():
                outcome, line = "blocked", f"{vid:<12}  retry  {err_name}  {v['title'][:50]}"
            else:
                mark(v["id"], "failed")
                outcome, line = "failed", f"{vid:<12}  FAIL  {err_name}: {err_msg[:80]}"
        # Polite per-worker spacing to avoid IP bans
        if args.sleep > 0 and not stop.is_set():
            time.sleep(args.sleep)
        return outcome, line

    try:
        videos = get_videos(conn, args.slug, args.limit)
        print(f"Processing {len(videos)} videos (slug={args.slug or '*'}, limit={args.limit}, "
              f"sleep={args.sleep}s, workers={workers})\n")
        fetched = failed = skipped = unavailable = 0
        consecutive_blocks = 0
        # A blocked IP fails every request instantly; grinding through the whole
        # queue just prolongs the flag. Bail early — sooner without a proxy.
        max_consecutive_blocks = 10 if has_proxy else 3
        t0 = time.time()
        done = 0

        def consume(outcome: str, line: str) -> None:
            nonlocal fetched, failed, skipped, unavailable, consecutive_blocks, aborted_blocked, done
            if outcome == "stopped":
                return
            done += 1
            if line:
                print(f"  [{done:>3}/{len(videos)}] {line}")
            if outcome == "ok":
                fetched += 1
            elif outcome == "skip":
                skipped += 1
            elif outcome == "unavailable":
                unavailable += 1
            elif outcome == "failed":
                failed += 1
            if outcome == "blocked":
                failed += 1
                consecutive_blocks += 1
                if consecutive_blocks >= max_consecutive_blocks and not stop.is_set():
                    stop.set()
                    print(f"\nAborting: {consecutive_blocks} consecutive blocked/failed requests — "
                          f"YouTube is blocking this IP{' (even through the proxy)' if has_proxy else ''}.")
                    if not has_proxy:
                        print("Configure a rotating residential proxy in .env and re-run:\n"
                              "  WEBSHARE_PROXY_USERNAME=... WEBSHARE_PROXY_PASSWORD=...   (recommended)\n"
                              "  or YT_PROXY_URL=http://user:pass@host:port")
                    print("Blocked videos were left as 'pending', so a re-run resumes where this stopped.")
                    aborted_blocked = True
            else:
                consecutive_blocks = 0

        if workers == 1:
            # Strictly sequential: the abort check runs before every request.
            for v in videos:
                if stop.is_set():
                    break
                consume(*process(v))
        else:
            # Submit in order; consume in order so 'consecutive blocks' keeps
            # meaning. In-flight tasks when the stop flag trips still finish
            # (a few extra requests), queued ones return 'stopped' instantly.
            with ThreadPoolExecutor(max_workers=min(workers, len(videos) or 1)) as pool:
                for future in [pool.submit(process, v) for v in videos]:
                    consume(*future.result())
        dt = time.time() - t0
        print(f"\nDone in {dt:.1f}s — fetched={fetched} skipped={skipped} unavailable={unavailable} failed={failed}")
    finally:
        conn.close()
    # 75 (EX_TEMPFAIL) tells wrappers (transcribe_rotate.sh) "this IP is
    # burned, rotate and retry" — distinct from success and from real errors.
    return 75 if aborted_blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
