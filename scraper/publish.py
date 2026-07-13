#!/usr/bin/env python3
"""Write src/data/<slug>.json from Postgres for Astro build."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

sys.path.insert(0, str(ROOT / "scraper"))

from madewith_scraper import db  # noqa: E402
from madewith_scraper.domains import load_domains  # noqa: E402
from madewith_scraper.normalize import rank_and_keep  # noqa: E402

DATA_DIR = ROOT / "src" / "data"
KEEP = int(__import__("os").environ.get("SCRAPE_KEEP", "1000"))


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
            payload = {
                "slug": slug,
                "scrapedAt": datetime.now(timezone.utc).isoformat(),
                "source": "scrapy-github",
                "totalRepos": total,
                "projects": projects,
            }
            out = DATA_DIR / f"{slug}.json"
            out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            db.record_publish(conn, slug, len(projects), total)
            published += 1
            print(f"✓ {slug:<14} {len(projects)} projects")
    finally:
        conn.close()

    print(f"\nPublished {published}/{len(domains)} domains → {DATA_DIR}")


if __name__ == "__main__":
    main()
