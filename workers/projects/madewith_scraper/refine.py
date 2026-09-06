"""Refinement scoring for GitHub catalog candidates.

Pure functions, no I/O. The scraper fetches widely; this module scores
each raw repo against a per-domain rubric so the publish step can filter
on quality, not just stars. Every decision is captured (score, reasons)
so a missed repo can be audited or rescued by tuning the threshold.

Scoring rubric (per domain):
  Positive
    +3  has canonical topic (from any of the domain's discovery queries)
    +2  has alias topic (from scrape.requireTopics or signals.aliases)
    +4  filename signal hit (e.g. filename:nuxt.config.ts in signals)
    +4  package signal hit (e.g. package.json:"@remix-run/react")
    +3  vendor-org ownership (e.g. owner == "laravel")
    +2  primary language matches scrape.languages
    +2  tech name appears in name/description/readme
    +1  pushed within last 365 days
  Baseline
    +1  not a fork, not archived
  Negative
    -10  is a fork
    -3   is archived
    -5   awesome-* / awesome_list topic or "awesome" in name
    -3   tutorial / playground / boilerplate / starter in name (when not
         a known signal) — tutorials are not showcase material
    -3   description empty AND no topics
    -3   docs-site / .github.io homepage with no other signal
    -1   license NOASSERTION or missing

Decision rule: `score >= min_score` (global REFINE_MIN_SCORE, default 4)
keeps the repo. Repos that pass the existing `is_relevant()` gate but
fail refinement are tagged with a "rejected" refinement blob so the
user can audit.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from .domains import domain_queries


# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# Token-level cues: a repo with one of these in its name is almost never a
# product. Word-boundary so "factory" doesn't match "factor" etc.
_NOISE_NAME_RE = re.compile(
    r"(?<![a-z0-9])(?:"
    r"tutorial|playground|boilerplate|starter|template|learning|"
    r"awesome[\-_]?list|awesome|samples?|examples?|demo[\-\s]app|"
    r"course|workshop|cheatsheet|roadmap|interview[\-_]?questions?"
    r")(?![a-z0-9])",
    re.I,
)

_AWESOME_NAME_RE = re.compile(r"^awesome[\-_]", re.I)

_DOCS_HOST_RE = re.compile(
    r"^https?://[a-z0-9\-]+\.github\.io/?$",
    re.I,
)


# ---------------------------------------------------------------------------
# Signal sources
# ---------------------------------------------------------------------------

def _domain_topics(domain: dict) -> set[str]:
    """All `topic:` terms appearing in any of the domain's discovery queries,
    lowercased. Mirrors normalize.domain_topics without depending on the
    normalize module to keep refine self-contained."""
    topics: set[str] = set()
    for query in domain_queries(domain):
        for tok in re.findall(r"topic:([\w.\-]+)", query, flags=re.I):
            topics.add(tok.lower())
    topics.update(t.lower() for t in (domain.get("scrape", {}) or {}).get("requireTopics", []) or [])
    return topics


def _alias_topics(domain: dict) -> set[str]:
    return {t.lower() for t in (domain.get("scrape", {}) or {}).get("requireTopics", []) or []}


def _filename_signals(domain: dict) -> set[str]:
    return {s.lower() for s in (domain.get("scrape", {}) or {}).get("fileSignals", []) or []}


def _package_signals(domain: dict) -> set[str]:
    return {s.lower() for s in (domain.get("scrape", {}) or {}).get("packageSignals", []) or []}


def _vendor_orgs(domain: dict) -> set[str]:
    return {o.lower() for o in (domain.get("scrape", {}) or {}).get("vendorOrgs", []) or []}


def _allowed_languages(domain: dict) -> set[str]:
    return {l.lower() for l in (domain.get("scrape", {}) or {}).get("languages", []) or []}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _word_re(needle: str) -> re.Pattern:
    return re.compile(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", re.I)


def _has_filename_signal(repo: dict, signals: set[str]) -> bool:
    """True if any of the repo's reported files match a signature filename.

    The spider's GraphQL response doesn't include filename search hits
    directly, so we accept a few proxies the publish step *can* see:
      - the repo's `repositoryTopics` (some topics are file-derived),
      - any string in `topics` or `description` that ends with a known
        config file (e.g. "nuxt.config.ts"),
      - the `packageSignals` / `fileSignals` presence in description text.

    For correctness against the API, the *search* itself uses
    `filename:<signal>` in GraphQL, which returns only matching repos.
    This helper is the second line of defence for refs that were already
    discovered and may be lying about their topics.
    """
    if not signals:
        return False
    hay = " ".join(
        [
            (repo.get("name") or ""),
            (repo.get("description") or ""),
            " ".join(repo.get("topics") or []),
        ]
    ).lower()
    for sig in signals:
        if sig and sig.lower() in hay:
            return True
    return False


def _has_package_signal(repo: dict, signals: set[str]) -> bool:
    if not signals:
        return False
    hay = " ".join(
        [
            (repo.get("name") or ""),
            (repo.get("description") or ""),
            " ".join(repo.get("topics") or []),
        ]
    ).lower()
    for sig in signals:
        if sig and sig.lower() in hay:
            return True
    return False


def _is_vendor_owned(repo: dict, vendor_orgs: set[str]) -> bool:
    if not vendor_orgs:
        return False
    owner = ((repo.get("owner") or {}).get("login") or "").lower()
    return bool(owner) and owner in vendor_orgs


def _has_canonical_topic(repo: dict, canonical: set[str]) -> bool:
    if not canonical:
        return False
    return bool({t.lower() for t in (repo.get("topics") or [])} & canonical)


def _has_alias_topic(repo: dict, aliases: set[str]) -> bool:
    if not aliases:
        return False
    return bool({t.lower() for t in (repo.get("topics") or [])} & aliases)


def _name_mentions_tech(repo: dict, tech: str) -> bool:
    if not tech:
        return False
    hay = f"{repo.get('name') or ''} {repo.get('description') or ''}"
    return bool(_word_re(tech).search(hay))


def _primary_language_matches(repo: dict, allowed: set[str]) -> bool:
    if not allowed:
        return False
    primary = (repo.get("language") or "").lower()
    if primary and primary in allowed:
        return True
    for lang in repo.get("_langs") or []:
        name = (lang.get("name") or "").lower()
        if name in allowed:
            return True
    return False


def _days_since_push(repo: dict) -> int | None:
    pushed = repo.get("pushed_at")
    if not pushed:
        return None
    try:
        dt = datetime.fromisoformat(pushed.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, round((datetime.now(timezone.utc) - dt).total_seconds() / 86400))


def _is_awesome(repo: dict) -> bool:
    name = (repo.get("name") or "").lower()
    topics = [t.lower() for t in (repo.get("topics") or [])]
    if _AWESOME_NAME_RE.match(name):
        return True
    if "awesome-list" in topics or "awesome" in topics:
        return True
    if "awesome-list" in name.replace("_", "-").split("-"):
        return True
    return False


def _has_noise_name(repo: dict) -> bool:
    return bool(_NOISE_NAME_RE.search(repo.get("name") or ""))


def _is_docs_site(repo: dict) -> bool:
    homepage = (repo.get("homepage") or "").strip()
    if not homepage:
        return False
    return bool(_DOCS_HOST_RE.match(homepage))


def _is_missing_license(repo: dict) -> bool:
    spdx = ((repo.get("license") or {}).get("spdx_id") or "").upper()
    return spdx in ("", "NOASSERTION", "NONE")


def _has_any_signal(repo: dict) -> bool:
    """Used to decide whether docs-site / empty-desc penalties apply — if the
    repo is rich enough on other axes, don't penalise for one missing field."""
    return bool(
        (repo.get("description") or "").strip()
        or (repo.get("topics") or [])
        or (repo.get("homepage") or "").strip()
    )


