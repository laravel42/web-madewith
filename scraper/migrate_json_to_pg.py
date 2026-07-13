#!/usr/bin/env python3
"""Import scraped repos from src/data/<slug>.json into Postgres (deduped by full_name)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "src" / "data"
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT / "scraper"))

from madewith_scraper import db  # noqa: E402
from madewith_scraper.domains import load_domains  # noqa: E402
from madewith_scraper.json_import import project_to_raw  # noqa: E402


def load_dataset(slug: str, git_ref: str | None) -> dict | None:
    if git_ref:
        path = f"{git_ref}:src/data/{slug}.json"
        try:
            out = subprocess.check_output(["git", "show", path], cwd=ROOT, stderr=subprocess.DEVNULL)
            return json.loads(out)
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            return None
    file_path = DATA_DIR / f"{slug}.json"
    if not file_path.exists():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def main() -> None:
    git_ref = None
    filter_slugs = None
    args = [a for a in sys.argv[1:] if a != "--"]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--from-git" and i + 1 < len(args):
            git_ref = args[i + 1]
            i += 2
            continue
        if arg.startswith("--from-git="):
            git_ref = arg.split("=", 1)[1]
            i += 1
            continue
        filter_slugs = {s.strip() for s in arg.split(",") if s.strip()}
        i += 1

    domains = load_domains()
    if filter_slugs:
        domains = [d for d in domains if d["slug"] in filter_slugs]

    conn = db.connect()
    totals = {"inserted": 0, "updated": 0, "skipped": 0, "projects": 0, "domains": 0}
    try:
        source = f"git:{git_ref}" if git_ref else str(DATA_DIR)
        print(f"Importing from {source}\n")
        for domain in domains:
            slug = domain["slug"]
            payload = load_dataset(slug, git_ref)
            if not payload:
                print(f"• {slug:<14} no JSON")
                continue
            projects = payload.get("projects") or []
            if not projects:
                print(f"• {slug:<14} empty")
                continue

            ins = upd = skip = 0
            for project in projects:
                raw = project_to_raw(project)
                if not raw:
                    skip += 1
                    continue
                action = db.upsert_repository(conn, slug, raw)
                if action == "inserted":
                    ins += 1
                elif action == "updated":
                    upd += 1
                else:
                    skip += 1

            totals["inserted"] += ins
            totals["updated"] += upd
            totals["skipped"] += skip
            totals["projects"] += len(projects)
            totals["domains"] += 1
            print(f"✓ {slug:<14} {len(projects)} projects ({ins} new, {upd} merged)")
    finally:
        conn.close()

    print(
        f"\nDone: {totals['domains']} domains, {totals['projects']} projects — "
        f"{totals['inserted']} inserted, {totals['updated']} updated, {totals['skipped']} skipped"
    )


if __name__ == "__main__":
    main()
