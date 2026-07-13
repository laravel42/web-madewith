"""Quality gates for YouTube tech tutorials — English only, no low-effort uploads."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Well-known edu channels — relaxed view floor, quality boost
TRUSTED_CHANNELS = {
    "freecodecamp.org",
    "fireship",
    "traversy media",
    "the net ninja",
    "wes bos",
    "academind",
    "programming with mosh",
    "corey schafer",
    "laracasts",
    "jeffgeerling",
    "syntax",
    "web dev simplified",
    "developedbyed",
    "derek banas",
    "thenewboston",
    "leveluptuts",
    "designcourse",
    "kyle cook",
    "tech with tim",
    "jack herrington",
    "bytegrad",
    "hitesh choudhary",
}

NON_ENGLISH_HINTS = re.compile(
    r"\b(hindi|urdu|tamil|telugu|bengali|marathi|punjabi|spanish|portugu[eê]s|fran[cç]ais|deutsch|"
    r"русск|中文|日本語|한국|arabic|turkish|türk|bahasa)\b",
    re.I,
)

HOMemade_TITLE_PATTERNS = re.compile(
    r"(#shorts\b|youtube shorts\b|\bshorts\b|\bwatch me\b|\bvibe cod|\bcoding with me\b|"
    r"\blive stream\b|\bday in the life\b|\bmy first\b|\bnoob\b|\beasy tutorial\b.*\bbeginners?\b|"
    r"\bfull course free\b|\b100% free\b|\bclick here\b|\bsubscribe\b.*\bbell\b)",
    re.I,
)

CLICKBAIT_PATTERNS = re.compile(
    r"(^you won'?t believe\b|^\d+\s+(reasons|things|ways)\b.*\b(don'?t|never)\b|"
    r"\b(shocked|insane|mind[- ]?blowing)\b|!!!+)",
    re.I,
)

LATIN_RATIO_MIN = 0.72


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return float(raw)


@dataclass(frozen=True)
class QualityConfig:
    min_views: int = 10_000
    min_views_trusted: int = 2_000
    min_channel_subs: int = 5_000
    min_channel_subs_trusted: int = 1_000
    min_duration_sec: int = 480
    max_duration_sec: int = 10_800
    min_like_ratio: float = 0.004
    min_title_len: int = 18
    max_title_len: int = 120
    require_hd: bool = True
    require_english_lang: bool = True


def load_config() -> QualityConfig:
    return QualityConfig(
        min_views=_env_int("YOUTUBE_MIN_VIEWS", 10_000),
        min_views_trusted=_env_int("YOUTUBE_MIN_VIEWS_TRUSTED", 2_000),
        min_channel_subs=_env_int("YOUTUBE_MIN_CHANNEL_SUBS", 5_000),
        min_channel_subs_trusted=_env_int("YOUTUBE_MIN_CHANNEL_SUBS_TRUSTED", 1_000),
        min_duration_sec=_env_int("YOUTUBE_MIN_DURATION_SEC", 480),
        max_duration_sec=_env_int("YOUTUBE_MAX_DURATION_SEC", 10_800),
        min_like_ratio=_env_float("YOUTUBE_MIN_LIKE_RATIO", 0.004),
    )


def parse_iso8601_duration(value: str | None) -> int:
    if not value:
        return 0
    m = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
        value.strip(),
    )
    if not m:
        return 0
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    seconds = int(m.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def format_duration(seconds: int) -> str:
    if seconds <= 0:
        return "0:00"
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _latin_letter_ratio(text: str) -> float:
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 1.0
    latin = sum(1 for ch in letters if ch.isascii())
    return latin / len(letters)


def _normalize_lang(code: str | None) -> str:
    if not code:
        return ""
    return code.lower().replace("_", "-").split("-")[0]


def is_english(video: dict, cfg: QualityConfig | None = None) -> tuple[bool, str]:
    cfg = cfg or load_config()
    lang = _normalize_lang(video.get("default_audio_language") or video.get("default_language"))
    if cfg.require_english_lang and lang and lang != "en":
        return False, f"language:{lang}"

    title = video.get("title") or ""
    description = (video.get("description") or "")[:500]
    hay = f"{title} {description}"
    if NON_ENGLISH_HINTS.search(hay):
        return False, "non_english_keywords"

    if _latin_letter_ratio(title) < LATIN_RATIO_MIN:
        return False, "non_latin_title"

    return True, "ok"


def is_trusted_channel(channel_title: str | None) -> bool:
    if not channel_title:
        return False
    normalized = channel_title.strip().lower()
    return any(trusted in normalized for trusted in TRUSTED_CHANNELS)


def quality_score(video: dict) -> float:
    views = max(video.get("view_count") or 0, 1)
    subs = max(video.get("channel_subscriber_count") or 0, 1)
    likes = video.get("like_count") or 0
    duration = video.get("duration_seconds") or 0
    like_ratio = likes / views

    score = 0.0
    score += min(40.0, (views ** 0.25) * 2.2)
    score += min(25.0, (subs ** 0.2) * 1.8)
    score += min(20.0, like_ratio * 2000)
    if 900 <= duration <= 3600:
        score += 12.0
    elif duration >= 480:
        score += 6.0
    if is_trusted_channel(video.get("channel_title")):
        score += 15.0
    if (video.get("definition") or "").lower() == "hd":
        score += 5.0
    return round(score, 2)


def passes_quality_gate(video: dict, cfg: QualityConfig | None = None) -> tuple[bool, str]:
    cfg = cfg or load_config()
    trusted = is_trusted_channel(video.get("channel_title"))

    ok, reason = is_english(video, cfg)
    if not ok:
        return False, reason

    title = (video.get("title") or "").strip()
    if len(title) < cfg.min_title_len:
        return False, "title_too_short"
    if len(title) > cfg.max_title_len:
        return False, "title_too_long"
    if title.isupper() and len(title) > 24:
        return False, "all_caps_title"
    if HOMemade_TITLE_PATTERNS.search(title):
        return False, "homemade_pattern"
    if CLICKBAIT_PATTERNS.search(title):
        return False, "clickbait"

    duration = video.get("duration_seconds") or 0
    if duration < cfg.min_duration_sec:
        return False, "too_short"
    if duration > cfg.max_duration_sec:
        return False, "too_long"

    views = video.get("view_count") or 0
    min_views = cfg.min_views_trusted if trusted else cfg.min_views
    if views < min_views:
        return False, "low_views"

    subs = video.get("channel_subscriber_count") or 0
    min_subs = cfg.min_channel_subs_trusted if trusted else cfg.min_channel_subs
    if subs < min_subs:
        return False, "low_channel_subs"

    if cfg.require_hd and (video.get("definition") or "").lower() not in ("hd", "high"):
        return False, "not_hd"

    likes = video.get("like_count") or 0
    if views >= 1000:
        like_ratio = likes / views
        if like_ratio < cfg.min_like_ratio:
            return False, "low_engagement"

    return True, "ok"