# ---------------------------------------------------------------------------
# Public scoring API
# ---------------------------------------------------------------------------

def score_repo(domain: dict, repo: dict) -> tuple[int, list[str]]:
    """Return (score, reasons) for a single repo against a domain.

    Reasons are short stable tokens (used in unit tests) suitable for
    storing in metadata.refinement.reasons.
    """
    canonical = _domain_topics(domain)
    aliases = _alias_topics(domain)
    file_sigs = _filename_signals(domain)
    pkg_sigs = _package_signals(domain)
    vendors = _vendor_orgs(domain)
    langs = _allowed_languages(domain)
    tech = domain.get("techName") or domain.get("slug") or ""

    score = 0
    reasons: list[str] = []

    if repo.get("fork"):
        score -= 10
        reasons.append("fork")
    if repo.get("archived"):
        score -= 3
        reasons.append("archived")

    if not repo.get("fork") and not repo.get("archived"):
        score += 1
        reasons.append("alive")

    if _has_canonical_topic(repo, canonical):
        score += 3
        reasons.append("canonical_topic")
    if _has_alias_topic(repo, aliases):
        score += 2
        reasons.append("alias_topic")
    if _has_filename_signal(repo, file_sigs):
        score += 4
        reasons.append("filename_signal")
    if _has_package_signal(repo, pkg_sigs):
        score += 4
        reasons.append("package_signal")
    if _is_vendor_owned(repo, vendors):
        score += 3
        reasons.append("vendor_org")
    if _primary_language_matches(repo, langs):
        score += 2
        reasons.append("primary_language")
    if _name_mentions_tech(repo, tech):
        score += 2
        reasons.append("name_match")

    days = _days_since_push(repo)
    if days is not None and days <= 365:
        score += 1
        reasons.append("recent_push")

    if _is_awesome(repo):
        score -= 5
        reasons.append("awesome_list")
    if _has_noise_name(repo):
        score -= 3
        reasons.append("noise_name")
    if not (repo.get("description") or "").strip() and not (repo.get("topics") or []):
        score -= 3
        reasons.append("empty_metadata")
    if _is_docs_site(repo) and score < 4:
        score -= 3
        reasons.append("docs_site")
    if _is_missing_license(repo):
        score -= 1
        reasons.append("no_license")

    return score, reasons


def default_min_score() -> int:
    """Global threshold from REFINE_MIN_SCORE env var, default 4."""
    raw = os.environ.get("REFINE_MIN_SCORE")
    if not raw:
        return 4
    try:
        return int(raw)
    except ValueError:
        return 4


def refine_repos(
    domain: dict,
    repos: list[dict],
    min_score: int | None = None,
) -> tuple[list[dict], dict[str, dict]]:
    """Score + filter `repos` for a domain. Returns (kept, audit_map).

    `kept` is the list of repos whose score >= min_score. `audit_map`
    is keyed by `full_name` lowercased and contains
    `{score, status, reasons}` for every repo, kept or rejected, so the
    publish step can persist the decision into metadata.
    """
    if min_score is None:
        min_score = default_min_score()
    audit: dict[str, dict] = {}
    kept: list[dict] = []
    for r in repos:
        s, reasons = score_repo(domain, r)
        key = (r.get("full_name") or "").lower()
        status = "kept" if s >= min_score else "rejected"
        audit[key] = {"score": s, "status": status, "reasons": reasons}
        if status == "kept":
            kept.append(r)
    return kept, audit
