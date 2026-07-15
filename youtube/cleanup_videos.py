#!/usr/bin/env python3
"""Remove youtube_videos rows that no longer pass the relevance gate.

Re-applies `madewith_youtube.youtube_relevance.passes_relevance_gate` to every
stored video and reports (or, with --apply, deletes) the ones that fail. Use it
after tightening `src/config/video-relevance.json` to purge videos that slipped
in under looser rules — e.g. gaming/anime clips wrongly filed under an ambiguous
technology slug like `phoenix`, `gin`, or `ghost`.

    python youtube/cleanup_videos.py                 # dry run — report only
    python youtube/cleanup_videos.py --slug phoenix  # scope to one slug
    python youtube/cleanup_videos.py --apply         # actually delete
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from madewith_youtube.domains import load_domains  # noqa: E402
from madewith_youtube.youtube_relevance import passes_relevance_gate  # noqa: E402

# High-confidence removals: the video matched an explicit reject pattern (global
# or per-slug), or its slug is gone from the catalog. These are safe to delete.
# The "missing_*" reasons (no positive tech/programming signal) are lower
# confidence and can be false positives, so they need --aggressive.
HIGH_CONFIDENCE = {"off_topic_global", "off_topic_slug", "unknown_slug"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete non-relevant YouTube videos from PostgreSQL.")
    ap.add_argument("--slug", help="Limit to one catalog slug")
    ap.add_argument("--limit", type=int, help="Only scan the first N videos")
    ap.add_argument("--apply", action="store_true", help="Delete targeted rows (default: dry run / report only)")
    ap.add_argument("--aggressive", action="store_true",
                    help="Also target low-confidence 'missing_*' failures (no positive signal), not just explicit rejects")
    ap.add_argument("--show", type=int, default=20, help="How many sample failures to print (default 20)")
    ap.add_argument("--links", action="store_true", help="Print the full YouTube URL of every targeted video")
    args = ap.parse_args()

    tech_by_slug = {d["slug"]: d.get("techName", d["slug"]) for d in load_domains()}

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required")

    conn = psycopg.connect(url, row_factory=dict_row)
    sql = "SELECT id, youtube_video_id, catalog_slug, title, description, channel_title, video_url FROM youtube_videos"
    params: list = []
    if args.slug:
        sql += " WHERE catalog_slug = %s"
        params.append(args.slug)
    sql += " ORDER BY catalog_slug, id"
    if args.limit:
        sql += f" LIMIT {int(args.limit)}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    failing: list[tuple[dict, str]] = []
    reasons: Counter[str] = Counter()
    by_slug: Counter[str] = Counter()
    for row in rows:
        slug = row["catalog_slug"]
        if slug not in tech_by_slug:
            # Slug no longer in the catalog — orphaned, treat as non-relevant.
            ok, reason = False, "unknown_slug"
        else:
            ok, reason = passes_relevance_gate(slug, tech_by_slug[slug], row)
        if not ok:
            failing.append((row, reason))
            reasons[reason] += 1
            by_slug[slug] += 1

    targets = [(row, reason) for row, reason in failing if args.aggressive or reason in HIGH_CONFIDENCE]

    print(f"Scanned {len(rows)} video(s) — {len(failing)} fail the relevance gate")
    if failing:
        print("\nBy reason (● = targeted for removal):")
        for reason, n in reasons.most_common():
            mark = "●" if args.aggressive or reason in HIGH_CONFIDENCE else "○"
            print(f"  {mark} {n:>4}  {reason}")
        print("\nBy slug:")
        for slug, n in by_slug.most_common():
            print(f"  {n:>4}  {slug}")
        shown = targets if args.links else targets[: args.show]
        if shown:
            print(f"\n{'All' if args.links else f'Sample (up to {args.show})'} targeted for removal:")
            for row, reason in shown:
                link = row.get("video_url") or f"https://www.youtube.com/watch?v={row['youtube_video_id']}"
                print(f"  {link}  [{row['catalog_slug']}]  {(row['title'] or '')[:52]}  ({reason})")

    mode = "all failures (aggressive)" if args.aggressive else "explicit off-topic rejects only"
    print(f"\nTargeting {len(targets)}/{len(failing)} for removal — {mode}.")
    if not args.aggressive and len(failing) > len(targets):
        print(f"  ({len(failing) - len(targets)} low-confidence 'missing_*' failures kept; use --aggressive to include them.)")

    if not targets:
        conn.close()
        return 0

    if not args.apply:
        print(f"\nDry run — re-run with --apply to delete these {len(targets)} row(s).")
        conn.close()
        return 0

    ids = [row["id"] for row, _ in targets]
    with conn.cursor() as cur:
        cur.execute("DELETE FROM youtube_videos WHERE id = ANY(%s)", (ids,))
        deleted = cur.rowcount
    conn.commit()
    conn.close()
    print(f"\nDeleted {deleted} non-relevant video(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
