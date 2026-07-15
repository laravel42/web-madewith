"""Normalize GitHub repos into site catalog project cards."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .domains import load_categories

CLASSIFIERS = load_categories()

PRETTY = {
    "nextjs": "Next.js",
    "nuxtjs": "Nuxt",
    "nodejs": "Node",
    "vuejs": "Vue",
    "reactjs": "React",
    "tailwindcss": "Tailwind CSS",
    "graphql": "GraphQL",
    "postgresql": "PostgreSQL",
    "mongodb": "MongoDB",
}


def synth_langs(primary: str | None) -> list[dict]:
    lang = primary or "JavaScript"
    if lang in ("CSS", "HTML"):
        return [{"name": lang, "pct": 62}, {"name": "JavaScript", "pct": 30}, {"name": "Other", "pct": 8}]
    other = "CSS" if lang == "TypeScript" else "JavaScript"
    return [{"name": lang, "pct": 72}, {"name": other, "pct": 20}, {"name": "Other", "pct": 8}]


def classify(repo: dict) -> str:
    hay = " ".join([
        " ".join(repo.get("topics") or []),
        repo.get("description") or "",
        repo.get("name") or "",
    ]).lower()
    for label, keywords in CLASSIFIERS:
        if any(k in hay for k in keywords):
            return label
    return "DevTools"


def relative_time(iso: str | None) -> str:
    if not iso:
        return "recently"
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    days = max(0, round((datetime.now(timezone.utc) - dt).total_seconds() / 86400))
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days} days ago"
    if days < 30:
        w = round(days / 7)
        return f"{w} week{'s' if w != 1 else ''} ago"
    if days < 365:
        m = round(days / 30)
        return f"{m} month{'s' if m != 1 else ''} ago"
    y = round(days / 365)
    return f"{y} year{'s' if y != 1 else ''} ago"


def stack_from(repo: dict) -> list[str]:
    skip = {"hacktoberfest", "javascript", "typescript"}
    chips = [
        PRETTY.get(t, t.replace("-", " ").title())
        for t in (repo.get("topics") or [])
        if t not in skip
    ][:4]
    lang = repo.get("language")
    if lang and not any(c.lower() == lang.lower() for c in chips):
        chips.insert(0, lang)
    return chips[:5]


def is_noise(repo: dict, domain: dict) -> bool:
    scrape = domain["scrape"]
    exclude = {x.lower() for x in scrape.get("exclude", [])}
    name = (repo.get("name") or "").lower()
    full = (repo.get("full_name") or "").lower()
    return (
        full in exclude
        or name == domain["slug"]
        or name.startswith("awesome-")
        or name.startswith("awesome_")
        or "awesome-list" in (repo.get("topics") or [])
    )


# Built-in categorizers. A tech opts in by adding a "categorize": { "kind": ... }
# block to its entry in src/config/domain-catalog.json. If a tech has no
# categorize block, every repo is accepted (legacy behavior).
def _categorize_laravel(repo: dict, rule: dict) -> bool:
    """Laravel-specific categorization. See domain-catalog.json#laravel for rule."""
    lang = repo.get("primary_language") or repo.get("language")
    full_name_lower = (repo.get("full_name") or "").lower()
    desc = (repo.get("description") or "").lower()
    topics = {t.lower() for t in (repo.get("topics") or [])}
    owner = (repo.get("owner_login") or (repo.get("owner") or {}).get("login") or "").lower()

    # (a) Required language gate: PHP/Blade is the framework, always a project
    if lang in rule.get("required_languages", []):
        return True
    # (b) First-party Laravel org
    if owner == "laravel":
        return True
    # (c) Explicitly tagged as a Laravel package
    plugin_topics = {t.lower() for t in rule.get("plugin_topics", [])}
    if topics & plugin_topics:
        return True
    # (d) Negative-owner hard reject
    if owner in {o.lower() for o in rule.get("negative_owners", [])}:
        return False
    # (e) Content-only repo name (awesome lists, tips, interview Q&A, ...)
    name_only = full_name_lower.split("/")[-1] if "/" in full_name_lower else full_name_lower
    if any(p in name_only for p in rule.get("content_name_patterns", [])):
        return False

    purpose_langs = {p.lower() for p in rule.get("purpose_languages", [])}
    purpose_words = {w.lower() for w in rule.get("purpose_words", [])}
    name_has_laravel = "laravel" in full_name_lower
    desc_mentions_purpose = any(w in desc for w in purpose_words)
    purpose_signal = (lang in purpose_langs) or (bool(topics & {"php", "blade"})) or any(w in desc for w in {"php", "blade", "eloquent", "artisan"})

    if name_has_laravel and purpose_signal:
        return True
    if desc_mentions_purpose and purpose_signal:
        return True

    # Trust ecosystem owners: if they're tagged with Laravel anywhere, accept
    ecosystem = {o.lower() for o in rule.get("ecosystem_owners", [])}
    if owner in ecosystem and ("laravel" in desc or "laravel" in topics or "laravel" in full_name_lower):
        return True
    return False


