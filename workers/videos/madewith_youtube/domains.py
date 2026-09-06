"""Load the domain catalog and derive YouTube search queries."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "src" / "config" / "domain-catalog.json"

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
