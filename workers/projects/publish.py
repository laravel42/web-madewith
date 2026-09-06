#!/usr/bin/env python3
"""Write src/data/<slug>.json from Postgres for Astro build."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from madewith_scraper import db  # noqa: E402
from madewith_scraper.domains import load_domains  # noqa: E402
from madewith_scraper.normalize import rank_and_keep  # noqa: E402

DATA_DIR = ROOT / "src" / "data"
# Keep every ranked project by default; SCRAPE_KEEP can still impose a cap.
_KEEP_ENV = __import__("os").environ.get("SCRAPE_KEEP")
KEEP = int(_KEEP_ENV) if _KEEP_ENV else None


def main() -> None:
    filter_slugs = None
    args = [a for a in sys.argv[1:] if a != "--"]
    if args:
        filter_slugs = {s.strip() for s in ",".join(args).split(",") if s.strip()}

    domains = load_domains()
    if filter_slugs:
        domains = [d for d in domains if d["slug"] in filter_slugs]

    conn = db.connect()
    published = 0
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        for domain in domains:
            slug = domain["slug"]
            repos = db.load_repos_for_slug(conn, slug)
            projects = rank_and_keep(domain, repos, KEEP)
            if not projects:
                print(f"• {slug:<14} no projects")
                continue

            total = max(len(projects), len(repos))
            out = DATA_DIR / f"{slug}.json"
            # scrapedAt only advances when projects/totalRepos actually changed —
            # otherwise every no-op publish (e.g. a build with no fresh GitHub
            # scrape) re-stamps "now" into 69 domains' llms.txt and RSS
            # <lastBuildDate>, making a content-identical deploy look changed
            # to deploy_s3.py's ETag diff and firing a CDN invalidation for
            # nothing.
            scraped_at = datetime.now(timezone.utc).isoformat()
            try:
                previous = json.loads(out.read_text(encoding="utf-8"))
                if previous.get("totalRepos") == total and previous.get("projects") == projects:
                    scraped_at = previous.get("scrapedAt", scraped_at)
            except (OSError, json.JSONDecodeError):
                pass
            payload = {
                "slug": slug,
                "scrapedAt": scraped_at,
                "source": "scrapy-github",
                "totalRepos": total,
                "projects": projects,
            }
            out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            db.record_publish(conn, slug, len(projects), total)
            published += 1
            print(f"✓ {slug:<14} {len(projects)} projects")
    finally:
        conn.close()

    print(f"\nPublished {published}/{len(domains)} domains → {DATA_DIR}")


if __name__ == "__main__":
    main()
