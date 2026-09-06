#!/usr/bin/env python3
"""Scheduled launchers for the GitHub discovery service.

Replaces run_discover.sh / run_import.sh. Both jobs append to a rotating log in
workers/github/logs/ and hold a lockfile, so a still-running (or manual) run
never overlaps the next scheduled one.

    python workers/github/scheduled.py discover
    python workers/github/scheduled.py import

`discover` searches GitHub across every enabled technology and classifies what
it finds. `import` replays already-published src/data/*.json into Postgres and
then — only when it actually imported something new — runs `qualify` to assign
domains, because qualify is the expensive half.

LaunchAgent note: com.madewith.github-discover (and its import sibling) must
point at this file. The old shell paths no longer exist.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOG_DIR = HERE / "logs"
# Shared workers venv (same as pipeline.py / README), not the repo-root .venv.
VENV_BIN = HERE.parent / ".venv" / "bin"
CLI = VENV_BIN / "madewith-github"
PYTHON = VENV_BIN / "python"

LOG_MAX_BYTES = 10 * 1024 * 1024
NOTHING_NEW_EXIT = 10  # import_published.py: ran fine, found no new repos


def stamp() -> str:
    return datetime.now().strftime("%F %T")


def rotate(log: Path) -> None:
    if log.exists() and log.stat().st_size > LOG_MAX_BYTES:
        log.replace(log.with_suffix(log.suffix + ".1"))


class Lock:
    """Atomic via mkdir, matching the shell version: an existing directory means
    a previous run is still active, and this run should skip rather than queue."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.held = False

    def __enter__(self) -> "Lock":
        try:
            self.path.mkdir()
            self.held = True
        except FileExistsError:
            self.held = False
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.held:
            try:
                self.path.rmdir()
            except OSError:
                pass


def append(log: Path, message: str) -> None:
    with log.open("a", encoding="utf-8") as handle:
        handle.write(message + "\n")


def run_logged(args: list[str], log: Path) -> int:
    """Run with stdout+stderr appended to the log, as `>>"$LOG" 2>&1` did."""
    with log.open("a", encoding="utf-8") as handle:
        return subprocess.run(
            [str(a) for a in args], cwd=str(HERE), stdout=handle, stderr=subprocess.STDOUT
        ).returncode


def job_discover(log: Path) -> int:
    append(log, f"===== {stamp()} discover start =====")
    code = run_logged([CLI, "discover"], log)
    append(log, f"===== {stamp()} discover end (exit {code}) =====")
    return code


def job_import(log: Path) -> int:
    append(log, f"===== {stamp()} resume import =====")
    code = run_logged([PYTHON, HERE / "import_published.py", "--apply"], log)
    # import_published exits 0 only when it imported new repos; 10 means nothing
    # new (skip the expensive qualify), anything else is an error (also skip).
    if code == 0:
        append(log, f"----- {stamp()} qualify (assign domains to newly imported repos) -----")
        run_logged([CLI, "qualify", "-q"], log)
    else:
        append(log, f"----- {stamp()} skip qualify (no new repos imported, exit {code}) -----")
    append(log, f"===== {stamp()} cycle done =====")
    return 0 if code in (0, NOTHING_NEW_EXIT) else code


JOBS = {"discover": job_discover, "import": job_import}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("job", choices=sorted(JOBS))
    args = parser.parse_args()

    if not CLI.exists():
        print(
            f"{CLI} missing — run: workers/.venv/bin/pip install -e workers/github",
            file=sys.stderr,
        )
        return 1

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = LOG_DIR / f"{args.job}.log"
    rotate(log)

    with Lock(LOG_DIR / f"{args.job}.lock") as lock:
        if not lock.held:
            append(log, f"{stamp()} skip — previous {args.job} run still active")
            return 0
        return JOBS[args.job](log)


if __name__ == "__main__":
    raise SystemExit(main())
