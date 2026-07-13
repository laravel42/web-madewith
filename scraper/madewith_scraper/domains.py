"""Load domain catalog and star partitions."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "src" / "config" / "domain-catalog.json"
CATEGORIES_PATH = ROOT / "src" / "config" / "categories.json"

STAR_PARTITIONS: list[tuple[int, int | None]] = [
    (10_000, None),
    (5_000, 9_999),
    (2_000, 4_999),
    (1_000, 1_999),
    (500, 999),
    (200, 499),
    (100, 199),
    (50, 99),
    (20, 49),
    (10, 19),
    (5, 9),
    (0, 4),
]

CATALOG_TO_TECH_SLUG = {"next": "nextjs"}

# Search queries tuned for English tutorial discovery (not repo names)
YOUTUBE_QUERY_OVERRIDES: dict[str, str] = {
    "next": "Next.js tutorial",
    "nuxt": "Nuxt.js tutorial",
    "aspnet-core": "ASP.NET Core tutorial",
    "spring-boot": "Spring Boot tutorial",
    "rails": "Ruby on Rails tutorial",
    "sveltekit": "SvelteKit tutorial",
    "solidjs": "SolidJS tutorial",
    "alpine": "Alpine.js tutorial",
    "actix-web": "Actix Web Rust tutorial",
    "open-webui": "Open WebUI tutorial",
    "anythingllm": "AnythingLLM tutorial",
    "phoenix": "Phoenix framework Elixir tutorial",
    "haystack": "deepset Haystack AI tutorial",
    "gin": "Gin Golang web framework tutorial",
    "fiber": "Go Fiber framework tutorial",
    "ghost": "Ghost CMS tutorial",
    "rocket": "Rocket Rust web framework tutorial",
    "hono": "Hono JavaScript framework tutorial",
    "lit": "Lit web components tutorial",
    "monica": "Monica CRM tutorial",
    "medusa": "MedusaJS headless commerce tutorial",
    "astro": "Astro framework tutorial",
    "flowise": "Flowise AI tutorial",
    "koa": "Koa.js Node tutorial",
    "ionic": "Ionic framework Capacitor tutorial",
}


def load_domains() -> list[dict]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def load_categories() -> list[tuple[str, list[str]]]:
    data = json.loads(CATEGORIES_PATH.read_text(encoding="utf-8"))
    return [(c["label"], c["keywords"]) for c in data["categories"]]


def partitions_for_domain(domain: dict) -> list[tuple[int, int | None]]:
    min_stars = domain.get("scrape", {}).get("minStars", 0)
    return [(lo, hi) for lo, hi in STAR_PARTITIONS if (hi if hi is not None else lo) >= min_stars]


def partition_query(domain: dict, partition: tuple[int, int | None]) -> str:
    lo, hi = partition
    stars = f"stars:>={lo}" if hi is None else f"stars:{lo}..{hi}"
    scrape = domain["scrape"]
    return f"{scrape['query']} {stars} sort:stars-desc"


def shard_id(lo: int, hi: int | None) -> str:
    return f"{lo}-max" if hi is None else f"{lo}-{hi}"


def technology_slug(catalog_slug: str) -> str:
    return CATALOG_TO_TECH_SLUG.get(catalog_slug, catalog_slug)


def sort_domains_by_projects(domains: list[dict], repo_counts: dict[str, int]) -> list[dict]:
    """Fewest scraped repos first so thin catalogs get filled early."""
    return sorted(domains, key=lambda d: (repo_counts.get(d["slug"], 0), d["slug"]))


def youtube_search_query(domain: dict) -> str:
    slug = domain["slug"]
    if slug in YOUTUBE_QUERY_OVERRIDES:
        return YOUTUBE_QUERY_OVERRIDES[slug]
    return f"{domain['techName']} tutorial"
