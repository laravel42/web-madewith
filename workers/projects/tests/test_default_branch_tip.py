"""default_branch_tip must use the default-branch commit, never any-branch pushedAt."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from madewith_scraper.spiders.github import default_branch_tip  # noqa: E402


def test_prefers_history_over_target_and_ignores_pushed_at():
    tip, branch = default_branch_tip(
        {
            "pushedAt": "2026-09-11T18:46:21Z",
            "defaultBranchRef": {
                "name": "main",
                "target": {
                    "committedDate": "2026-09-10T15:41:29Z",
                    "history": {"nodes": [{"committedDate": "2026-09-10T15:41:29Z"}]},
                },
            },
        }
    )
    assert tip == "2026-09-10T15:41:29Z"
    assert branch == "main"


def test_falls_back_to_target_committed_date():
    tip, branch = default_branch_tip(
        {
            "pushedAt": "2026-09-11T14:34:16Z",
            "defaultBranchRef": {
                "name": "13.x",
                "target": {"committedDate": "2026-09-11T14:34:16Z", "history": {"nodes": []}},
            },
        }
    )
    assert tip == "2026-09-11T14:34:16Z"
    assert branch == "13.x"


def test_missing_tip_does_not_use_pushed_at():
    tip, branch = default_branch_tip({"pushedAt": "2026-09-11T18:46:21Z", "defaultBranchRef": None})
    assert tip is None
    assert branch is None


if __name__ == "__main__":
    test_prefers_history_over_target_and_ignores_pushed_at()
    test_falls_back_to_target_committed_date()
    test_missing_tip_does_not_use_pushed_at()
    print("ok")
