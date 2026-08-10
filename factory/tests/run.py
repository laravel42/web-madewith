#!/usr/bin/env python3
"""Run the factory test suite: `python tests/run.py [name ...]`.

The batch suite drives main(), which prints a full batch log. That noise is
captured so only check results reach the terminal; pass --verbose to see it.
"""
from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_batch  # noqa: E402
import test_finalize  # noqa: E402

SUITES = {"finalize": test_finalize, "batch": test_batch}
NOISY = {"batch"}


def main() -> int:
    argv = sys.argv[1:]
    verbose = "--verbose" in argv
    selected = [a for a in argv if not a.startswith("-")] or list(SUITES)
    unknown = [name for name in selected if name not in SUITES]
    if unknown:
        print(f"unknown suite(s): {unknown}; available: {sorted(SUITES)}", file=sys.stderr)
        return 2

    out = sys.stdout
    failures: list[str] = []

    for name in selected:
        print(f"\n=== {name} ===", file=out, flush=True)

        def check(label: str, passed: bool, detail: str = "", _suite: str = name) -> None:
            line = ("PASS   " if passed else "FAIL   ") + label
            if detail and not passed:
                line += f"  [{detail}]"
            print(line, file=out, flush=True)
            if not passed:
                failures.append(f"{_suite}: {label}")

        sink = io.StringIO()
        redirect = (
            contextlib.redirect_stdout(sink)
            if name in NOISY and not verbose
            else contextlib.nullcontext()
        )
        with redirect:
            SUITES[name].run(check)

    print("", file=out)
    if failures:
        print(f"{len(failures)} FAILURE(S):\n  " + "\n  ".join(failures), file=out)
        return 1
    print("ALL CHECKS PASSED", file=out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
