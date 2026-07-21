"""Repository → catalog-category classifier (publish pipeline).

Python port of the shared scoring engine. The algorithm and the weighted
signal table are defined once in ``shared/classify-signals.json`` and consumed
by both this module and the Cloudflare Worker (``shared/classify.mjs``) — a
change to the table fixes both pipelines; a change to the *algorithm* must be
mirrored in both engines (guarded by the shared golden-fixture test suites).

Replaces the substring first-match classifier, whose failure modes were live in
the published data: "ai" matched inside "maintain"/"email"/"domain" and "ml"
inside "html" (which is how ~32% of the catalog landed in "AI & ML"), "ui"
matched inside "building", and one weak keyword outranked several strong ones.

Algorithm (identical to shared/classify.mjs):
  - word-boundary tokenization, plus hyphen-joined bi/trigram phrases so
    "design system" and "static site generator" match as phrases;
  - weighted signals, source-weighted (topic 1.5x > name 1.2x > description
    1x), each term counted once at its strongest source;
  - phrase suppression: a matched phrase ("shadcn-ui") stops its component
    words ("shadcn", "ui") from also scoring for the same category;
  - diminishing returns per category (1, 0.6, 0.36, ...) so one definitive
    signal beats a pile of weak incidental ones;
  - support-only styling terms (tailwind/bootstrap/shadcn) can't win UI Kits
    without a core UI signal;
  - a minimum score below which the classifier falls back to the default
    category instead of guessing on noise, plus a confidence value.
"""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "shared" / "classify-signals.json"
_WORD = re.compile(r"[a-z0-9]+")


@lru_cache(maxsize=1)
def _config() -> dict[str, Any]:
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


def categories() -> list[str]:
    return list(_config()["categories"])


def low_confidence_threshold() -> float:
    return float(_config()["low_confidence"])


def _with_phrases(words: list[str]) -> list[str]:
    out = list(words)
    out += [f"{words[i]}-{words[i + 1]}" for i in range(len(words) - 1)]
    out += [f"{words[i]}-{words[i + 1]}-{words[i + 2]}" for i in range(len(words) - 2)]
    return out


def _term_sources(name: str | None, description: str | None, topics: list[str] | None) -> dict[str, float]:
    cfg = _config()
    mults = cfg["source_multipliers"]
    sources: dict[str, float] = {}

    def add(terms: list[str], mult: float) -> None:
        for t in terms:
            if sources.get(t, 0.0) < mult:
                sources[t] = mult

    add(_with_phrases(_WORD.findall((description or "").lower())), mults["description"])
    add(_with_phrases(_WORD.findall((name or "").lower())), mults["name"])
    for topic in topics or []:
        add(_with_phrases(_WORD.findall(str(topic).lower())), mults["topic"])
    return sources


def classify_detailed(name: str | None = None, description: str | None = None,
                      topics: list[str] | None = None) -> dict[str, Any]:
    """Returns {"category", "confidence", "scores"} — mirror of classifyDetailed()."""
    cfg = _config()
    signals: dict[str, list] = cfg["signals"]
    support_only = set(cfg["support_only"])
    decay = float(cfg["decay"])
    cats = cfg["categories"]

    by_cat: dict[str, list[dict]] = {c: [] for c in cats}
    for term, mult in _term_sources(name, description, topics).items():
        sig = signals.get(term)
        if sig:
            by_cat[sig[0]].append({"term": term, "contribution": float(sig[1]) * mult, "words": term.split("-")})

    scores: dict[str, float] = {c: 0.0 for c in cats}
    for cat, matches in by_cat.items():
        if not matches:
            continue
        # Phrase suppression: a unigram doesn't also score when it's a component
        # word of a matched phrase in the same category ("ui" ⊄ "shadcn-ui").
        phrase_words = {w for m in matches if len(m["words"]) > 1 for w in m["words"]}
        kept = [m for m in matches if len(m["words"]) > 1 or m["term"] not in phrase_words]
        # Support-only terms need a core match to count at all.
        if not any(m["term"] not in support_only for m in kept):
            continue
        # Diminishing returns: strongest signal counts fully, the rest decay.
        kept.sort(key=lambda m: m["contribution"], reverse=True)
        scores[cat] = sum(m["contribution"] * decay ** i for i, m in enumerate(kept))

    ranked = sorted(cats, key=lambda c: scores[c], reverse=True)
    top_cat, top = ranked[0], scores[ranked[0]]
    second = scores[ranked[1]]

    if top < cfg["min_score"]:
        return {"category": cfg["default_category"], "confidence": 0.1 if top == 0 else 0.25, "scores": scores}

    strength = min(1.0, top / 8.0)
    separation = (top - second) / top if top > 0 else 0.0
    # floor(x*100+0.5)/100 matches JS Math.round semantics (Python round() half-evens).
    confidence = min(0.98, math.floor((0.35 + 0.4 * strength + 0.25 * separation) * 100 + 0.5) / 100)
    return {"category": top_cat, "confidence": confidence, "scores": scores}


def classify(repo: dict) -> str:
    """Drop-in for the old normalize.classify(repo) — returns the category label."""
    return classify_detailed(
        name=repo.get("name"),
        description=repo.get("description"),
        topics=repo.get("topics") or [],
    )["category"]
