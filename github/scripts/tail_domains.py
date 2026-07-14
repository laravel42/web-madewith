#!/usr/bin/env python3
"""Live-tail the repository-per-domain counts while discovery/qualify runs.

Polls the database on an interval and redraws a table of how many repositories
are assigned to each technology (domain), sorted by count. Reads DATABASE_URL
from the environment or a neighbouring `.env`.

    python scripts/tail_domains.py                 # verified assignments, 2s refresh
    python scripts/tail_domains.py --interval 1    # faster refresh
    python scripts/tail_domains.py --status all    # count every assignment, not just verified
    python scripts/tail_domains.py --top 25        # only the 25 biggest domains
"""
from __future__ import annotations
import argparse, os, signal, sys, time
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    # Fall back to a .env next to the package (github/.env) or in the cwd.
    for env_path in (Path(__file__).resolve().parent.parent / ".env", Path.cwd() / ".env"):
        if env_path.is_file():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL=") and not line.startswith("#"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("DATABASE_URL not set (export it or add it to github/.env)")


TOTALS_SQL = """
SELECT
  (SELECT count(*) FROM repositories) AS repos,
  (SELECT count(DISTINCT repository_id) FROM repository_technologies {where}) AS assigned_repos,
  (SELECT count(*) FROM repository_technologies {where}) AS assignments
"""

COUNTS_SQL = """
SELECT t.slug AS domain, count(rt.repository_id) AS repos
FROM technologies t
JOIN repository_technologies rt ON rt.technology_id = t.id
{where}
GROUP BY t.slug
ORDER BY repos DESC, t.slug
"""


def fetch(conn, status: str) -> tuple[dict, list[dict]]:
    where = "" if status == "all" else "WHERE status = %(status)s"
    where_rt = "" if status == "all" else "WHERE rt.status = %(status)s"
    params = {"status": status}
    with conn.cursor() as cur:
        cur.execute(TOTALS_SQL.format(where=where), params)
        totals = cur.fetchone()
        cur.execute(COUNTS_SQL.format(where=where_rt), params)
        rows = cur.fetchall()
    return totals, rows


def build_table(totals: dict, rows: list[dict], status: str, top: int):
    from rich.table import Table
    from rich.console import Group
    from rich.text import Text

    shown = rows[:top] if top else rows
    biggest = shown[0]["repos"] if shown else 0
    no_domain = (totals["repos"] or 0) - (totals["assigned_repos"] or 0)

    header = Text.assemble(
        ("MadeWith · repos per domain", "bold cyan"),
        (f"   {datetime.now():%H:%M:%S}", "dim"),
        (f"   status={status}", "dim"),
    )
    stats = Text.assemble(
        ("repos ", "dim"), (f"{totals['repos'] or 0}", "bold"),
        ("   assigned ", "dim"), (f"{totals['assigned_repos'] or 0}", "bold green"),
        ("   no-domain ", "dim"), (f"{no_domain}", "bold yellow"),
        ("   domains ", "dim"), (f"{len(rows)}", "bold"),
        ("   assignments ", "dim"), (f"{totals['assignments'] or 0}", "bold"),
    )

    table = Table(box=None, pad_edge=False, expand=False)
    table.add_column("#", justify="right", style="dim", width=3)
    table.add_column("domain", style="cyan", no_wrap=True)
    table.add_column("repos", justify="right", style="bold")
    table.add_column("", style="green")  # bar
    for i, row in enumerate(shown, 1):
        n = row["repos"]
        bar = "█" * max(1, round(n / biggest * 30)) if biggest else ""
        table.add_row(str(i), row["domain"], str(n), bar)
    if not shown:
        table.add_row("", "(no assignments yet)", "", "")
    if top and len(rows) > top:
        table.add_row("", f"… +{len(rows) - top} more domains", "", "")
    return Group(header, stats, Text(""), table)


def render_plain(totals: dict, rows: list[dict], status: str, top: int) -> str:
    shown = rows[:top] if top else rows
    no_domain = (totals["repos"] or 0) - (totals["assigned_repos"] or 0)
    lines = [
        f"MadeWith · repos per domain   {datetime.now():%H:%M:%S}   status={status}",
        f"repos {totals['repos'] or 0}   assigned {totals['assigned_repos'] or 0}   "
        f"no-domain {no_domain}   domains {len(rows)}   assignments {totals['assignments'] or 0}",
        "",
    ]
    lines += [f"{i:>3}  {r['domain']:<24} {r['repos']}" for i, r in enumerate(shown, 1)]
    if not shown:
        lines.append("  (no assignments yet)")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="Live-tail repository-per-domain counts.")
    ap.add_argument("--interval", type=float, default=2.0, help="seconds between refreshes (default 2)")
    ap.add_argument("--status", default="verified", help="assignment status to count: verified|pending|rejected|all (default verified)")
    ap.add_argument("--top", type=int, default=0, help="show only the N biggest domains (default: all)")
    args = ap.parse_args()

    # Stop cleanly on Ctrl-C or `kill` (installing a SIGINT handler also
    # overrides the SIG_IGN that shells set on &-backgrounded processes).
    def _stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    dsn = load_database_url()
    interactive = sys.stdout.isatty()
    live = None
    if interactive:
        try:
            from rich.live import Live
            from rich.console import Console
            # auto_refresh=False → no background thread, so Ctrl-C lands cleanly.
            live = Live(console=Console(), auto_refresh=False, screen=False)
        except ImportError:
            live = None

    def connect():
        return psycopg.connect(dsn, row_factory=dict_row, autocommit=True)

    conn = connect()
    try:
        if live is not None:
            with live:
                while True:
                    try:
                        totals, rows = fetch(conn, args.status)
                        live.update(build_table(totals, rows, args.status, args.top), refresh=True)
                    except psycopg.Error:
                        conn = connect()
                    time.sleep(args.interval)
        else:
            while True:
                try:
                    totals, rows = fetch(conn, args.status)
                    if interactive:
                        os.system("clear" if os.name != "nt" else "cls")
                    else:
                        print("\n" + "=" * 60)
                    print(render_plain(totals, rows, args.status, args.top), flush=True)
                except psycopg.Error:
                    conn = connect()
                time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        conn.close()


if __name__ == "__main__":
    main()
