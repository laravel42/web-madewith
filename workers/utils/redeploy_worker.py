#!/usr/bin/env python3
"""
MadeWithWhat Redeploy Worker
============================

Rebuilds and republishes the static site on a fixed interval (hourly by
default), picking up whatever the discovery worker has written to the
database since the last run:

    1. projects:publish — regenerate src/data/*.json from Postgres, which is
       where discovery_worker.py's LLM-written descriptions live.
    2. pnpm build       — render the static site.
    3. deploy_s3.py     — upload only the changed files, then invalidate the
       CDN for exactly those URLs.

Split out of the discovery worker on purpose: a full build of this site takes
several minutes, so folding it into every discovery cycle would throttle
discovery to one repository per build.

Fault-tolerant: a failed run logs and waits for the next interval rather than
stopping the loop. Ctrl+C still exits.

Usage:
    workers/.venv/bin/python workers/utils/redeploy_worker.py
    workers/.venv/bin/python workers/utils/redeploy_worker.py --once
    workers/.venv/bin/python workers/utils/redeploy_worker.py --interval-seconds 1800
    workers/.venv/bin/python workers/utils/redeploy_worker.py --skip-publish
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env", override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("redeploy")

VENV_PYTHON = REPO_ROOT / "workers" / ".venv" / "bin" / "python"
DEFAULT_INTERVAL = int(os.getenv("REDEPLOY_INTERVAL_SECONDS", str(60 * 60)))


def run_step(args: list[str], *, label: str) -> None:
    log.info("running: %s", " ".join(args))
    result = subprocess.run(args, cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        tail = "\n".join((result.stdout + result.stderr).splitlines()[-40:])
        raise RuntimeError(f"{label} failed (exit {result.returncode}):\n{tail}")
    # deploy_s3.py's own summary lines (uploaded/unchanged/invalidated) are
    # the useful part of an otherwise very long build log.
    for line in result.stdout.splitlines()[-6:]:
        if line.strip():
            log.info("  %s", line.strip())


def run_once(*, skip_publish: bool) -> None:
    started = datetime.now(UTC)

    if skip_publish:
        log.info("[1/3] publish: skipped (--skip-publish)")
    else:
        log.info("[1/3] publish: regenerating src/data/*.json from Postgres...")
        run_step([str(VENV_PYTHON), "workers/pipeline.py", "projects:publish"], label="projects:publish")

    log.info("[2/3] build: pnpm build...")
    run_step(["pnpm", "build"], label="pnpm build")

    log.info("[3/3] deploy: uploading changed files + invalidating CDN...")
    run_step([str(VENV_PYTHON), "workers/utils/deploy_s3.py"], label="deploy_s3.py")

    elapsed = (datetime.now(UTC) - started).total_seconds()
    log.info("redeploy complete in %.1fs — %s", elapsed,
              os.getenv("SITE_URL", "https://madewithwhat.net").rstrip("/"))


def main() -> int:
    parser = argparse.ArgumentParser(description="MadeWithWhat redeploy worker")
    parser.add_argument("--once", action="store_true", help="Run a single redeploy then exit.")
    parser.add_argument("--interval-seconds", type=int, default=DEFAULT_INTERVAL,
                         help=f"Seconds between redeploys (default {DEFAULT_INTERVAL}).")
    parser.add_argument("--skip-publish", action="store_true",
                         help="Build/deploy the committed src/data/*.json without regenerating from Postgres.")
    args = parser.parse_args()

    log.info("redeploy worker starting (interval=%ds)", args.interval_seconds)

    while True:
        try:
            run_once(skip_publish=args.skip_publish)
        except Exception:
            log.error("redeploy failed, will retry next interval:\n%s", traceback.format_exc())
            if args.once:
                return 1

        if args.once:
            return 0
        log.info("sleeping %ds until next redeploy", args.interval_seconds)
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