CATEGORIZERS = {
    "laravel": _categorize_laravel,
}


def categorize_repo(repo: dict, domain: dict) -> bool:
    """Apply the per-tech categorizer if configured. Default: accept all."""
    rule = domain.get("categorize")
    if not rule:
        return True
    kind = rule.get("kind")
    fn = CATEGORIZERS.get(kind)
    if fn is None:
        return True
    return fn(repo, rule)


def filter_repos(domain: dict, repos: list[dict], relax_noise: bool = False) -> list[dict]:
    min_stars = domain["scrape"].get("minStars", 0)
    base = [
        r for r in repos
        if not r.get("fork") and not r.get("archived") and (r.get("stargazers_count") or 0) >= min_stars
    ]
    # Per-tech categorization: drop repos that are not actually built with the tech
    # even though they carry the topic tag (e.g. shadcn-ui/ui tagged 'laravel').
    categorized = [r for r in base if categorize_repo(r, domain)]
    curated = [r for r in categorized if not is_noise(r, domain)]
    if relax_noise or len(curated) >= 6:
        return curated
    return categorized


def dedupe_repos(repos: list[dict]) -> list[dict]:
    by_name: dict[str, dict] = {}
    for repo in repos:
        key = (repo.get("full_name") or "").lower()
        prev = by_name.get(key)
        if not prev or (repo.get("stargazers_count") or 0) > (prev.get("stargazers_count") or 0):
            by_name[key] = repo
    return list(by_name.values())


def normalise(repo: dict) -> dict:
    desc = (repo.get("description") or "A project worth exploring.").strip()
    stars = (repo.get("stargazers_count") or 0)
    owner = (repo.get("owner") or {}).get("login", "unknown")
    topics = (repo.get("topics") or [])[:3]
    base = desc.rstrip(".")
    long1 = f"{base}. Maintained by {owner} on GitHub, where it has earned {stars:,} stars from the community."
    long2 = (
        f"It's actively developed around {', '.join(topics)}, and is a solid reference for anyone building with these tools."
        if topics
        else "It's actively developed and a solid reference for anyone building on this stack."
    )
    spdx = (repo.get("license") or {}).get("spdx_id")
    homepage = repo.get("homepage")
    slug = re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", (repo.get("name") or "").lower())) or repo.get("name")
    return {
        "slug": slug,
        "name": repo.get("name"),
        "fullName": repo.get("full_name"),
        "category": classify(repo),
        "stars": stars,
        "author": owner,
        "avatar": (repo.get("owner") or {}).get("avatar_url"),
        "desc": desc,
        "demo": homepage if homepage and re.match(r"^https?://", homepage) else None,
        "repoUrl": repo.get("html_url"),
        "long1": long1,
        "long2": long2,
        "stack": stack_from(repo),
        "updated": relative_time(repo.get("pushed_at")),
        "license": spdx if spdx and spdx != "NOASSERTION" else "—",
        "langs": repo.get("_langs") or synth_langs(repo.get("language")),
        "versions": repo.get("_versions") or [],
        "topics": repo.get("topics") or [],
    }


def rank_and_keep(domain: dict, repos: list[dict], keep: int | None = None) -> list[dict]:
    filtered = filter_repos(domain, dedupe_repos(repos))
    filtered.sort(key=lambda r: r.get("stargazers_count") or 0, reverse=True)
    if keep is not None:
        filtered = filtered[:keep]
    return [normalise(r) for r in filtered]
