#!/usr/bin/env python3
"""Load github_<topic>.csv (from scrape_github.py) into Postgres via db.upsert_repository.

Usage:
    python load_csv_to_pg.py <csv_path> <catalog_slug> [--ensure-tech] [--min-stars N] [--include-archived]

Maps each CSV row to the repo dict shape expected by madewith_scraper.db.upsert_repository:
    full_name, description, stargazers_count, html_url, homepage, owner.{login,avatar_url},
    license.{spdx_id}, language, topics, pushed_at, archived, fork, _langs, _import_source

--ensure-tech creates the technologies row first (uses db.ensure_technology).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scraper"))


def row_to_repo_dict(row: dict[str, str], catalog_slug: str) -> dict[str, Any]:
    full_name = row["full_name"]
    owner_login = full_name.split("/")[0] if "/" in full_name else ""
    topics = [t.strip() for t in (row.get("topics") or "").split(",") if t.strip()]
    primary_lang = row.get("language") or None
    # CSV has no _langs (only primary). Build a single-entry list so the
    # _replace_languages helper can compute percentages from real bytes.
    langs = []
    if primary_lang:
        langs = [{"name": primary_lang, "size": 0, "pct": 100.0}]
    return {
        "name": full_name.split("/")[-1] if "/" in full_name else full_name,
        "full_name": full_name,
        "description": row.get("description") or None,
        "stargazers_count": int(row.get("stars") or 0),
        "forks_count": int(row.get("forks") or 0),
        "watchers_count": 0,
        "open_issues": 0,
        "open_pull_requests": 0,
        "html_url": row.get("url") or None,
        "homepage": None,
        "owner": {"login": owner_login, "avatar_url": None},
        "language": primary_lang,
        "primaryLanguage": {"name": primary_lang} if primary_lang else None,
        "license": {"spdx_id": row.get("license") or None},
        "topics": topics,
        "_langs": langs,
        "fork": False,
        "archived": (row.get("archived") or "").lower() == "true",
        "pushed_at": row.get("pushed_at") or None,
        "updated_at": row.get("updated_at") or None,
        "_import_source": f"csv:{catalog_slug}",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", help="Path to github_<topic>.csv (from scrape_github.py)")
    ap.add_argument("catalog_slug", help="Catalog slug, e.g. 'laravel'")
    ap.add_argument("--ensure-tech", action="store_true",
                    help="Create the technologies row if missing (uses db.ensure_technology)")
    ap.add_argument("--min-stars", type=int, default=0, help="Filter rows below this star count")
    ap.add_argument("--include-archived", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="Max rows to ingest (0 = all)")
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    from madewith_scraper import db

    conn = db.connect()
    inserted = updated = skipped = 0
    try:
        if args.ensure_tech:
            tid = db.ensure_technology(
                conn, args.catalog_slug,
                name=args.catalog_slug.replace("-", " ").title(),
                min_stars=args.min_stars,
                include_archived=args.include_archived,
                search_topics=[args.catalog_slug],
            )
            print(f"ensure_technology -> id={tid} for slug='{args.catalog_slug}'")

        with open(args.csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            i = 0
            for i, row in enumerate(reader, 1):
                if args.limit and i > args.limit:
                    break
                stars = int(row.get("stars") or 0)
                if stars < args.min_stars:
                    skipped += 1
                    continue
                if not args.include_archived and (row.get("archived") or "").lower() == "true":
                    skipped += 1
                    continue
                repo = row_to_repo_dict(row, args.catalog_slug)
                action = db.upsert_repository(conn, args.catalog_slug, repo)
                if action == "inserted":
                    inserted += 1
                elif action == "updated":
                    updated += 1
                else:
                    skipped += 1
                if i % 50 == 0:
                    print(f"  … {i} rows processed (ins={inserted} upd={updated} skip={skipped})")
        print(f"\nDone: inserted={inserted} updated={updated} skipped={skipped} (of {i} read)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
