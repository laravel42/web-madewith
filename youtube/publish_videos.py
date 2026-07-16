#!/usr/bin/env python3
"""Write src/data/videos/<slug>.json from Postgres."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from madewith_youtube import youtube_db  # noqa: E402
from madewith_youtube.domains import load_domains  # noqa: E402
from madewith_youtube.youtube_quality import format_duration  # noqa: E402
from madewith_youtube.youtube_relevance import passes_relevance_gate  # noqa: E402

OUT_DIR = ROOT / "src" / "data" / "videos"
KEEP = int(__import__("os").environ.get("YOUTUBE_PUBLISH_KEEP", "24"))


def serialize(row: dict) -> dict:
    seconds = row.get("duration_seconds") or 0
    channel_id = row.get("channel_id") or ""
    return {
        "id": row["youtube_video_id"],
        "title": row["title"],
        # Full YouTube description (API max ~5000). Card excerpts truncate later
        # in the frontend; don't cut mid-word here for the detail Overview tab.
        "description": row.get("description") or "",
        "channel": row.get("channel_title"),
        "channelUrl": f"https://www.youtube.com/channel/{channel_id}" if channel_id else None,
        "url": row.get("video_url"),
        "thumbnail": row.get("thumbnail_url"),
        "publishedAt": row["published_at"].isoformat() if row.get("published_at") else None,
        "duration": format_duration(seconds),
        "durationSeconds": seconds,
        "views": row.get("view_count") or 0,
        "likes": row.get("like_count") or 0,
        "qualityScore": float(row.get("quality_score") or 0),
        "definition": row.get("definition"),
    }


def main() -> None:
    filter_slugs = None
    args = [a for a in sys.argv[1:] if a != "--"]
    if args:
        filter_slugs = {s.strip() for s in ",".join(args).split(",") if s.strip()}

    domains = load_domains()
    if filter_slugs:
        domains = [d for d in domains if d["slug"] in filter_slugs]

    conn = youtube_db.connect()
    published = 0
    try:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for domain in domains:
            slug = domain["slug"]
            rows = youtube_db.load_videos_for_slug(conn, slug, KEEP)
            serialized = [serialize(r) for r in rows]
            relevant = [
                video
                for video in serialized
                if passes_relevance_gate(slug, domain["techName"], {
                    "title": video["title"],
                    "description": video.get("description") or "",
                    "channel_title": video.get("channel") or "",
                })[0]
            ]
            if not relevant:
                print(f"• {slug:<14} no relevant videos")
                continue
            payload = {
                "slug": slug,
                "techName": domain["techName"],
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
                "source": "youtube-api",
                "videoCount": len(relevant),
                "videos": relevant,
            }
            out = OUT_DIR / f"{slug}.json"
            out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            published += 1
            print(f"✓ {slug:<14} {len(relevant)} videos")
    finally:
        conn.close()

    print(f"\nPublished {published}/{len(domains)} domains → {OUT_DIR}")


if __name__ == "__main__":
    main()
