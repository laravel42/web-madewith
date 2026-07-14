#!/usr/bin/env python3
"""Load every github_*.csv in /tmp/github-scrape into Postgres.

Replays what load_csv_to_pg.py does, but for every CSV in a directory at
once, and uses the catalog's per-slug minStars + exclude rules automatically.

Usage:
    python load_all_csv_to_pg.py [csv_dir] [--ensure-tech] [--include-archived]
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scraper"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_dir", nargs="?", default="/tmp/github-scrape")
    ap.add_argument("--ensure-tech", action="store_true")
    ap.add_argument("--include-archived", action="store_true")
    ap.add_argument("--min-stars", type=int, default=0, help="Override per-slug minStars (0 = use catalog)")
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    from madewith_scraper import db
    from madewith_scraper.domains import load_domains

    domains = {d["slug"]: d for d in load_domains()}

    csv_dir = Path(args.csv_dir)
    csvs = sorted(csv_dir.glob("github_*.csv"))
    if not csvs:
        print(f"No github_*.csv files in {csv_dir}", file=sys.stderr)
        return 1
    print(f"Loading {len(csvs)} CSVs from {csv_dir}\n")

    conn = db.connect()
    grand_ins = grand_upd = grand_skip = 0
    t0 = time.time()
    try:
        for csv_path in csvs:
            slug = csv_path.stem.replace("github_", "")
            domain = domains.get(slug)
            if not domain:
                print(f"• {slug:<20} (no catalog entry, skipping)")
                continue
            min_stars = args.min_stars or domain.get("scrape", {}).get("minStars", 0)
            if args.ensure_tech:
                try:
                    db.ensure_technology(
                        conn, slug,
                        name=domain.get("techName", slug.title()),
                        min_stars=min_stars,
                        include_archived=args.include_archived,
                        search_topics=[slug],
                    )
                except Exception as e:
                    print(f"⚠ ensure_technology({slug}) failed: {e}", file=sys.stderr)

            from load_csv_to_pg import row_to_repo_dict  # type: ignore
            ins = upd = skip = 0
            with csv_path.open(newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    stars = int(row.get("stars") or 0)
                    if stars < min_stars:
                        skip += 1
                        continue
                    if not args.include_archived and (row.get("archived") or "").lower() == "true":
                        skip += 1
                        continue
                    repo = row_to_repo_dict(row, slug)
                    action = db.upsert_repository(conn, slug, repo)
                    if action == "inserted":   ins += 1
                    elif action == "updated":  upd += 1
                    else:                      skip += 1
            print(f"✓ {slug:<20} minStars={min_stars:<4} ins={ins:>4} upd={upd:>4} skip={skip:>4}")
            grand_ins += ins; grand_upd += upd; grand_skip += skip
    finally:
        conn.close()

    dt = time.time() - t0
    print(f"\nDone in {dt:.1f}s — inserted={grand_ins} updated={grand_upd} skipped={grand_skip} across {len(csvs)} slugs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
