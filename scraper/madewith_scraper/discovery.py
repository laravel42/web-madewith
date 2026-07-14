"""Generate discovery queries for a domain from the catalog + signal library.

The spider calls `discovery_queries(domain)` instead of `domain_queries(domain)`
to get a wider query set. The result always includes any `scrape.queries`
explicitly set in the catalog (so curators can override), and appends
auto-generated queries from the tech signal library.

Output query format (each is a standalone GitHub search string):
  - topic:<canonical>
  - topic:<alias>             (for each alias from signals.aliases)
  - <tech> in:name,description,readme language:<lang>
  - filename:<sig>            (for each fileSignals entry)
  - package.json:"<pkg>"      (for each packageSignals entry)
  - org:<vendor> language:<lang>  (for each vendorOrgs entry)
  - topic:<community-ecosystem>    (e.g. topic:laravel-package)

Order matters: canonical first (highest signal), then aliases, then
broader expansions. The spider shards each query independently.
"""
from __future__ import annotations

import re

from .signals import (
    aliases_for,
    file_signals_for,
    package_signals_for,
    vendor_orgs_for,
)


def _explicit_queries(domain: dict) -> list[str]:
    """Return the curator's `scrape.queries` list, or [] if absent.

    These are honoured verbatim — they win over auto-generation.
    """
    scrape = domain.get("scrape") or {}
    qs = scrape.get("queries")
    if qs:
        return [q for q in qs if q and q.strip()]
    legacy = scrape.get("query")
    return [legacy] if legacy else []


def _alias_topic_queries(domain: dict) -> list[str]:
    aliases = [a for a in aliases_for(domain["slug"]) if a]
    return [f"topic:{a}" for a in aliases]


def _filename_queries(domain: dict) -> list[str]:
    sigs = [s for s in file_signals_for(domain["slug"]) if s]
    return [f"filename:{s}" for s in sigs]


def _package_queries(domain: dict) -> list[str]:
    sigs = [s for s in package_signals_for(domain["slug"]) if s]
    out: list[str] = []
    for pkg in sigs:
        # npm-style package names: package.json: works
        # python/pip: filename:requirements.txt + content search isn't
        # directly supported, but `package.json:"name"` is the most
        # universal signal we have. For non-npm packages, we drop a
        # topic-style query using the package's last path segment.
        if "/" in pkg and not pkg.startswith("@"):
            # gem/composer path: use topic form of the package
            leaf = pkg.rsplit("/", 1)[-1]
            out.append(f"topic:{leaf}")
        else:
            out.append(f'package.json:"{pkg}"')
    return out


def _vendor_org_queries(domain: dict) -> list[str]:
    scrape = domain.get("scrape") or {}
    langs = scrape.get("languages") or []
    lang = langs[0] if langs else None
    orgs = [o for o in vendor_orgs_for(domain["slug"]) if o]
    out: list[str] = []
    for org in orgs:
        if lang:
            out.append(f"org:{org} language:{lang}")
        else:
            out.append(f"org:{org}")
    return out


def _fallback_query(domain: dict) -> str:
    """Used when the catalog has neither queries nor signals."""
    slug = domain.get("slug") or ""
    scrape = domain.get("scrape") or {}
    langs = scrape.get("languages") or []
    if langs:
        return f"{slug} in:name,description,readme language:{langs[0]}"
    return f"topic:{slug}"


def discovery_queries(domain: dict) -> list[str]:
    """Return the merged, de-duplicated list of discovery queries for a domain.

    The first query is always the most-specific (canonical topic, or
    whatever the curator set in `scrape.queries[0]`). Order is preserved
    for shard-id stability across runs.
    """
    explicit = _explicit_queries(domain)
    if explicit:
        # Curator's queries win. We still append auto-generated ones
        # (file/package signals) if they aren't already present.
        auto = (
            _filename_queries(domain)
            + _package_queries(domain)
            + _vendor_org_queries(domain)
        )
        out = list(explicit)
        seen_lower = {q.lower() for q in explicit}
        for q in auto:
            if q.lower() not in seen_lower:
                out.append(q)
                seen_lower.add(q.lower())
        return out

    slug = domain.get("slug") or ""
    queries: list[str] = []
    seen: set[str] = set()

    def add(q: str) -> None:
        ql = q.lower()
        if ql in seen:
            return
        seen.add(ql)
        queries.append(q)

    # 1. canonical topic — derived from the slug
    add(f"topic:{slug}")

    # 2. alias topics (cheap, high-signal)
    for q in _alias_topic_queries(domain):
        add(q)

    # 3. tech name in name/description/readme, constrained to language
    scrape = domain.get("scrape") or {}
    langs = scrape.get("languages") or []
    tech = domain.get("techName") or slug
    if langs:
        add(f"{tech} in:name,description,readme language:{langs[0]}")

    # 4. filename signals (highest specificity for the long tail)
    for q in _filename_queries(domain):
        add(q)

    # 5. package signals
    for q in _package_queries(domain):
        add(q)

    # 6. vendor orgs
    for q in _vendor_org_queries(domain):
        add(q)

    # 7. fallback if nothing got generated
    if not queries:
        queries.append(_fallback_query(domain))

    return queries


# Sanity: strip the leading "topic:" when reasoning about a query.
_TOPIC_RE = re.compile(r"^topic:(\S+)", re.I)


def topics_in_queries(queries: list[str]) -> set[str]:
    """Lowercased set of every `topic:X` token appearing in the queries."""
    out: set[str] = set()
    for q in queries:
        m = _TOPIC_RE.match(q)
        if m:
            out.add(m.group(1).lower())
    return out
