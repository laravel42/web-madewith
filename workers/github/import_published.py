#!/usr/bin/env python3
"""Import repositories from the previously published `src/data/<slug>.json`
into the current database.

The published JSON (from the old Scrapy pipeline) lists repositories per domain
but carries no GitHub numeric id — which `repositories.github_repository_id`
requires and de-duplicates on. So for every repo not already in the DB this
resolves the id with a single `GET /repos/{full_name}` call, upserts the
repository (with topics/languages taken from the JSON), and links it to the
domain technology(ies) it appears under. Repos already present are skipped with
no API call, so the import is safe and cheap to re-run / resume.

    python github/import_published.py                  # dry run — no API, no writes
    python github/import_published.py --slug laravel   # one domain
    python github/import_published.py --apply          # perform the import
    python github/import_published.py --apply --limit 500

It stops cleanly if the GitHub rate limit is exhausted; just re-run to resume.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

import httpx
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # repo root (HERE is workers/github)
sys.path.insert(0, str(HERE / "src"))
load_dotenv(HERE / ".env")

from madewith_github.config import Settings  # noqa: E402
from madewith_github.github import RateLimitExceeded  # noqa: E402
from madewith_github.service import DiscoveryService  # noqa: E402

DATA_DIR = ROOT / "src" / "data"
# Catalog slugs whose technology row uses a different slug.
CATALOG_TO_TECH = {"next": "nextjs"}


def load_files(slug_filter: str | None):
    for path in sorted(DATA_DIR.glob("*.json")):
        slug = path.stem
        if slug_filter and slug != slug_filter:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("projects"), list):
            yield slug, data["projects"]


async def main() -> int:
    ap = argparse.ArgumentParser(description="Import published-JSON repos into the DB.")
    ap.add_argument("--slug", help="Limit to one catalog slug (file stem)")
    ap.add_argument("--limit", type=int, help="Import at most N repositories")
    ap.add_argument("--apply", action="store_true", help="Perform the import (default: dry run)")
    ap.add_argument("--delay", type=float, default=0.8,
                    help="Seconds to pause between repo lookups (default 0.8) — keeps under GitHub's "
                         "secondary rate limit, which bursts trip well before the primary quota runs out")
    args = ap.parse_args()

    svc = DiscoveryService(Settings())
    try:
        with svc.db.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT slug, id FROM technologies WHERE enabled = true")
            tech_by_slug = {r["slug"]: r["id"] for r in cur.fetchall()}
            cur.execute("SELECT lower(full_name) AS fn FROM repositories")
            existing = {r["fn"] for r in cur.fetchall()}

        def tech_id_for(slug: str) -> int | None:
            return tech_by_slug.get(CATALOG_TO_TECH.get(slug, slug))

        # Collapse to one entry per repo, remembering every domain it appears
        # under and the richest project payload (topics/langs) seen for it.
        repos: dict[str, dict] = {}
        skipped_existing = 0
        invalid_domain: Counter[str] = Counter()
        for slug, projects in load_files(args.slug):
            tid = tech_id_for(slug)
            if tid is None:
                invalid_domain[slug] += len(projects)
                continue
            for project in projects:
                full = (project.get("fullName") or "").strip()
                if not full:
                    continue
                key = full.lower()
                if key in existing:
                    skipped_existing += 1
                    continue
                entry = repos.setdefault(full, {"project": project, "domains": {}})
                entry["domains"][tid] = slug
                if len(project.get("topics") or []) > len(entry["project"].get("topics") or []):
                    entry["project"] = project

        candidates = list(repos.items())
        if args.limit:
            candidates = candidates[: args.limit]

        print(f"{skipped_existing} project row(s) already in the DB · {len(repos)} unique repo(s) to import"
              + (f" · limited to {len(candidates)}" if args.limit else ""))
        if invalid_domain:
            print("Skipped domains with no matching technology: "
                  + ", ".join(f"{s}({n})" for s, n in invalid_domain.most_common()))

        if not args.apply:
            by_slug = Counter()
            for _, entry in candidates:
                for s in entry["domains"].values():
                    by_slug[s] += 1
            print("\nNew repos by domain:")
            for slug, n in by_slug.most_common():
                print(f"  {n:>5}  {slug}")
            print(f"\nDry run — {len(candidates)} repo(s) would be imported (~{len(candidates)} API calls). "
                  "Re-run with --apply.")
            return 0

        imported = gone = 0
        rate_stopped = False
        for i, (full, entry) in enumerate(candidates, 1):
            if i > 1 and args.delay > 0:
                await asyncio.sleep(args.delay)
            try:
                detail = await svc.gh.repository(full)
            except RateLimitExceeded as exc:
                print(f"■ rate limit reached — stopping at {i - 1}/{len(candidates)}: {exc}")
                rate_stopped = True
                break
            except (httpx.HTTPStatusError, httpx.HTTPError, KeyError):
                gone += 1  # deleted / renamed / private
                continue

            repo_id = svc.db.upsert_repository(detail)
            project = entry["project"]
            topics = [t for t in (project.get("topics") or []) if t]
            if topics:
                svc.db.replace_topics(repo_id, topics)
            langs = {l["name"]: int(l.get("size") or l.get("pct") or 0)
                     for l in (project.get("langs") or []) if l.get("name")}
            if langs:
                svc.db.replace_languages(repo_id, langs)
            with svc.db.connection() as conn, conn.cursor() as cur:
                for tid, slug in entry["domains"].items():
                    cur.execute(
                        """INSERT INTO repository_technologies
                           (repository_id, technology_id, confidence, status, auto_approved, evidence,
                            verified_at, created_at, updated_at)
                           VALUES (%s, %s, 0, 'discovered', false, %s, now(), now(), now())
                           ON CONFLICT (repository_id, technology_id) DO NOTHING""",
                        (repo_id, tid, json.dumps([{"kind": "import", "source": "published-json", "slug": slug}])),
                    )
            imported += 1
            if i % 50 == 0:
                print(f"  … {i}/{len(candidates)} ({imported} imported, {gone} gone)")

        tail = " (stopped at rate limit — re-run to resume)" if rate_stopped else ""
        print(f"\nImported {imported} repo(s); {gone} deleted/renamed/private and skipped{tail}.")
        # Exit 10 signals "nothing new imported" so the scheduler can skip the
        # (expensive) qualify step this cycle.
        return 0 if imported else 10
    finally:
        await svc.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
