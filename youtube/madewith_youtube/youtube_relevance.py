"""Strict tech-relevance gate for YouTube catalog videos."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[2] / "src" / "config" / "video-relevance.json"


@lru_cache(maxsize=1)
def load_rules() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def _compile(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(p, re.I) for p in patterns]


def _matches_any(patterns: list[re.Pattern[str]], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def _tech_patterns(slug: str, tech_name: str) -> list[re.Pattern[str]]:
    rules = load_rules()
    aliases = rules.get("techAliases", {}).get(slug, [])
    raw = [re.escape(tech_name), *aliases]
    slugish = slug.replace("-", "[ -]?")
    raw.append(slugish)
    return [re.compile(p, re.I) for p in raw]


def video_haystack(video: dict) -> str:
    title = video.get("title") or ""
    description = (video.get("description") or "")[:1200]
    channel = video.get("channel_title") or ""
    return f"{title} {description} {channel}".lower()


def passes_relevance_gate(slug: str, tech_name: str, video: dict) -> tuple[bool, str]:
    rules = load_rules()
    hay = video_haystack(video)

    global_reject = _compile(rules.get("globalReject", []))
    if _matches_any(global_reject, hay):
        return False, "off_topic_global"

    strict = rules.get("strictSlugs", {}).get(slug)
    if strict:
        reject = _compile(strict.get("reject", []))
        if _matches_any(reject, hay):
            return False, "off_topic_slug"

        require_any = _compile(strict.get("requireAny", []))
        if require_any and not _matches_any(require_any, hay):
            return False, "missing_tech_signals"
        return True, "ok"

    tech_patterns = _tech_patterns(slug, tech_name)
    if not _matches_any(tech_patterns, hay):
        return False, "missing_tech_name"

    programming = _compile(rules.get("programmingContext", []))
    if not _matches_any(programming, hay):
        return False, "missing_programming_context"

    return True, "ok"
