#!/usr/bin/env python3
"""Rotate VPN exit locations between transcription chunks.

A YouTube IP flag on one exit location would otherwise stall the whole queue.
transcribe_youtube.py fails fast after 3 consecutive blocked requests and exits
75; this driver catches that, switches to the next location, and resumes. The
queue is DB-driven and idempotent, so nothing is lost when a chunk is cut short.

Works with any provider offering manual WireGuard configs (SurfShark: dashboard
→ VPN → Manual setup → WireGuard → one .conf per location).

Setup (macOS):
    brew install wireguard-tools bash
    mkdir -p ~/vpn-wg && <download configs there>

Usage (run as your normal user; sudo is used only for wg-quick):
    python workers/videos/transcribe_rotate.py ~/vpn-wg [--chunk N] [--sleep S] [--workers W]

--workers is concurrent fetchers per location. They share one exit IP, so more
workers means faster fetching but faster location burn; 2-3 is the sweet spot
and rotation absorbs the burns.
"""

from __future__ import annotations

import argparse
import atexit
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV_PYTHON = HERE.parents[1] / ".venv" / "bin" / "python"
TRANSCRIBER = HERE / "transcribe_youtube.py"

BLOCK_EXIT = 75          # transcribe_youtube.py's "this IP is flagged" signal
MAX_PASSES = 3           # full cycles through every location before giving up
QUEUE_EMPTY_MARKER = "Processing 0 videos"
CHUNK_GAP_SECONDS = 3

_active_config: Path | None = None


def die(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def python_executable() -> str:
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def find_modern_bash() -> str:
    """wg-quick is a bash script needing bash 4+. macOS ships 3.2, and sudo's
    PATH finds only that one, so the interpreter has to be passed explicitly."""
    for candidate in ("/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/usr/bin/bash", "/bin/bash"):
        if not os.access(candidate, os.X_OK):
            continue
        probe = subprocess.run(
            [candidate, "-c", 'echo "${BASH_VERSINFO[0]}"'],
            capture_output=True, text=True,
        )
        if probe.returncode == 0 and probe.stdout.strip().isdigit() and int(probe.stdout.strip()) >= 4:
            return candidate
    die("wg-quick needs bash 4+ and only bash 3 was found — run: brew install bash")
    raise AssertionError("unreachable")


class Vpn:
    def __init__(self, wg_quick: str, bash: str) -> None:
        self.wg_quick = wg_quick
        self.bash = bash

    def _run(self, *args: str, quiet: bool = False) -> int:
        stream = subprocess.DEVNULL if quiet else None
        return subprocess.run(
            ["sudo", self.bash, self.wg_quick, *args], stdout=stream, stderr=stream
        ).returncode

    def down(self) -> None:
        global _active_config
        if _active_config is not None:
            self._run("down", str(_active_config), quiet=True)
            _active_config = None

    def up(self, config: Path) -> bool:
        global _active_config
        self.down()
        if self._run("up", str(config)) != 0:
            print(f"wg-quick up failed for {config.name} — skipping location", file=sys.stderr)
            return False
        _active_config = config
        print(f"\n=== location {config.stem} — exit IP {self.exit_ip()} ===", flush=True)
        return True

    @staticmethod
    def exit_ip() -> str:
        try:
            probe = subprocess.run(
                ["curl", "-s", "--max-time", "10", "https://api.ipify.org"],
                capture_output=True, text=True, timeout=15,
            )
            return probe.stdout.strip() or "?"
        except (subprocess.SubprocessError, OSError):
            return "?"


def run_chunk(chunk: int, sleep_seconds: float, workers: int) -> tuple[int, bool]:
    """Stream one transcription chunk, returning (exit code, queue emptied).

    Output is echoed live and scanned at the same time — the shell version
    piped through `tee` for exactly this reason.
    """
    process = subprocess.Popen(
        [
            python_executable(), str(TRANSCRIBER),
            "--limit", str(chunk),
            "--sleep", str(sleep_seconds),
            "--workers", str(workers),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    queue_empty = False
    assert process.stdout is not None
    for line in process.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if QUEUE_EMPTY_MARKER in line:
            queue_empty = True
    return process.wait(), queue_empty


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("conf_dir", type=Path, help="Directory of WireGuard .conf files.")
    parser.add_argument("--chunk", type=int, default=100, help="Videos per chunk (default 100).")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds between fetches (default 1).")
    parser.add_argument("--workers", type=int, default=2, help="Concurrent fetchers per location (default 2).")
    args = parser.parse_args()

    if not TRANSCRIBER.exists():
        die(f"{TRANSCRIBER} not found")
    configs = sorted(args.conf_dir.expanduser().glob("*.conf"))
    if not configs:
        die(f"No .conf files in {args.conf_dir}")
    wg_quick = shutil.which("wg-quick")
    if not wg_quick:
        die("wg-quick not found — brew install wireguard-tools")

    vpn = Vpn(wg_quick, find_modern_bash())
    atexit.register(vpn.down)

    print(
        f"{len(configs)} location(s), chunk={args.chunk}, "
        f"sleep={args.sleep}s, workers={args.workers}"
    )

    came_up = False
    index = 0
    passes = 0
    try:
        while passes < MAX_PASSES:
            config = configs[index % len(configs)]
            if vpn.up(config):
                came_up = True
                # Keep feeding this location chunks until it burns or the
                # queue drains.
                while True:
                    code, queue_empty = run_chunk(args.chunk, args.sleep, args.workers)
                    if queue_empty:
                        print("\nQueue empty — all pending videos transcribed.")
                        return 0
                    if code == BLOCK_EXIT:
                        print("Location burned — rotating.")
                        break
                    if code != 0:
                        print(
                            f"Transcriber failed with exit {code} (not an IP block) — stopping.",
                            file=sys.stderr,
                        )
                        return code
                    time.sleep(CHUNK_GAP_SECONDS)
            index += 1
            if index % len(configs) == 0:
                passes += 1
    except KeyboardInterrupt:
        print("\nInterrupted — bringing the tunnel down.", file=sys.stderr)
        return 130

    if not came_up:
        die(
            "No location could be brought up at all — see the wg-quick errors above "
            "(VPN app still connected? bad configs?)."
        )
    print(
        f"Every location was blocked across {MAX_PASSES} passes — wait a few hours and re-run.",
        file=sys.stderr,
    )
    return BLOCK_EXIT


if __name__ == "__main__":
    raise SystemExit(main())
