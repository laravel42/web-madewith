#!/usr/bin/env python3
"""Print github_search_runs shard progress."""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT / "scraper"))

from madewith_scraper import db  # noqa: E402
from madewith_scraper.db import RUN_PREFIX  # noqa: E402


def main() -> None:
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT correlation_id, status, result_count, error, finished_at
                FROM github_search_runs
                WHERE correlation_id LIKE %s
                ORDER BY correlation_id
                """,
                (f"{RUN_PREFIX}%",),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        print("No spawn:* search runs yet.")
        return

    counts = {"running": 0, "completed": 0, "failed": 0}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        err = ""
        if row["status"] == "failed" and row["error"]:
            err = f" — {row['error']}"
        print(f"{row['status']:<10} {row['correlation_id']:<40} repos={row['result_count'] or 0}{err}")

    print(
        f"\n{counts.get('completed', 0)} completed, "
        f"{counts.get('running', 0)} running, "
        f"{counts.get('failed', 0)} failed "
        f"({len(rows)} total)"
    )


if __name__ == "__main__":
    main()
