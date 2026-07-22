#!/usr/bin/env python3
"""Write src/data/videos/<slug>.json from Postgres."""
from __future__ import annotations

import json
import re
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
TRANSCRIPTS_DIR = ROOT / "src" / "data" / "transcripts"
KEEP = int(__import__("os").environ.get("YOUTUBE_PUBLISH_KEEP", "24"))
DESC_MAX = 280

# Lines dropped by the raw-description sanitizer: links, contact/promo blocks,
# chapter timestamps, hashtag piles — the parts of YouTube descriptions that
# are ads rather than information.
_URL = re.compile(r"https?://\S+|www\.\S+|\S+@\S+\.\S+")
_TIMESTAMP_LINE = re.compile(r"^\s*[\(\[]?\d{1,2}:\d{2}")
_HASHTAG_LINE = re.compile(r"^\s*(#\S+\s*)+$")
# Orphaned section headers ("Timestamps:", "Links:") whose bodies get stripped.
_HEADER_LINE = re.compile(r"^\s*[\w &/]{1,30}:\s*$")
_PROMO = re.compile(
    r"sponsor|coupon|discount|promo\s*code|use\s+code|%\s*off|free\s+trial|"
    r"patreon|instagram|twitter|tiktok|discord|telegram|facebook|linkedin|"
    r"subscribe|follow\s+(me|us)|newsletter|affiliate|referral|merch|"
    r"donate|buy\s+me\s+a\s+coffee|my\s+courses?\b|link\s+in\s+(bio|description)",
    re.IGNORECASE,
)


def _shorten(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= DESC_MAX:
        return text
    cut = text[:DESC_MAX].rsplit(" ", 1)[0].rstrip(",;:.")
    return cut + "…"


def sanitize_description(raw: str) -> str:
    kept = [
        line.strip(" \t-•·|#>")
        for line in (raw or "").splitlines()
        if line.strip()
        and not _URL.search(line)
        and not _TIMESTAMP_LINE.match(line)
        and not _HASHTAG_LINE.match(line)
        and not _HEADER_LINE.match(line)
        and not _PROMO.search(line)
    ]
    return _shorten(" ".join(kept))


def display_description(row: dict) -> str:
    """Editorial description for the overview card: the transcript-derived
    seoDescription when the video is enriched (clean, written from what the
    video actually teaches), otherwise the sanitized YouTube description."""
    enriched = TRANSCRIPTS_DIR / f"{row['youtube_video_id']}.json"
    if enriched.exists():
        try:
            seo = str(json.loads(enriched.read_text(encoding="utf-8")).get("seoDescription") or "")
            if len(seo.strip()) >= 40:
                return _shorten(seo)
        except (OSError, json.JSONDecodeError):
            pass
    return sanitize_description(row.get("description") or "")


def serialize(row: dict) -> dict:
    seconds = row.get("duration_seconds") or 0
    channel_id = row.get("channel_id") or ""
    return {
        "id": row["youtube_video_id"],
        "title": row["title"],
        "description": display_description(row),
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
            # Gate on the RAW description (tech mentions often live in the link
            # lines the display sanitizer strips), then serialize survivors
            # with the cleaned editorial description.
            relevant = [
                serialize(r)
                for r in rows
                if passes_relevance_gate(slug, domain["techName"], {
                    "title": r["title"],
                    "description": r.get("description") or "",
                    "channel_title": r.get("channel_title") or "",
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
