#!/usr/bin/env python3
"""
MadeWithWhat Main Editorial Engine
==================================

Creates a mixed batch of SEO-oriented, evidence-grounded articles for the
MadeWithWhat main index site.

Key behavior:
- Generates 50 articles per batch by default.
- Mixes comparisons, ecosystem guides, release/news analysis, security alerts,
  stack guides, architecture reviews, and repository spotlights.
- Assigns one publication date to each group of five articles.
- Starts publication dates six months ago by default and advances one day after
  every five articles.
- Adds technology-specific tags, TOC, FAQ, JSON-LD, data tables, callouts,
  Mermaid diagrams, and locally generated cover/data images.
- Loads configuration from ../.env first, then ./.env.
- Rejects exact and near-duplicate content, including against articles already
  committed to src/content/blog and prior factory output (imported into the
  dedup corpus at startup).

This is a publishing draft generator. Security/news articles are constrained to
the GitHub facts collected at generation time and must be reviewed before
publication.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sqlite3
import sys
import textwrap
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import requests
from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent
PARENT_ENV = BASE_DIR.parent / ".env"
LOCAL_ENV = BASE_DIR / ".env"

if PARENT_ENV.exists():
    load_dotenv(PARENT_ENV)
elif LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV)
else:
    load_dotenv()

GITHUB_API = "https://api.github.com"
_db = Path(os.getenv("CONTENT_DB", "content_factory.sqlite3"))
DB_PATH = _db if _db.is_absolute() else BASE_DIR / _db
_out = Path(os.getenv("CONTENT_OUTPUT_DIR", "output"))
OUTPUT_DIR = _out if _out.is_absolute() else BASE_DIR / _out
# Committed site articles (hydrate-blog's destination). Imported into the dedup
# corpus at startup so a fresh checkout / deleted DB can't regenerate them.
_site_blog = Path(os.getenv("SITE_BLOG_DIR", "../src/content/blog"))
SITE_BLOG_DIR = _site_blog if _site_blog.is_absolute() else BASE_DIR / _site_blog
# LLM provider: OpenRouter whenever OPENROUTER_API_KEY is set (FACTORY_BASE_URL
# overrides the endpoint), OpenAI direct otherwise. Model precedence:
# FACTORY_MODEL > backend default (Sonnet 4.5 on OpenRouter for long-form
# editorial quality; legacy OPENAI_MODEL/gpt-5-mini on OpenAI).
LLM_BASE_URL = os.getenv("FACTORY_BASE_URL") or (
    "https://openrouter.ai/api/v1" if os.getenv("OPENROUTER_API_KEY") else None)
LLM_USE_CHAT = bool(LLM_BASE_URL) and "api.openai.com" not in LLM_BASE_URL
if os.getenv("FACTORY_MODEL"):
    LLM_MODEL = os.environ["FACTORY_MODEL"]
elif LLM_BASE_URL and "openrouter" in LLM_BASE_URL:
    LLM_MODEL = "anthropic/claude-sonnet-4.5"
else:
    LLM_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
LLM_MAX_TOKENS = int(os.getenv("FACTORY_MAX_TOKENS", "32000"))
LLM_MAX_RETRIES = int(os.getenv("FACTORY_MAX_RETRIES", "5"))
# Below this, the model clearly ignored the depth brief and a retry is cheaper
# than shipping a stub.
MIN_BODY_CHARS = int(os.getenv("FACTORY_MIN_BODY_CHARS", "6000"))
SLUG_MAX_LEN = 180
GITHUB_API_VERSION = os.getenv("GITHUB_API_VERSION", "2022-11-28")
SITE_NAME = os.getenv("SITE_NAME", "MadeWithWhat")
SITE_URL = os.getenv("SITE_URL", "https://madewithwhat.net").rstrip("/")
AUTHOR_NAME = os.getenv("AUTHOR_NAME", "MadeWithWhat Editorial Team")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "45"))

TECHNOLOGIES: dict[str, dict[str, Any]] = {
    # Frameworks
    "nextjs": {"name": "Next.js", "category": "Frameworks", "topic": "nextjs", "repo": "vercel/next.js", "aliases": ["next-js"]},
    "nuxt": {"name": "Nuxt", "category": "Frameworks", "topic": "nuxt", "repo": "nuxt/nuxt", "aliases": ["nuxtjs"]},
    "astro": {"name": "Astro", "category": "Frameworks", "topic": "astro", "repo": "withastro/astro", "aliases": []},
    "sveltekit": {"name": "SvelteKit", "category": "Frameworks", "topic": "sveltekit", "repo": "sveltejs/kit", "aliases": []},
    "laravel": {"name": "Laravel", "category": "Frameworks", "topic": "laravel", "repo": "laravel/framework", "aliases": []},
    "symfony": {"name": "Symfony", "category": "Frameworks", "topic": "symfony", "repo": "symfony/symfony", "aliases": []},
    "django": {"name": "Django", "category": "Frameworks", "topic": "django", "repo": "django/django", "aliases": []},
    "rails": {"name": "Ruby on Rails", "category": "Frameworks", "topic": "rails", "repo": "rails/rails", "aliases": ["ruby-on-rails"]},
    "springboot": {"name": "Spring Boot", "category": "Frameworks", "topic": "spring-boot", "repo": "spring-projects/spring-boot", "aliases": []},
    "aspnetcore": {"name": "ASP.NET Core", "category": "Frameworks", "topic": "aspnet-core", "repo": "dotnet/aspnetcore", "aliases": ["aspnetcore"]},

    # Frontend
    "react": {"name": "React", "category": "Frontend", "topic": "react", "repo": "facebook/react", "aliases": ["reactjs"]},
    "vue": {"name": "Vue.js", "category": "Frontend", "topic": "vue", "repo": "vuejs/core", "aliases": ["vuejs"]},
    "angular": {"name": "Angular", "category": "Frontend", "topic": "angular", "repo": "angular/angular", "aliases": []},
    "svelte": {"name": "Svelte", "category": "Frontend", "topic": "svelte", "repo": "sveltejs/svelte", "aliases": []},
    "solidjs": {"name": "SolidJS", "category": "Frontend", "topic": "solidjs", "repo": "solidjs/solid", "aliases": ["solid-js"]},
    "alpinejs": {"name": "Alpine.js", "category": "Frontend", "topic": "alpinejs", "repo": "alpinejs/alpine", "aliases": []},
    "jquery": {"name": "jQuery", "category": "Frontend", "topic": "jquery", "repo": "jquery/jquery", "aliases": []},
    "ionic": {"name": "Ionic", "category": "Frontend", "topic": "ionic", "repo": "ionic-team/ionic-framework", "aliases": []},

    # Backend
    "express": {"name": "Express", "category": "Backend", "topic": "express", "repo": "expressjs/express", "aliases": ["expressjs"]},
    "nestjs": {"name": "NestJS", "category": "Backend", "topic": "nestjs", "repo": "nestjs/nest", "aliases": []},
    "fastapi": {"name": "FastAPI", "category": "Backend", "topic": "fastapi", "repo": "fastapi/fastapi", "aliases": []},
    "flask": {"name": "Flask", "category": "Backend", "topic": "flask", "repo": "pallets/flask", "aliases": []},
    "gin": {"name": "Gin", "category": "Backend", "topic": "gin", "repo": "gin-gonic/gin", "aliases": ["gin-gonic"]},
    "fiber": {"name": "Fiber", "category": "Backend", "topic": "gofiber", "repo": "gofiber/fiber", "aliases": ["fiber"]},
    "fastify": {"name": "Fastify", "category": "Backend", "topic": "fastify", "repo": "fastify/fastify", "aliases": []},
    "hono": {"name": "Hono", "category": "Backend", "topic": "hono", "repo": "honojs/hono", "aliases": []},

    # CMS
    "wordpress": {"name": "WordPress", "category": "CMS", "topic": "wordpress", "repo": "WordPress/WordPress", "aliases": []},
    "drupal": {"name": "Drupal", "category": "CMS", "topic": "drupal", "repo": "drupal/drupal", "aliases": []},
    "joomla": {"name": "Joomla", "category": "CMS", "topic": "joomla", "repo": "joomla/joomla-cms", "aliases": []},
    "strapi": {"name": "Strapi", "category": "CMS", "topic": "strapi", "repo": "strapi/strapi", "aliases": []},
    "directus": {"name": "Directus", "category": "CMS", "topic": "directus", "repo": "directus/directus", "aliases": []},
    "ghost": {"name": "Ghost", "category": "CMS", "topic": "ghost", "repo": "TryGhost/Ghost", "aliases": []},
    "statamic": {"name": "Statamic", "category": "CMS", "topic": "statamic", "repo": "statamic/cms", "aliases": []},
    "octobercms": {"name": "October CMS", "category": "CMS", "topic": "octobercms", "repo": "octobercms/october", "aliases": []},
    "payload": {"name": "Payload CMS", "category": "CMS", "topic": "payloadcms", "repo": "payloadcms/payload", "aliases": ["payload-cms"]},
    "twill": {"name": "Twill", "category": "CMS", "topic": "twill", "repo": "area17/twill", "aliases": []},

    # Commerce
    "magento": {"name": "Magento", "category": "Commerce", "topic": "magento2", "repo": "magento/magento2", "aliases": ["magento"]},
    "prestashop": {"name": "PrestaShop", "category": "Commerce", "topic": "prestashop", "repo": "PrestaShop/PrestaShop", "aliases": []},
    "woocommerce": {"name": "WooCommerce", "category": "Commerce", "topic": "woocommerce", "repo": "woocommerce/woocommerce", "aliases": []},
    "shopware": {"name": "Shopware", "category": "Commerce", "topic": "shopware", "repo": "shopware/shopware", "aliases": []},
    "bagisto": {"name": "Bagisto", "category": "Commerce", "topic": "bagisto", "repo": "bagisto/bagisto", "aliases": []},
    "saleor": {"name": "Saleor", "category": "Commerce", "topic": "saleor", "repo": "saleor/saleor", "aliases": []},
    "medusa": {"name": "Medusa", "category": "Commerce", "topic": "medusajs", "repo": "medusajs/medusa", "aliases": ["medusa"]},
    "opencart": {"name": "OpenCart", "category": "Commerce", "topic": "opencart", "repo": "opencart/opencart", "aliases": []},

    # CRM / ERP
    "odoo": {"name": "Odoo", "category": "CRM / ERP", "topic": "odoo", "repo": "odoo/odoo", "aliases": []},
    "erpnext": {"name": "ERPNext", "category": "CRM / ERP", "topic": "erpnext", "repo": "frappe/erpnext", "aliases": []},
    "suitecrm": {"name": "SuiteCRM", "category": "CRM / ERP", "topic": "suitecrm", "repo": "salesagility/SuiteCRM", "aliases": []},
    "espocrm": {"name": "EspoCRM", "category": "CRM / ERP", "topic": "espocrm", "repo": "espocrm/espocrm", "aliases": []},
    "dolibarr": {"name": "Dolibarr", "category": "CRM / ERP", "topic": "dolibarr", "repo": "Dolibarr/dolibarr", "aliases": []},
    "twenty": {"name": "Twenty", "category": "CRM / ERP", "topic": "twenty-crm", "repo": "twentyhq/twenty", "aliases": ["twenty"]},

    # AI / LLM
    "ollama": {"name": "Ollama", "category": "AI / LLM", "topic": "ollama", "repo": "ollama/ollama", "aliases": []},
    "langchain": {"name": "LangChain", "category": "AI / LLM", "topic": "langchain", "repo": "langchain-ai/langchain", "aliases": []},
    "llamaindex": {"name": "LlamaIndex", "category": "AI / LLM", "topic": "llamaindex", "repo": "run-llama/llama_index", "aliases": ["llama-index"]},
    "flowise": {"name": "Flowise", "category": "AI / LLM", "topic": "flowise", "repo": "FlowiseAI/Flowise", "aliases": []},
    "dify": {"name": "Dify", "category": "AI / LLM", "topic": "dify", "repo": "langgenius/dify", "aliases": []},
    "openwebui": {"name": "Open WebUI", "category": "AI / LLM", "topic": "open-webui", "repo": "open-webui/open-webui", "aliases": []},
    "librechat": {"name": "LibreChat", "category": "AI / LLM", "topic": "librechat", "repo": "danny-avila/LibreChat", "aliases": []},
    "anythingllm": {"name": "AnythingLLM", "category": "AI / LLM", "topic": "anythingllm", "repo": "Mintplex-Labs/anything-llm", "aliases": ["anything-llm"]},
    "haystack": {"name": "Haystack", "category": "AI / LLM", "topic": "haystack", "repo": "deepset-ai/haystack", "aliases": []},
    "vllm": {"name": "vLLM", "category": "AI / LLM", "topic": "vllm", "repo": "vllm-project/vllm", "aliases": []},
}

# Editorial cadence: how many articles share one publication date.
ARTICLES_PER_DATE = 5

ARTICLE_PLAN = [
    "comparison",
    "ecosystem-guide",
    "release-news",
    "security-alert",
    "stack-guide",
    "architecture-analysis",
    "repository-spotlight",
    "adoption-analysis",
    "migration-guide",
    "performance-checklist",
]

ARTICLE_TYPE_LABELS = {
    "comparison": "Comparison",
    "ecosystem-guide": "Ecosystem Guide",
    "release-news": "Release News",
    "security-alert": "Security Alert",
    "stack-guide": "Stack Guide",
    "architecture-analysis": "Architecture Analysis",
    "repository-spotlight": "Repository Spotlight",
    "adoption-analysis": "Adoption Analysis",
    "migration-guide": "Migration Guide",
    "performance-checklist": "Performance Checklist",
}


TOKEN_USAGE = {"calls": 0, "prompt": 0, "completion": 0}
_usage_lock = threading.Lock()


def record_usage(response: Any) -> None:
    """Batch cost is otherwise invisible until the provider invoice arrives."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    prompt = getattr(usage, "prompt_tokens", None) or getattr(usage, "input_tokens", None) or 0
    completion = getattr(usage, "completion_tokens", None) or getattr(usage, "output_tokens", None) or 0
    with _usage_lock:
        TOKEN_USAGE["calls"] += 1
        TOKEN_USAGE["prompt"] += int(prompt)
        TOKEN_USAGE["completion"] += int(completion)


@dataclass
class RepoFacts:
    full_name: str
    name: str
    owner: str
    url: str
    description: str
    stars: int
    forks: int
    watchers: int
    open_issues: int
    language: str
    license: str
    topics: list[str]
    created_at: str
    updated_at: str
    pushed_at: str
    default_branch: str
    homepage: str
    archived: bool
    readme: str
    latest_release: dict[str, Any] | None


@dataclass
class Advisory:
    ghsa_id: str
    cve_id: str | None
    summary: str
    description: str
    severity: str
    published_at: str
    updated_at: str
    html_url: str
    ecosystem: str | None
    package: str | None
    vulnerable_range: str | None
    patched_versions: str | None


@dataclass
class ArticleJob:
    article_type: str
    primary_key: str
    secondary_key: str | None
    publication_date: str
    sequence: int


@dataclass
class Candidate:
    """One prepared generation attempt. Everything that touches GitHub or the
    shared advisory pool is resolved on the main thread, so a worker only has
    to run the LLM calls against immutable inputs."""
    slot: int
    job: ArticleJob
    advisory: Advisory | None
    image_paths: dict[str, str]
    cover_path: Path
    data_path: Path
    sources: list[dict[str, str]]
    prompt: str
    label: str


def die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def utc_now() -> datetime:
    return datetime.now(UTC)


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"['’]", "", value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def anchor_slug(value: str) -> str:
    """Heading anchor id, matching the site renderer's slugify
    (src/lib/blog-markdown.ts). It keeps apostrophes as separators, so
    "the team's checklist" anchors to `the-team-s-checklist` on both sides;
    slugify() drops the apostrophe and yields a link that resolves nowhere."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def article_slug(value: str) -> str:
    """Single slug authority. Filename, database key, and canonical URL all
    derive from this, so an over-long model slug cannot make the published URL
    disagree with the file on disk."""
    return slugify(value)[:SLUG_MAX_LEN].strip("-")


def clean_markdown_for_similarity(text: str) -> str:
    text = re.sub(r"---.*?---", " ", text, count=1, flags=re.S)
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", text)
    text = re.sub(r"\[[^\]]+]\([^)]+\)", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def shingles(text: str, size: int = 7) -> set[str]:
    words = clean_markdown_for_similarity(text).split()
    if len(words) < size:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i:i + size]) for i in range(len(words) - size + 1)}


def shingle_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def jaccard_similarity(a: str, b: str) -> float:
    return shingle_similarity(shingles(a), shingles(b))


class SimilarityIndex:
    """In-memory shingle index over the dedup corpus.

    Scoring used to reload every corpus body from SQLite and re-shingle both
    sides for each comparison, so an N-article batch re-tokenised the whole
    archive N times. Shingling each entry once — and reusing the candidate's
    own shingle set across the scan — makes a batch cost one pass per article.
    """

    def __init__(self, conn: sqlite3.Connection, limit: int = 2500) -> None:
        self._entries: list[tuple[str, set[str]]] = []
        rows = conn.execute(
            "SELECT title, body FROM articles WHERE status IN ('published', 'imported') "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        for title, body in rows:
            self.add(title, body)

    def add(self, title: str, body: str) -> None:
        fingerprint = shingles(body)
        if fingerprint:
            self._entries.append((title, fingerprint))

    def __len__(self) -> int:
        return len(self._entries)

    def closest(self, candidate: str) -> tuple[float, str | None]:
        fingerprint = shingles(candidate)
        best: tuple[float, str | None] = (0.0, None)
        if not fingerprint:
            return best
        for title, other in self._entries:
            score = shingle_similarity(fingerprint, other)
            if score > best[0]:
                best = (score, title)
        return best


def init_db(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'"
    ).fetchone()
    if row and row[0] and "publication_date" not in row[0]:
        conn.execute("DROP TABLE IF EXISTS articles")
        conn.commit()

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_hash TEXT UNIQUE NOT NULL,
            title_hash TEXT UNIQUE NOT NULL,
            article_type TEXT NOT NULL,
            primary_tech TEXT NOT NULL,
            secondary_tech TEXT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            publication_date TEXT NOT NULL,
            body TEXT NOT NULL,
            max_similarity REAL NOT NULL DEFAULT 0,
            source_fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_articles_publication_date
        ON articles(publication_date);

        CREATE INDEX IF NOT EXISTS idx_articles_primary_tech
        ON articles(primary_tech);
        """
    )
    conn.commit()


def github_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "MadeWithWhat-Editorial-Engine/2.0",
    }


def gh_get(
    path_or_url: str,
    token: str,
    *,
    params: dict[str, Any] | None = None,
    allow_404: bool = False,
    accept: str | None = None,
) -> requests.Response | None:
    url = path_or_url if path_or_url.startswith("http") else f"{GITHUB_API}{path_or_url}"
    headers = github_headers(token)
    if accept:
        headers["Accept"] = accept

    for attempt in range(6):
        response = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)

        if response.status_code == 404 and allow_404:
            return None

        if response.status_code in {403, 429}:
            remaining = response.headers.get("X-RateLimit-Remaining")
            if remaining == "0" or "rate limit" in response.text.lower():
                reset = int(response.headers.get("X-RateLimit-Reset", "0"))
                delay = max(5, min(120, reset - int(time.time()) + 2))
            else:
                delay = min(60, 2 ** attempt)
            print(f"GitHub throttled request; retrying in {delay}s")
            time.sleep(delay)
            continue

        if response.status_code >= 500:
            time.sleep(min(30, 2 ** attempt))
            continue

        response.raise_for_status()
        return response

    raise RuntimeError(f"GitHub request failed after retries: {url}")


def fetch_repo(full_name: str, token: str) -> RepoFacts:
    response = gh_get(f"/repos/{full_name}", token)
    assert response is not None
    item = response.json()

    readme_response = gh_get(
        f"/repos/{full_name}/readme",
        token,
        allow_404=True,
        accept="application/vnd.github.raw+json",
    )
    readme = readme_response.text[:50_000] if readme_response is not None else ""

    release_response = gh_get(
        f"/repos/{full_name}/releases/latest",
        token,
        allow_404=True,
    )
    latest_release = None
    if release_response is not None:
        release = release_response.json()
        latest_release = {
            "name": release.get("name"),
            "tag_name": release.get("tag_name"),
            "published_at": release.get("published_at"),
            "html_url": release.get("html_url"),
            "prerelease": release.get("prerelease"),
            "body": (release.get("body") or "")[:12_000],
        }

    license_data = item.get("license") or {}
    return RepoFacts(
        full_name=item["full_name"],
        name=item["name"],
        owner=item["owner"]["login"],
        url=item["html_url"],
        description=item.get("description") or "",
        stars=item.get("stargazers_count", 0),
        forks=item.get("forks_count", 0),
        watchers=item.get("subscribers_count", 0),
        open_issues=item.get("open_issues_count", 0),
        language=item.get("language") or "Unknown",
        license=license_data.get("spdx_id") or "Unknown",
        topics=item.get("topics") or [],
        created_at=item.get("created_at") or "",
        updated_at=item.get("updated_at") or "",
        pushed_at=item.get("pushed_at") or "",
        default_branch=item.get("default_branch") or "main",
        homepage=item.get("homepage") or "",
        archived=bool(item.get("archived")),
        readme=readme,
        latest_release=latest_release,
    )


def fetch_security_advisories(token: str, per_page: int = 100) -> list[Advisory]:
    response = gh_get(
        "/advisories",
        token,
        params={"per_page": min(per_page, 100), "sort": "published", "direction": "desc"},
    )
    assert response is not None
    advisories: list[Advisory] = []

    for item in response.json():
        vulnerabilities = item.get("vulnerabilities") or []
        if not vulnerabilities:
            advisories.append(
                Advisory(
                    ghsa_id=item.get("ghsa_id") or "",
                    cve_id=item.get("cve_id"),
                    summary=item.get("summary") or "",
                    description=(item.get("description") or "")[:10_000],
                    severity=item.get("severity") or "unknown",
                    published_at=item.get("published_at") or "",
                    updated_at=item.get("updated_at") or "",
                    html_url=item.get("html_url") or "",
                    ecosystem=None,
                    package=None,
                    vulnerable_range=None,
                    patched_versions=None,
                )
            )
            continue

        for vulnerability in vulnerabilities[:5]:
            package = vulnerability.get("package") or {}
            advisories.append(
                Advisory(
                    ghsa_id=item.get("ghsa_id") or "",
                    cve_id=item.get("cve_id"),
                    summary=item.get("summary") or "",
                    description=(item.get("description") or "")[:10_000],
                    severity=item.get("severity") or "unknown",
                    published_at=item.get("published_at") or "",
                    updated_at=item.get("updated_at") or "",
                    html_url=item.get("html_url") or "",
                    ecosystem=package.get("ecosystem"),
                    package=package.get("name"),
                    vulnerable_range=vulnerability.get("vulnerable_version_range"),
                    patched_versions=vulnerability.get("first_patched_version"),
                )
            )
    return advisories


def category_members(category: str) -> list[str]:
    return [key for key, data in TECHNOLOGIES.items() if data["category"] == category]


def iter_signatures(seed: int) -> Iterator[tuple[str, str, str | None]]:
    """Endless deterministic stream of (article_type, primary, secondary)
    pairings. The main loop draws replacements from the same stream when an
    article is rejected or fails, so a batch can keep going until it has
    enough valid articles."""
    rng = random.Random(seed)
    keys = list(TECHNOLOGIES)
    category_keys: dict[str, list[str]] = defaultdict(list)
    for key, data in TECHNOLOGIES.items():
        category_keys[data["category"]].append(key)

    used_pairs: set[tuple[str, str, str]] = set()
    i = 0
    while True:
        article_type = ARTICLE_PLAN[i % len(ARTICLE_PLAN)]

        primary = keys[(i * 7 + seed) % len(keys)]
        secondary: str | None = None

        if article_type == "comparison":
            category = TECHNOLOGIES[primary]["category"]
            candidates = [x for x in category_keys[category] if x != primary]
            secondary = candidates[(i * 3 + seed) % len(candidates)]
        elif article_type == "stack-guide":
            other_categories = [
                c for c in category_keys
                if c != TECHNOLOGIES[primary]["category"]
            ]
            selected_category = other_categories[(i + seed) % len(other_categories)]
            secondary = category_keys[selected_category][(i * 5 + seed) % len(category_keys[selected_category])]
        elif article_type == "migration-guide":
            category = TECHNOLOGIES[primary]["category"]
            candidates = [x for x in category_keys[category] if x != primary]
            secondary = candidates[(i * 11 + seed) % len(candidates)]

        signature = (article_type, primary, secondary or "")
        attempts = 0
        while signature in used_pairs and attempts < len(keys):
            primary = rng.choice(keys)
            if article_type in {"comparison", "migration-guide"}:
                peers = [x for x in category_keys[TECHNOLOGIES[primary]["category"]] if x != primary]
                secondary = rng.choice(peers)
            elif article_type == "stack-guide":
                secondary = rng.choice([x for x in keys if TECHNOLOGIES[x]["category"] != TECHNOLOGIES[primary]["category"]])
            signature = (article_type, primary, secondary or "")
            attempts += 1

        used_pairs.add(signature)
        yield article_type, primary, secondary
        i += 1


def job_for_slot(
    signature: tuple[str, str, str | None],
    slot: int,
    start_date: date,
    offset: int = 0,
) -> ArticleJob:
    """Slot = zero-based position in the published progression, so dates stay a
    gapless ARTICLES_PER_DATE-per-day sequence even when pairings are retried.
    `offset` resumes part-way into the first date when a previous batch left it
    partially filled."""
    article_type, primary, secondary = signature
    position = slot + offset
    return ArticleJob(
        article_type=article_type,
        primary_key=primary,
        secondary_key=secondary,
        publication_date=(start_date + timedelta(days=position // ARTICLES_PER_DATE)).isoformat(),
        sequence=slot + 1,
    )


def make_jobs(count: int, start_date: date, seed: int, offset: int = 0) -> list[ArticleJob]:
    signatures = iter_signatures(seed)
    return [job_for_slot(next(signatures), i, start_date, offset) for i in range(count)]


def choose_advisory(
    advisories: list[Advisory],
    tech_key: str,
    used_ids: set[str],
) -> Advisory | None:
    tech = TECHNOLOGIES[tech_key]
    search_terms = {
        tech["name"].lower(),
        tech["topic"].lower(),
        tech["repo"].split("/")[-1].lower(),
        *(alias.lower() for alias in tech.get("aliases", [])),
    }

    for advisory in advisories:
        if advisory.ghsa_id in used_ids:
            continue
        haystack = " ".join(
            [
                advisory.summary,
                advisory.description,
                advisory.package or "",
                advisory.ecosystem or "",
            ]
        ).lower()
        if any(term and term in haystack for term in search_terms):
            used_ids.add(advisory.ghsa_id)
            return advisory

    # A generic advisory is still usable for a dependency-security workflow article,
    # but it must not be represented as a vulnerability in the primary technology.
    for advisory in advisories:
        if advisory.ghsa_id not in used_ids:
            used_ids.add(advisory.ghsa_id)
            return advisory
    return None


def article_sources(
    job: ArticleJob,
    repos: dict[str, RepoFacts],
    advisory: Advisory | None,
) -> list[dict[str, str]]:
    result = [
        {
            "label": f"{TECHNOLOGIES[job.primary_key]['name']} canonical repository",
            "url": repos[job.primary_key].url,
        }
    ]
    if repos[job.primary_key].latest_release:
        result.append({
            "label": f"{TECHNOLOGIES[job.primary_key]['name']} latest GitHub release",
            "url": repos[job.primary_key].latest_release.get("html_url") or repos[job.primary_key].url,
        })
    if job.secondary_key:
        result.append({
            "label": f"{TECHNOLOGIES[job.secondary_key]['name']} canonical repository",
            "url": repos[job.secondary_key].url,
        })
    if advisory:
        result.append({
            "label": f"GitHub Security Advisory {advisory.ghsa_id}",
            "url": advisory.html_url,
        })
    return result


def compact_repo(repo: RepoFacts) -> dict[str, Any]:
    data = asdict(repo)
    data["readme"] = repo.readme[:35_000]
    return data


def build_editorial_prompt(
    job: ArticleJob,
    repos: dict[str, RepoFacts],
    advisory: Advisory | None,
    image_paths: dict[str, str],
) -> str:
    primary_meta = TECHNOLOGIES[job.primary_key]
    primary = repos[job.primary_key]
    secondary_meta = TECHNOLOGIES.get(job.secondary_key or "")
    secondary = repos.get(job.secondary_key or "")
    sources = article_sources(job, repos, advisory)

    type_directives = {
        "comparison": """
Compare the two technologies for real project decisions. Build a decision matrix,
trade-off table, workload fit analysis, migration considerations, and clear
recommendations for at least four different project profiles. Do not declare an
absolute winner.
""",
        "ecosystem-guide": """
Create a deep ecosystem map: core repository, project categories, integration
patterns, evaluation criteria, maintenance signals, licensing considerations,
and a practical discovery workflow. Avoid unverified package recommendations.
""",
        "release-news": """
Analyze the latest available release evidence. Explain what changed, who should
care, upgrade risk, test plan, rollback plan, and questions left unanswered by
the release notes. The title must include an exact release identifier or date
when available.
""",
        "security-alert": """
Produce a careful security briefing. Clearly distinguish:
(a) facts from the advisory,
(b) whether the primary technology is directly affected,
(c) dependency-chain relevance,
(d) actions maintainers should take.
Never imply that the primary technology is vulnerable unless the supplied
advisory explicitly names it. Include a severity box, affected range table,
verification commands as examples only when they are generic and safe, and an
incident-response checklist.
""",
        "stack-guide": """
Explain how the two technologies can form a coherent stack. Include architecture,
request/data flow, integration boundaries, deployment topology, observability,
security boundaries, and a staged implementation plan.
""",
        "architecture-analysis": """
Analyze the project architecture using repository evidence. Explain modules,
extension points, operational implications, scaling boundaries, and what cannot
be concluded from public metadata. Label inferences explicitly.
""",
        "repository-spotlight": """
Write a rigorous repository profile: purpose, maintenance signals, repository
health, intended users, evidence-backed strengths, limitations, evaluation
checklist, and responsible adoption path.
""",
        "adoption-analysis": """
Assess adoption signals without treating GitHub stars as market share. Discuss
repository activity, release cadence, issue load, license, ecosystem signals,
selection risks, and what additional evidence a team should collect.
""",
        "migration-guide": """
Create a migration decision and execution guide between the two technologies.
Include suitability assessment, inventory, compatibility risks, phased plan,
test strategy, data/API concerns, rollback gates, and cases where migration is
not justified.
""",
        "performance-checklist": """
Create a practical performance engineering guide tied to the technology. Cover
measurement design, representative workloads, profiling, caching, I/O,
concurrency, database/network boundaries, CI regression checks, and misleading
benchmark patterns. Do not fabricate performance numbers.
""",
    }

    desired_tags = [
        primary_meta["name"],
        primary_meta["category"],
        ARTICLE_TYPE_LABELS[job.article_type],
        "GitHub",
        "Open Source",
    ]
    if secondary_meta:
        desired_tags.append(secondary_meta["name"])
    if advisory and advisory.cve_id:
        desired_tags.append(advisory.cve_id)

    payload = {
        "site": {
            "name": SITE_NAME,
            "url": SITE_URL,
            "audience": "software developers, technical founders, architects, and engineering leaders",
        },
        "job": asdict(job),
        "primary_technology": primary_meta,
        "primary_repository": compact_repo(primary),
        "secondary_technology": secondary_meta,
        "secondary_repository": compact_repo(secondary) if secondary else None,
        "security_advisory": asdict(advisory) if advisory else None,
        "publication_date": job.publication_date,
        "generated_at": utc_now().isoformat(),
        "desired_tags": desired_tags,
        "sources": sources,
        "local_images": image_paths,
    }

    return f"""
You are the senior technical editor for {SITE_NAME}. Produce a publishable,
original, evidence-grounded article for the main index site.

ARTICLE MODE
{ARTICLE_TYPE_LABELS[job.article_type]}

MODE-SPECIFIC DIRECTIVE
{type_directives[job.article_type]}

NON-NEGOTIABLE FACTUAL RULES
1. Use only facts in EDITORIAL DATA.
2. Never invent benchmarks, adoption percentages, release behavior, compatibility,
   vulnerabilities, package features, commands, company usage, or quotations.
3. GitHub stars are interest signals, not usage or market-share measurements.
4. Open-issue counts are not defect counts.
5. Explicitly label architectural conclusions that are inferred from READMEs or
   repository structure.
6. For security content, never overstate affected products or versions.
7. Mention the data retrieval/generation date where freshness matters.
8. Cite supplied sources inline using normal Markdown links.
9. Do not repeat generic introductions such as "In today's rapidly evolving..."
10. Do not copy README prose. Synthesize and paraphrase.

STRUCTURE RULES (mechanically checked)
- Every section starts with a real Markdown heading: "## Section name". Never
  write a bare line such as "Executive answer" or "Limitations" as a section
  label — an unheaded label has no anchor and disappears from navigation.
- Do NOT write a table of contents. One is generated from your headings; a
  hand-written one only adds anchors that do not resolve.
- Exactly one FAQ section, headed "## FAQ", each question an H3 ("### ...").
- Do NOT put front matter, SEO metadata, Open Graph fields, JSON-LD, or a
  schema block in body_markdown. Those are generated from the JSON fields.

DEPTH AND PRESENTATION
- Target 1,800–2,800 useful words, not filler.
- Use a direct, technical, readable tone.
- Open with a two-paragraph "## Executive answer" section.
- Use 6–10 meaningful H2 sections and optional H3 subsections.
- Include at least two substantial tables.
- Include at least three visual/callout blocks using this syntax:
  > [!NOTE]
  > ...
  >
  > [!TIP]
  > ...
  >
  > [!WARNING]
  > ...
- Embed the cover image as the first line of body_markdown, copying the path
  character for character:
  ![descriptive alt text]({image_paths["LOCAL_COVER_PATH"]})
- Embed the data image inside the most relevant section, same rule:
  ![descriptive alt text]({image_paths["LOCAL_DATA_PATH"]})
- Both paths are already site-absolute. Do not add a leading slash, a domain,
  or a "./" prefix, and do not substitute a placeholder name for them.
- Include one valid Mermaid diagram in a fenced ```mermaid block.
- Include a "Decision checklist" or "Action checklist".
- Include an "Evidence, assumptions, and limitations" section.
- Include a "Sources" section listing only supplied sources.
- Include 4–7 FAQs with concise, non-repetitive answers.
- Avoid fake quotes, fake case studies, empty trend claims, and keyword stuffing.

SEO REQUIREMENTS
- SEO title: 45–62 characters where practical.
- Meta description: 135–160 characters.
- One clear primary keyphrase and 4–8 secondary keyphrases.
- Slug: concise, lowercase, hyphenated, no date unless news/security requires
  it. Derive it from the article title — never from the image filenames above,
  and never from the article-type/technology labels in EDITORIAL DATA.
- Natural keyword usage; never repeat a phrase mechanically.
- Include search intent, canonical URL, Open Graph fields, and article schema.
- Title and description must accurately represent the evidence.

OUTPUT FORMAT
Return ONLY one JSON object. Do not wrap it in Markdown.

Schema:
{{
  "title": "string",
  "description": "string",
  "slug": "string, derived from the title, no leading or trailing slash",
  "excerpt": "string",
  "primary_keyphrase": "string",
  "secondary_keyphrases": ["string"],
  "tags": ["string"],
  "search_intent": "informational|commercial-investigation|news|security",
  "body_markdown": "complete Markdown article without YAML front matter",
  "faq": [
    {{"question": "string", "answer": "string"}}
  ]
}}

The body_markdown must already include the FAQ section, Sources section, images,
tables, callouts, Mermaid diagram, and all required editorial sections.

EDITORIAL DATA
{json.dumps(payload, ensure_ascii=False, indent=2)}
""".strip()


REQUIRED_ARTICLE_FIELDS = {
    "title", "description", "slug", "excerpt",
    "primary_keyphrase", "secondary_keyphrases", "tags",
    "search_intent", "body_markdown", "faq",
}


def extract_json(raw: str) -> dict[str, Any]:
    """Parse the model's JSON object, tolerating code fences and stray prose.

    A whole long-form article is too expensive to discard because the model
    prefixed it with "Here is the JSON:", so fall back to scanning for the
    first decodable object rather than failing the attempt outright.
    """
    text = re.sub(r"\s*```\s*$", "", re.sub(r"^\s*```(?:json)?\s*", "", raw.strip())).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        pass
    else:
        if isinstance(parsed, dict):
            return parsed

    decoder = json.JSONDecoder()
    start = text.find("{")
    while start >= 0:
        try:
            value, _ = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    raise ValueError("Model response contained no parsable JSON object")


def is_fatal_llm_error(exc: Exception) -> bool:
    """Bad request / auth / missing-model failures repeat identically, so five
    backed-off retries only delay the inevitable error by ~a minute."""
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return status in {400, 401, 403, 404}


def openai_generate(client: OpenAI, prompt: str) -> dict[str, Any]:
    for attempt in range(LLM_MAX_RETRIES):
        try:
            if LLM_USE_CHAT:
                # OpenRouter (and other OpenAI-compatible gateways) speak Chat
                # Completions, not the Responses API.
                kwargs: dict[str, Any] = {
                    "model": LLM_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": LLM_MAX_TOKENS,
                }
                if not LLM_MODEL.startswith("anthropic/"):
                    # Constrained JSON where the provider supports it; Claude
                    # relies on the prompt contract + the validation/retry loop.
                    kwargs["response_format"] = {"type": "json_object"}
                response = client.chat.completions.create(**kwargs)
                record_usage(response)
                if response.choices[0].finish_reason == "length":
                    raise ValueError(f"Article output cut off at max_tokens={LLM_MAX_TOKENS}")
                raw = (response.choices[0].message.content or "").strip()
            else:
                response = client.responses.create(
                    model=LLM_MODEL,
                    input=prompt,
                )
                record_usage(response)
                raw = response.output_text.strip()
            result = extract_json(raw)
            missing = REQUIRED_ARTICLE_FIELDS - set(result)
            if missing:
                raise ValueError(f"Model JSON missing fields: {sorted(missing)}")
            body = result.get("body_markdown")
            if not isinstance(body, str) or len(body) < MIN_BODY_CHARS:
                raise ValueError("Article body is too short for the requested depth.")
            return result
        except Exception as exc:
            if is_fatal_llm_error(exc) or attempt == LLM_MAX_RETRIES - 1:
                raise
            delay = min(30, 2 ** attempt)
            print(f"Generation error: {exc}; retrying in {delay}s")
            time.sleep(delay)
    raise RuntimeError("Unreachable")


def safe_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def wrapped_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def palette_for(key: str) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    digest = hashlib.sha256(key.encode()).digest()
    base = tuple(45 + (digest[i] % 130) for i in range(3))
    accent = tuple(100 + (digest[i + 3] % 145) for i in range(3))
    dark = tuple(max(12, channel // 4) for channel in base)
    return base, accent, dark


def create_cover_image(
    job: ArticleJob,
    output_path: Path,
) -> None:
    width, height = 1600, 900
    base, accent, dark = palette_for(job.primary_key + job.article_type)
    image = Image.new("RGB", (width, height), dark)
    draw = ImageDraw.Draw(image)

    # Layered geometric background.
    for i in range(16):
        x0 = int((i / 16) * width)
        shade = tuple(min(255, int(dark[c] + (base[c] - dark[c]) * (i / 15))) for c in range(3))
        draw.rectangle((x0, 0, x0 + width // 16 + 2, height), fill=shade)

    for i in range(12):
        radius = 60 + i * 35
        x = width - 180 - i * 45
        y = 100 + (i % 4) * 175
        color = tuple(min(255, accent[c] + i * 3) for c in range(3))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=color, width=5)

    title_font = safe_font(76, bold=True)
    subtitle_font = safe_font(34, bold=False)
    label_font = safe_font(28, bold=True)

    primary = TECHNOLOGIES[job.primary_key]["name"]
    secondary = TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else None
    title = f"{primary} × {secondary}" if secondary else primary
    subtitle = ARTICLE_TYPE_LABELS[job.article_type]

    draw.rounded_rectangle((90, 80, 500, 145), radius=20, fill=(255, 255, 255))
    draw.text((120, 96), SITE_NAME.upper(), font=label_font, fill=dark)

    y = 260
    for line in wrapped_lines(draw, title, title_font, 1050)[:4]:
        draw.text((100, y), line, font=title_font, fill=(255, 255, 255))
        y += 92

    draw.text((105, min(y + 45, 760)), subtitle, font=subtitle_font, fill=(240, 240, 240))
    image.save(output_path, quality=92)


def create_data_image(
    job: ArticleJob,
    repos: dict[str, RepoFacts],
    output_path: Path,
) -> None:
    width, height = 1400, 820
    image = Image.new("RGB", (width, height), (248, 249, 251))
    draw = ImageDraw.Draw(image)
    title_font = safe_font(44, bold=True)
    label_font = safe_font(27, bold=True)
    value_font = safe_font(25, bold=False)
    small_font = safe_font(21, bold=False)

    primary = repos[job.primary_key]
    secondary = repos.get(job.secondary_key or "")
    items = [(TECHNOLOGIES[job.primary_key]["name"], primary)]
    if secondary:
        items.append((TECHNOLOGIES[job.secondary_key]["name"], secondary))

    draw.text((70, 55), "Repository evidence snapshot", font=title_font, fill=(25, 30, 40))
    draw.text(
        (70, 115),
        f"Generated {utc_now().date().isoformat()} · GitHub metrics are snapshots, not adoption measurements",
        font=small_font,
        fill=(80, 85, 95),
    )

    metrics = [
        ("Stars", lambda r: r.stars),
        ("Forks", lambda r: r.forks),
        ("Open issues", lambda r: r.open_issues),
        ("Watchers", lambda r: r.watchers),
    ]
    max_values = {
        label: max(1, max(accessor(repo) for _, repo in items))
        for label, accessor in metrics
    }

    colors = [(59, 91, 219), (220, 83, 97)]
    y = 220
    for metric_index, (label, accessor) in enumerate(metrics):
        draw.text((70, y), label, font=label_font, fill=(35, 40, 50))
        bar_y = y + 54
        for item_index, (name, repo) in enumerate(items):
            value = accessor(repo)
            ratio = math.log10(value + 1) / math.log10(max_values[label] + 1)
            bar_width = max(12, int(900 * ratio))
            current_y = bar_y + item_index * 62
            draw.rounded_rectangle(
                (280, current_y, 280 + bar_width, current_y + 34),
                radius=12,
                fill=colors[item_index],
            )
            draw.text((70, current_y + 2), name, font=value_font, fill=(50, 55, 65))
            draw.text((300 + bar_width, current_y + 2), f"{value:,}", font=value_font, fill=(50, 55, 65))
        y += 145

    image.save(output_path, quality=92)


def image_paths_for_job(job: ArticleJob) -> tuple[dict[str, str], Path, Path]:
    date_path = Path(job.publication_date.replace("-", "/"))
    folder = OUTPUT_DIR / "assets" / date_path

    signature = "-".join(
        part for part in [
            job.article_type,
            job.primary_key,
            job.secondary_key or "",
            str(job.sequence),
        ] if part
    )
    cover_filename = f"{slugify(signature)}-cover.jpg"
    data_filename = f"{slugify(signature)}-data.jpg"
    cover_abs = folder / cover_filename
    data_abs = folder / data_filename

    # Relative paths assume articles are copied into the same site content tree.
    cover_public = f"/assets/{job.publication_date.replace('-', '/')}/{cover_filename}"
    data_public = f"/assets/{job.publication_date.replace('-', '/')}/{data_filename}"
    return {
        "LOCAL_COVER_PATH": cover_public,
        "LOCAL_DATA_PATH": data_public,
    }, cover_abs, data_abs


def write_job_images(
    job: ArticleJob,
    repos: dict[str, RepoFacts],
    cover_path: Path,
    data_path: Path,
) -> None:
    """Called only once an article is accepted. Writing the JPEGs up front left
    a cover/data pair on disk for every failed or near-duplicate attempt, and
    hydrate-blog then copied each orphan into public/assets."""
    cover_path.parent.mkdir(parents=True, exist_ok=True)
    create_cover_image(job, cover_path)
    create_data_image(job, repos, data_path)


def discard_job_images(cover_path: Path, data_path: Path) -> None:
    """Undo write_job_images after a failed save, leaving no half-published
    pair behind (and no empty date folder)."""
    for path in (cover_path, data_path):
        path.unlink(missing_ok=True)
    folder = cover_path.parent
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()


def fit_length(
    text: str,
    min_len: int,
    max_len: int,
    *,
    pad_suffix: str = "",
) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    if len(text) > max_len:
        clipped = text[:max_len]
        if " " in clipped:
            clipped = clipped.rsplit(" ", 1)[0]
        text = clipped.rstrip(".,;:- ") + "."
    if len(text) < min_len and pad_suffix:
        candidate = f"{text} {pad_suffix}".strip()
        if len(candidate) <= max_len:
            text = candidate
    return text[:max_len]


TOC_HEADINGS = {"table of contents", "contents", "on this page"}


def iter_h2_lines(body: str) -> Iterator[tuple[int, str]]:
    """Yield (line index, heading text) for every H2 outside a fenced block, so
    a ``## comment`` inside a code sample is never mistaken for a section."""
    fence = False
    for index, line in enumerate(body.splitlines()):
        stripped = line.strip()
        if stripped.startswith("```"):
            fence = not fence
            continue
        if not fence and stripped.startswith("## "):
            yield index, stripped[3:].strip()


def extract_h2_headings(body: str) -> list[str]:
    return [text for _, text in iter_h2_lines(body) if text.lower() not in TOC_HEADINGS]


def _splice(body: str, index: int, insertion: str) -> str:
    lines = body.splitlines()
    head = "\n".join(lines[:index]).rstrip()
    tail = "\n".join(lines[index:])
    prefix = f"{head}\n\n" if head else ""
    return f"{prefix}{insertion.strip()}\n\n{tail}"


def insert_before_first_h2(body: str, insertion: str) -> str:
    for index, _ in iter_h2_lines(body):
        return _splice(body, index, insertion)
    return body.rstrip() + "\n\n" + insertion.strip() + "\n"


def insert_before_section(body: str, heading: str, insertion: str) -> str:
    target = heading[3:].strip().lower() if heading.startswith("## ") else heading.strip().lower()
    for index, text in iter_h2_lines(body):
        if text.lower().startswith(target):
            return _splice(body, index, insertion)
    return body.rstrip() + "\n\n" + insertion.strip() + "\n"


def drop_h2_sections(body: str, predicate) -> str:
    """Remove every H2 section whose heading matches `predicate`, fences and
    all, and collapse the blank lines left behind."""
    out: list[str] = []
    fence = False
    skipping = False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            fence = not fence
            if not skipping:
                out.append(line)
            continue
        if not fence and stripped.startswith("## "):
            skipping = predicate(stripped[3:].strip())
        if skipping:
            continue
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


TOC_ENTRY = re.compile(r"^(?:[-*+]|\d+[.)])\s+\[[^\]]*\]\(#[^)]*\)\s*$")


def drop_toc_blocks(body: str) -> str:
    """Remove every table of contents: the heading plus the anchor list under
    it, and nothing else. Deleting through to the next H2 instead would take
    any callout or paragraph the model parked between the TOC and section one."""
    lines = body.splitlines()
    out: list[str] = []
    fence = False
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if stripped.startswith("```"):
            fence = not fence
            out.append(lines[index])
            index += 1
            continue
        if not fence and stripped.startswith("## ") and stripped[3:].strip().lower() in TOC_HEADINGS:
            index += 1
            while index < len(lines):
                entry = lines[index].strip()
                if entry and not TOC_ENTRY.match(entry):
                    break
                index += 1
            continue
        out.append(lines[index])
        index += 1
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def rebuild_table_of_contents(body: str) -> str:
    """Replace any table of contents with one derived from the headings that
    actually survived finalisation.

    Two separate defects used to leave dead in-page links: the model's hand-
    written anchors rarely matched the ids the site renderer derives from the
    heading text, and the TOC was built *before* the repository table, diagram,
    sources, and FAQ sections were injected, so it never listed them."""
    body = drop_toc_blocks(body)
    headings = extract_h2_headings(body)
    if len(headings) < 3:
        return body
    seen: set[str] = set()
    toc_lines = ["## Table of contents", ""]
    for heading in headings:
        anchor = anchor_slug(heading)
        if not anchor or anchor in seen:
            continue
        seen.add(anchor)
        toc_lines.append(f"- [{heading}](#{anchor})")
    toc_lines.append("")
    return insert_before_first_h2(body, "\n".join(toc_lines))


# Section labels models emit as bare paragraphs instead of headings. The list
# mirrors isFactorySectionLabel() in src/lib/blog-markdown.ts, where the site
# deletes these lines outright — promoting them here keeps the section (and its
# table-of-contents entry) instead of silently dropping the label.
PSEUDO_HEADINGS = frozenset({
    "table of contents", "contents", "executive summary", "executive answer",
    "facts", "evidence", "evidence used", "limitations", "meta",
    "open graph fields", "observed facts", "selection risks", "execution notes",
    "operational notes", "operational monitoring", "measurement boundaries",
    "workload categories", "caching strategies", "concurrency considerations",
    "capacity planning", "instrumentation data collection",
    "detecting remote slowness", "core metrics to capture",
    "recommended ci tiers", "affected-range table", "facts from repositories",
    "inferred trade-offs", "inferred guidance", "how to interpret these signals",
})

PSEUDO_HEADING_PREFIXES = (
    r"inferred\b", r"assumptions\b", r"article (?:metadata|schema)\b",
    r"schema \(article\b", r"designing ci checks\b",
    r"representative test harness\b",
)


def is_pseudo_heading(text: str) -> bool:
    lowered = text.strip().lower()
    if lowered in PSEUDO_HEADINGS:
        return True
    return any(re.match(pattern, lowered) for pattern in PSEUDO_HEADING_PREFIXES)


def promote_pseudo_headings(body: str) -> str:
    """Turn standalone section labels into real H2s.

    Models routinely write "Executive answer" as its own paragraph rather than
    "## Executive answer". Left alone, the section is invisible to the table of
    contents and has no anchor the site can link to."""
    lines = body.splitlines()
    fence = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            fence = not fence
            continue
        if fence or not stripped or re.match(r"^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||!\[|\[)", stripped):
            continue
        if index and lines[index - 1].strip():
            continue
        if is_pseudo_heading(stripped):
            lines[index] = f"## {stripped}"
    return "\n".join(lines)


META_HEADING_PATTERNS = (
    r"article\s+metadata",
    r"\bseo\b",
    r"^open\s+graph",
    r"machine-readable",
    r"json-?ld",
    r"structured\s+data",
    r"^front\s*matter",
    r"^meta(?:data)?$",
    r"^open graph fields$",
    r"^schema \(article",
)


def is_meta_heading(text: str) -> bool:
    lowered = text.strip().lower()
    return any(re.search(pattern, lowered) for pattern in META_HEADING_PATTERNS)


def strip_meta_blocks(body: str) -> str:
    """Drop the SEO / front-matter / JSON-LD sections models like to append.

    They duplicate what render_frontmatter already emits as real front matter,
    and today the site renderer only hides them behind a growing list of
    defensive special cases in src/lib/blog-markdown.ts."""
    return drop_h2_sections(body, is_meta_heading)


FAQ_HEADING = re.compile(r"^(FAQs?|Frequently asked questions)$", re.IGNORECASE)


def dedupe_faq_sections(body: str) -> str:
    """Keep only the last FAQ section. Models routinely emit a numbered
    "## FAQs" list and then repeat every question under "## FAQ"."""
    bounds: list[tuple[int, int]] = []
    start: int | None = None
    positions = list(iter_h2_lines(body))
    for index, text in positions:
        if start is not None:
            bounds.append((start, index))
            start = None
        if FAQ_HEADING.fullmatch(text):
            start = index
    total_lines = len(body.splitlines())
    if start is not None:
        bounds.append((start, total_lines))
    if len(bounds) < 2:
        return body
    drop: set[int] = set()
    for begin, end in bounds[:-1]:
        drop.update(range(begin, end))
    kept = [line for index, line in enumerate(body.splitlines()) if index not in drop]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def normalize_image_embeds(body: str, image_paths: dict[str, str]) -> str:
    """Repair the two ways models mangle the supplied asset paths: emitting the
    placeholder token verbatim, and prefixing an extra slash — which turns
    /assets/x.jpg into //assets/x.jpg, a protocol-relative request to a host
    literally named "assets"."""
    for token, path in image_paths.items():
        body = body.replace(token, path)
    body = re.sub(r"\]\(\s*/{2,}assets/", "](/assets/", body)
    body = re.sub(r"\]\(\s*(?:\./)?assets/", "](/assets/", body)
    return body


def ensure_images(body: str, image_paths: dict[str, str], primary_name: str, type_label: str) -> str:
    """Both generated images are already on disk and referenced by the front
    matter, so an article that forgot to embed them ships a bare wall of text."""
    cover = image_paths["LOCAL_COVER_PATH"]
    data = image_paths["LOCAL_DATA_PATH"]
    if cover not in body:
        alt = f"{primary_name} {type_label.lower()} cover image"
        body = f"![{alt}]({cover})\n\n{body.lstrip()}"
    if data not in body:
        alt = f"{primary_name} repository evidence snapshot"
        body = insert_before_section(body, "## Sources", f"![{alt}]({data})")
    return body


def ensure_editorial_callouts(body: str, primary_name: str) -> str:
    if body.count("> [!") >= 3:
        return body
    blocks = [
        (
            "> [!NOTE]\n"
            f"> Repository signals for {primary_name} were collected at generation time "
            "and should be re-checked before production decisions."
        ),
        (
            "> [!TIP]\n"
            "> Start with a narrow integration spike, then expand scope only after "
            "observability and rollback paths are in place."
        ),
        (
            "> [!WARNING]\n"
            "> GitHub stars, fork counts, and open-issue totals are weak proxies for "
            "security or operational readiness."
        ),
    ]
    needed = 3 - body.count("> [!")
    injection = "\n\n".join(blocks[:needed])
    return insert_before_first_h2(body, injection)


def ensure_repo_tables(
    body: str,
    job: ArticleJob,
    repos: dict[str, RepoFacts],
) -> str:
    if body.count("|") >= 18:
        return body
    primary = repos[job.primary_key]
    secondary = repos.get(job.secondary_key or "")
    primary_name = TECHNOLOGIES[job.primary_key]["name"]
    secondary_name = (
        TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else "Not applicable"
    )
    secondary_stars = f"{secondary.stars:,}" if secondary else "—"
    secondary_forks = f"{secondary.forks:,}" if secondary else "—"
    secondary_issues = f"{secondary.open_issues:,}" if secondary else "—"
    secondary_lang = secondary.language or "—" if secondary else "—"
    secondary_license = secondary.license or "—" if secondary else "—"
    secondary_push = (secondary.pushed_at or "—")[:10] if secondary else "—"
    table = "\n".join([
        "## Repository signals at generation time",
        "",
        f"| Signal | {primary_name} | {secondary_name} |",
        "| --- | --- | --- |",
        f"| GitHub stars | {primary.stars:,} | {secondary_stars} |",
        f"| Forks | {primary.forks:,} | {secondary_forks} |",
        f"| Open issues | {primary.open_issues:,} | {secondary_issues} |",
        f"| Primary language | {primary.language or '—'} | {secondary_lang} |",
        f"| License | {primary.license or '—'} | {secondary_license} |",
        f"| Last push (UTC) | {(primary.pushed_at or '—')[:10]} | {secondary_push} |",
        "",
    ])
    return insert_before_section(body, "## Sources", table)


def ensure_mermaid_diagram(
    body: str,
    primary_name: str,
    secondary_name: str | None,
) -> str:
    if "```mermaid" in body:
        return body
    if secondary_name:
        diagram = textwrap.dedent(
            f"""
            ```mermaid
            flowchart LR
              req[Requirements] --> primary[{primary_name}]
              primary --> secondary[{secondary_name}]
              secondary --> ops[Operate and measure]
            ```
            """
        ).strip()
    else:
        diagram = textwrap.dedent(
            f"""
            ```mermaid
            flowchart LR
              req[Requirements] --> stack[{primary_name}]
              stack --> pilot[Pilot workload]
              pilot --> review[Review evidence]
            ```
            """
        ).strip()
    return insert_before_section(body, "## Sources", diagram + "\n\n")


def ensure_sources_section(
    body: str,
    sources: list[dict[str, str]],
) -> str:
    if re.search(r"^## Sources\b", body, re.MULTILINE):
        return body
    lines = ["## Sources", ""]
    for source in sources:
        lines.append(f"- [{source['label']}]({source['url']})")
    lines.append("")
    return body.rstrip() + "\n\n" + "\n".join(lines)


def ensure_faq_section(body: str, faq: list[dict[str, Any]]) -> str:
    body = dedupe_faq_sections(body)
    # One canonical spelling so the renderer does not have to alias headings.
    body = re.sub(
        r"^## (?:FAQs|Frequently asked questions)\s*$",
        "## FAQ",
        body,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    if re.search(r"^## FAQ\b", body, re.MULTILINE):
        return body
    entries = faq or []
    if not entries:
        entries = [
            {
                "question": "How fresh is the evidence in this article?",
                "answer": (
                    "The article is grounded in repository metadata and supplied sources "
                    "collected at generation time. Re-check release notes and advisories "
                    "before acting on upgrade or security guidance."
                ),
            }
        ]
    lines = ["## FAQ", ""]
    for item in entries[:7]:
        question = str(item.get("question", "")).strip()
        answer = str(item.get("answer", "")).strip()
        if not question or not answer:
            continue
        lines.extend([f"### {question}", "", answer, ""])
    return body.rstrip() + "\n\n" + "\n".join(lines).rstrip() + "\n"


def choose_slug(article: dict[str, Any], image_paths: dict[str, str]) -> str:
    """Prefer the model's slug, but not when it echoes the asset filename.

    Asset names are built from the job signature (article_type-primary-
    secondary-sequence) and appear verbatim in the prompt, so models sometimes
    copy that stem into the slug field — publishing a good article at
    /blog/repository-spotlight-fastify-5 instead of a readable URL."""
    asset_stem = Path(image_paths["LOCAL_COVER_PATH"]).name
    for suffix in ("-cover.jpg", "-data.jpg"):
        asset_stem = asset_stem.removesuffix(suffix)
    asset_stem = article_slug(asset_stem)

    candidate = article_slug(str(article.get("slug") or ""))
    if not candidate or candidate == asset_stem or asset_stem.startswith(f"{candidate}-"):
        candidate = article_slug(str(article.get("title") or ""))
    return candidate


def finalize_article(
    article: dict[str, Any],
    job: ArticleJob,
    repos: dict[str, RepoFacts],
    sources: list[dict[str, str]],
    image_paths: dict[str, str],
) -> dict[str, Any]:
    primary_name = TECHNOLOGIES[job.primary_key]["name"]
    secondary_name = (
        TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else None
    )
    type_label = ARTICLE_TYPE_LABELS[job.article_type]

    article["title"] = fit_length(
        str(article.get("title") or "").strip(),
        35,
        80,
        pad_suffix=f"— {primary_name} {type_label.lower()}",
    )
    article["description"] = fit_length(
        str(article.get("description") or "").strip(),
        120,
        175,
        pad_suffix="Evidence-backed notes for engineering teams.",
    )
    article["slug"] = choose_slug(article, image_paths)

    tags = [str(tag).strip() for tag in (article.get("tags") or []) if str(tag).strip()]
    for tag in [
        primary_name,
        TECHNOLOGIES[job.primary_key]["category"],
        type_label,
        "Open Source",
    ]:
        if tag not in tags:
            tags.append(tag)
    if secondary_name and secondary_name not in tags:
        tags.append(secondary_name)
    article["tags"] = tags[:10]

    # Order matters: clean and inject everything first, build the table of
    # contents last so it lists the sections that actually shipped.
    body = str(article["body_markdown"]).strip()
    body = promote_pseudo_headings(body)
    body = strip_meta_blocks(body)
    body = normalize_image_embeds(body, image_paths)
    body = ensure_editorial_callouts(body, primary_name)
    body = ensure_repo_tables(body, job, repos)
    body = ensure_mermaid_diagram(body, primary_name, secondary_name)
    body = ensure_sources_section(body, sources)
    body = ensure_faq_section(body, article.get("faq") or [])
    body = ensure_images(body, image_paths, primary_name, type_label)
    body = rebuild_table_of_contents(body)
    article["body_markdown"] = body
    return article


def validate_article(
    article: dict[str, Any],
    job: ArticleJob,
) -> list[str]:
    errors: list[str] = []
    title = article["title"].strip()
    description = article["description"].strip()
    body = article["body_markdown"]

    if not 35 <= len(title) <= 80:
        errors.append(f"title length is {len(title)}")
    if not 120 <= len(description) <= 175:
        errors.append(f"description length is {len(description)}")
    if not re.search(r"^## (Table of contents|Contents)\b", body, re.IGNORECASE | re.MULTILINE):
        errors.append("missing table of contents")
    if body.count("|") < 18:
        errors.append("fewer than two substantial Markdown tables")
    if body.count("> [!") < 3:
        errors.append("fewer than three callout blocks")
    if "```mermaid" not in body:
        errors.append("missing Mermaid diagram")
    if "## Sources" not in body:
        errors.append("missing Sources section")
    if not re.search(r"^## (FAQ|Frequently asked questions)\b", body, re.IGNORECASE | re.MULTILINE):
        errors.append("missing FAQ section")
    if len(article.get("tags", [])) < 4:
        errors.append("too few tags")
    if not article.get("slug"):
        errors.append("empty slug")
    if re.search(r"LOCAL_(?:COVER|DATA)_PATH", body):
        errors.append("unsubstituted image placeholder")
    if re.search(r"\]\(\s*//assets/", body):
        errors.append("protocol-relative asset path")
    if TECHNOLOGIES[job.primary_key]["name"].lower() not in (
        title + " " + body[:1_500]
    ).lower():
        errors.append("primary technology not prominent")
    return errors


def faq_pairs_from_body(body: str, fallback: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Read the FAQ back out of the finished body so the FAQPage schema always
    matches what a reader sees, even after a repair pass rewrote the answers."""
    headings = list(iter_h2_lines(body))
    lines = body.splitlines()
    start: int | None = None
    end = len(lines)
    for index, text in headings:
        if start is not None:
            end = index
            break
        if FAQ_HEADING.fullmatch(text):
            start = index

    pairs: list[dict[str, str]] = []
    if start is not None:
        question: str | None = None
        answer: list[str] = []
        for line in lines[start + 1:end]:
            stripped = line.strip()
            if stripped.startswith("### "):
                if question and answer:
                    pairs.append({"question": question, "answer": " ".join(answer)})
                question = stripped[4:].strip()
                answer = []
            elif question and stripped:
                answer.append(stripped)
        if question and answer:
            pairs.append({"question": question, "answer": " ".join(answer)})

    if not pairs:
        pairs = [
            {
                "question": str(item.get("question", "")).strip(),
                "answer": str(item.get("answer", "")).strip(),
            }
            for item in fallback or []
        ]
    return [item for item in pairs if item["question"] and item["answer"]][:7]


def render_frontmatter(
    article: dict[str, Any],
    job: ArticleJob,
    cover_path: str,
) -> str:
    primary = TECHNOLOGIES[job.primary_key]["name"]
    secondary = TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else None
    canonical = f"{SITE_URL}/blog/{article['slug'].strip('/')}"
    tags = list(dict.fromkeys(
        [
            primary,
            TECHNOLOGIES[job.primary_key]["category"],
            ARTICLE_TYPE_LABELS[job.article_type],
            *( [secondary] if secondary else [] ),
            *article["tags"],
        ]
    ))

    schema = {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        "headline": article["title"],
        "description": article["description"],
        "datePublished": job.publication_date,
        "dateModified": job.publication_date,
        "author": {"@type": "Organization", "name": AUTHOR_NAME},
        "publisher": {"@type": "Organization", "name": SITE_NAME},
        "mainEntityOfPage": canonical,
        "image": f"{SITE_URL}{cover_path}",
        "keywords": tags,
        "about": [
            {"@type": "Thing", "name": primary},
            *([{"@type": "Thing", "name": secondary}] if secondary else []),
        ],
    }

    # Every article ships an FAQ section; declaring it makes the Q&A eligible
    # for FAQ rich results instead of being invisible structured content.
    faq_pairs = faq_pairs_from_body(article["body_markdown"], article.get("faq") or [])
    graph: list[dict[str, Any]] = [schema]
    if faq_pairs:
        graph.append({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntityOfPage": canonical,
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": item["question"],
                    "acceptedAnswer": {"@type": "Answer", "text": item["answer"]},
                }
                for item in faq_pairs
            ],
        })
    json_ld = graph if len(graph) > 1 else schema

    def yaml_string(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)

    lines = [
        "---",
        f"title: {yaml_string(article['title'])}",
        f"description: {yaml_string(article['description'])}",
        f"excerpt: {yaml_string(article['excerpt'])}",
        f"slug: {yaml_string(article['slug'])}",
        f"date: {yaml_string(job.publication_date)}",
        f"updated: {yaml_string(job.publication_date)}",
        f"author: {yaml_string(AUTHOR_NAME)}",
        f"category: {yaml_string(ARTICLE_TYPE_LABELS[job.article_type])}",
        f"primaryTechnology: {yaml_string(primary)}",
    ]
    if secondary:
        lines.append(f"secondaryTechnology: {yaml_string(secondary)}")
    lines.extend([
        f"searchIntent: {yaml_string(article['search_intent'])}",
        f"primaryKeyphrase: {yaml_string(article['primary_keyphrase'])}",
        "secondaryKeyphrases:",
        *[f"  - {yaml_string(item)}" for item in article["secondary_keyphrases"]],
        "tags:",
        *[f"  - {yaml_string(item)}" for item in tags],
        f"canonical: {yaml_string(canonical)}",
        f"image: {yaml_string(cover_path)}",
        "openGraph:",
        f"  title: {yaml_string(article['title'])}",
        f"  description: {yaml_string(article['description'])}",
        f"  image: {yaml_string(cover_path)}",
        "  type: article",
        f"jsonLd: {yaml_string(json.dumps(json_ld, ensure_ascii=False, separators=(',', ':')))}",
        "---",
        "",
    ])
    return "\n".join(lines)


def _frontmatter_field(markdown: str, field: str) -> str | None:
    match = re.match(r"---\n(.*?)\n---", markdown, flags=re.S)
    if not match:
        return None
    line = re.search(rf"^{field}:\s*(.+?)\s*$", match.group(1), flags=re.M)
    if not line:
        return None
    return line.group(1).strip().strip("\"'") or None


def import_existing_articles(conn: sqlite3.Connection) -> int:
    """Seed the dedup corpus with articles that exist outside the database:
    the committed site content and any factory output not yet recorded.
    Without this, a fresh checkout (or a deleted DB) would happily regenerate
    near-copies of already-published articles or reuse their slugs."""
    before = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    for root in (SITE_BLOG_DIR, OUTPUT_DIR / "articles"):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.md")):
            markdown = path.read_text(encoding="utf-8")
            slug = article_slug(_frontmatter_field(markdown, "slug") or path.stem)
            title = _frontmatter_field(markdown, "title") or slug
            conn.execute(
                """
                INSERT OR IGNORE INTO articles (
                    content_hash, title_hash, article_type, primary_tech, secondary_tech,
                    title, slug, description, tags_json, publication_date, body,
                    max_similarity, source_fingerprint, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'imported', ?)
                """,
                (
                    hashlib.sha256(clean_markdown_for_similarity(markdown).encode()).hexdigest(),
                    hashlib.sha256(slugify(title).encode()).hexdigest(),
                    _frontmatter_field(markdown, "category") or "imported",
                    _frontmatter_field(markdown, "primaryTechnology") or "unknown",
                    _frontmatter_field(markdown, "secondaryTechnology"),
                    title,
                    slug,
                    _frontmatter_field(markdown, "description") or "",
                    "[]",
                    _frontmatter_field(markdown, "date") or "1970-01-01",
                    markdown,
                    f"imported:{path.name}",
                    utc_now().isoformat(),
                ),
            )
    conn.commit()
    return conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0] - before


def save_article(
    conn: sqlite3.Connection,
    job: ArticleJob,
    article: dict[str, Any],
    markdown: str,
    similarity: float,
    source_fingerprint: str,
) -> Path:
    title = article["title"].strip()
    slug = article_slug(article["slug"])
    content_hash = hashlib.sha256(clean_markdown_for_similarity(markdown).encode()).hexdigest()
    title_hash = hashlib.sha256(slugify(title).encode()).hexdigest()

    article_folder = OUTPUT_DIR / "articles" / job.publication_date.replace("-", "/")
    article_folder.mkdir(parents=True, exist_ok=True)
    path = article_folder / f"{slug}.md"

    conn.execute(
        """
        INSERT INTO articles (
            content_hash, title_hash, article_type, primary_tech, secondary_tech,
            title, slug, description, tags_json, publication_date, body,
            max_similarity, source_fingerprint, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
        """,
        (
            content_hash,
            title_hash,
            job.article_type,
            job.primary_key,
            job.secondary_key,
            title,
            slug,
            article["description"],
            json.dumps(article["tags"], ensure_ascii=False),
            job.publication_date,
            markdown,
            similarity,
            source_fingerprint,
            utc_now().isoformat(),
        ),
    )
    conn.commit()
    path.write_text(markdown, encoding="utf-8")
    return path


def write_index(records: list[dict[str, Any]]) -> Path:
    index_path = OUTPUT_DIR / "batch-index.json"
    existing: list[dict[str, Any]] = []
    if index_path.exists():
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    # Slug is the published identity: a regenerated article must replace its
    # old entry instead of appending a second row for the same URL.
    merged: dict[str, dict[str, Any]] = {
        str(row.get("slug") or row.get("title")): row
        for row in existing + records
        if isinstance(row, dict)
    }
    combined = list(merged.values())
    combined.sort(key=lambda row: (row.get("publication_date", ""), row.get("title", "")))
    index_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
    return index_path


def prune_orphan_assets(dry_run: bool) -> tuple[list[Path], int]:
    """Report (and optionally delete) generated images no article references.

    Batches created before images were deferred left a cover/data pair behind
    for every failed or rejected attempt, and hydrate-blog copies each one into
    public/assets."""
    assets_root = OUTPUT_DIR / "assets"
    articles_root = OUTPUT_DIR / "articles"
    if not assets_root.is_dir():
        return [], 0

    referenced: set[str] = set()
    if articles_root.is_dir():
        for path in articles_root.rglob("*.md"):
            referenced.update(re.findall(r"/assets/[^\s)\"'\\\\]+", path.read_text(encoding="utf-8")))

    orphans = [
        path for path in sorted(assets_root.rglob("*"))
        if path.is_file() and f"/assets/{path.relative_to(assets_root).as_posix()}" not in referenced
    ]
    freed = sum(path.stat().st_size for path in orphans)
    if not dry_run:
        for path in orphans:
            path.unlink()
        for folder in sorted(assets_root.rglob("*"), reverse=True):
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
    return orphans, freed


# Articles that occupy a real archive slot. Imported rows count: a fresh
# checkout has committed site content but no rows this database published, and
# resuming onto those dates would double-book them. The date guard skips the
# 1970 sentinel import_existing_articles uses for undated files.
ARCHIVED = "status IN ('published', 'imported') AND publication_date > '1971-01-01'"


def next_archive_slot(conn: sqlite3.Connection, fallback: date) -> tuple[date, int]:
    """Resume the archive where it left off, returning the first date to use
    and how many of that date's five slots are already taken.

    Without this, a second batch silently republishes onto dates that are
    already full, because the default start date is always "six months ago"."""
    row = conn.execute(
        f"SELECT MAX(publication_date) FROM articles WHERE {ARCHIVED}"
    ).fetchone()
    if not row or not row[0]:
        return fallback, 0
    try:
        last = date.fromisoformat(str(row[0])[:10])
    except ValueError:
        return fallback, 0
    used = conn.execute(
        f"SELECT COUNT(*) FROM articles WHERE {ARCHIVED} AND publication_date = ?",
        (last.isoformat(),),
    ).fetchone()[0]
    if used >= ARTICLES_PER_DATE:
        return last + timedelta(days=1), 0
    return last, int(used)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate MadeWithWhat main-site editorial batches.")
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Valid (published) articles this batch must produce. Rejected or "
        "failed articles are replaced with fresh pairings until the target is met.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        help="Safety cap on generation attempts before giving up on the target. "
        "Default: 3x --count.",
    )
    parser.add_argument(
        "--start-date",
        help="First publication date (YYYY-MM-DD), or 'auto' to resume after the "
        "last date this database already published. Default: exactly six calendar "
        "months ago.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(os.getenv("FACTORY_CONCURRENCY", "1")),
        help="Articles to generate in parallel. Only the LLM wait overlaps: "
        "validation, dedup, and writes stay on the main thread and each slot "
        "keeps its seeded pairing, so publication dates stay gapless. Default: 1.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Deterministic editorial-plan seed.")
    parser.add_argument("--max-similarity", type=float, default=0.16)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the editorial plan and exit. Makes no API calls; still "
        "reads on-disk articles into the local dedup database so the resumed "
        "start date is accurate.",
    )
    parser.add_argument(
        "--prune-assets",
        action="store_true",
        help="Delete generated images under output/assets that no article "
        "references, then exit. Combine with --dry-run to list them first.",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Abort the batch on the first article failure instead of drawing a replacement.",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Deprecated no-op: continuing after failures is now the default (see --fail-fast).",
    )
    args = parser.parse_args()

    if args.prune_assets:
        orphans, freed = prune_orphan_assets(args.dry_run)
        verb = "Would remove" if args.dry_run else "Removed"
        for path in orphans:
            print(f"  {path.relative_to(OUTPUT_DIR)}")
        print(f"{verb} {len(orphans)} unreferenced asset(s), {freed / 1_048_576:.1f} MB")
        return

    if args.count < 1:
        die("--count must be at least 1")
    max_attempts = args.max_attempts if args.max_attempts is not None else args.count * 3
    if max_attempts < args.count:
        die("--max-attempts must be at least --count")
    if args.concurrency < 1:
        die("--concurrency must be at least 1")
    concurrency = min(args.concurrency, args.count)

    github_token = os.getenv("GITHUB_TOKEN")
    # Prefer the key matching the endpoint (mirrors youtube/enrich_transcripts.py):
    # both keys can coexist in .env without hijacking each other's runs.
    if LLM_BASE_URL and "openrouter" in LLM_BASE_URL:
        llm_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
    else:
        llm_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    if not github_token and not args.dry_run:
        die("GITHUB_TOKEN is missing from ../.env or ./.env")
    if not llm_key and not args.dry_run:
        die("An LLM key is missing from ../.env or ./.env: set OPENROUTER_API_KEY (or OPENAI_API_KEY)")

    default_date = date.today() - relativedelta(months=6)
    resume = not args.start_date or args.start_date == "auto"
    first_date = default_date if resume else date.fromisoformat(args.start_date)
    date_offset = 0

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    imported = import_existing_articles(conn)
    if resume:
        first_date, date_offset = next_archive_slot(conn, default_date)

    jobs = make_jobs(args.count, first_date, args.seed, date_offset)
    if args.dry_run:
        print(json.dumps([
            {
                **asdict(job),
                "primary": TECHNOLOGIES[job.primary_key]["name"],
                "secondary": TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else None,
                "category": TECHNOLOGIES[job.primary_key]["category"],
            }
            for job in jobs
        ], ensure_ascii=False, indent=2))
        conn.close()
        return

    similarity_index = SimilarityIndex(conn)
    print(
        f"Dedup corpus: {len(similarity_index)} articles "
        f"({imported} newly imported from disk)"
    )
    client = OpenAI(api_key=llm_key, base_url=LLM_BASE_URL)
    print(f"LLM: {LLM_MODEL}" + (f" via {LLM_BASE_URL}" if LLM_BASE_URL else " via OpenAI"))

    required_keys = {job.primary_key for job in jobs}
    required_keys.update(job.secondary_key for job in jobs if job.secondary_key)

    print(f"Fetching {len(required_keys)} canonical repositories...")
    repos: dict[str, RepoFacts] = {}
    for index, key in enumerate(sorted(required_keys), start=1):
        print(f"[repo {index}/{len(required_keys)}] {TECHNOLOGIES[key]['repo']}")
        repos[key] = fetch_repo(TECHNOLOGIES[key]["repo"], github_token)
        time.sleep(0.15)

    def ensure_repo(key: str) -> None:
        # Replacement pairings can involve repos outside the prefetched plan.
        if key not in repos:
            print(f"[repo] fetching {TECHNOLOGIES[key]['repo']}")
            repos[key] = fetch_repo(TECHNOLOGIES[key]["repo"], github_token)
            time.sleep(0.15)

    # Advisories back one article format in ten, so fetching them for every
    # batch spends a GitHub call (and 100 advisory bodies) most runs never use.
    advisories: list[Advisory] = []
    used_advisories: set[str] = set()

    def advisory_for(job: ArticleJob) -> Advisory | None:
        nonlocal advisories
        if job.article_type != "security-alert":
            return None
        if not advisories:
            print("Fetching recent GitHub security advisories...")
            advisories = fetch_security_advisories(github_token)
        return choose_advisory(advisories, job.primary_key, used_advisories)

    signatures = iter_signatures(args.seed)

    def prepare(slot: int) -> Candidate:
        job = job_for_slot(next(signatures), slot, first_date, date_offset)
        ensure_repo(job.primary_key)
        if job.secondary_key:
            ensure_repo(job.secondary_key)
        advisory = advisory_for(job)
        image_paths, cover_path, data_path = image_paths_for_job(job)
        label = f"{TECHNOLOGIES[job.primary_key]['name']} / {job.article_type}"
        if job.secondary_key:
            label += f" / {TECHNOLOGIES[job.secondary_key]['name']}"
        return Candidate(
            slot=slot,
            job=job,
            advisory=advisory,
            image_paths=image_paths,
            cover_path=cover_path,
            data_path=data_path,
            sources=article_sources(job, repos, advisory),
            prompt=build_editorial_prompt(job, repos, advisory, image_paths),
            label=label,
        )

    def generate(candidate: Candidate) -> dict[str, Any]:
        """Runs on a worker thread: LLM calls plus the pure finalise/validate
        passes. Touches nothing mutable that the main thread also writes."""
        def build(prompt: str) -> tuple[dict[str, Any], list[str]]:
            article = openai_generate(client, prompt)
            article = finalize_article(
                article, candidate.job, repos, candidate.sources, candidate.image_paths
            )
            return article, validate_article(article, candidate.job)

        article, errors = build(candidate.prompt)
        if errors:
            article, errors = build(
                f"{candidate.prompt}\n\nVALIDATION FAILURES TO FIX:\n- "
                + "\n- ".join(errors)
                + "\n\nRegenerate the complete JSON object. "
                "Every required section must be present in body_markdown."
            )
        if errors:
            raise ValueError("; ".join(errors))
        return article

    published = 0
    rejected = 0
    failed = 0
    attempts = 0
    index_records: list[dict[str, Any]] = []
    pending: deque[int] = deque(range(args.count))
    in_flight: dict[Future, Candidate] = {}
    interrupted = False

    def retry(candidate: Candidate) -> None:
        """Put the slot back at the head of the queue so publication dates stay
        a gapless run regardless of which attempt eventually fills it."""
        pending.appendleft(candidate.slot)

    executor = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="article")
    try:
        while published < args.count:
            while pending and len(in_flight) < concurrency and attempts < max_attempts:
                candidate = prepare(pending.popleft())
                attempts += 1
                print(
                    f"\n[attempt {attempts}, valid {published}/{args.count}] "
                    f"{candidate.label} — {candidate.job.publication_date}"
                )
                in_flight[executor.submit(generate, candidate)] = candidate

            if not in_flight:
                if attempts >= max_attempts:
                    print(
                        f"Giving up after {attempts} attempts: {published}/{args.count} "
                        "valid articles produced. Raise --max-attempts to keep trying.",
                        file=sys.stderr,
                    )
                break

            done, _ = wait(list(in_flight), return_when=FIRST_COMPLETED)
            for future in done:
                candidate = in_flight.pop(future)
                job = candidate.job
                try:
                    article = future.result()
                    frontmatter = render_frontmatter(
                        article, job, candidate.image_paths["LOCAL_COVER_PATH"]
                    )
                    markdown = frontmatter + article["body_markdown"].strip() + "\n"

                    similarity, similar_title = similarity_index.closest(markdown)
                    if similarity > args.max_similarity:
                        rejected += 1
                        retry(candidate)
                        print(
                            f"REJECTED near duplicate: {similarity:.3f} > "
                            f"{args.max_similarity:.3f}; closest={similar_title!r}"
                        )
                        continue

                    source_fingerprint = hashlib.sha256(
                        json.dumps(
                            {
                                "job": asdict(job),
                                "primary_updated": repos[job.primary_key].updated_at,
                                "secondary_updated": repos[job.secondary_key].updated_at if job.secondary_key else None,
                                "advisory": candidate.advisory.ghsa_id if candidate.advisory else None,
                            },
                            sort_keys=True,
                        ).encode()
                    ).hexdigest()

                    # Write the images first so a saved article can never
                    # reference a file that is missing, but roll them back if
                    # the insert fails — duplicate title/slug/content keys are
                    # a routine outcome here, and leaving the pair behind is
                    # what filled output/assets with orphans.
                    write_job_images(job, repos, candidate.cover_path, candidate.data_path)
                    try:
                        path = save_article(
                            conn, job, article, markdown, similarity, source_fingerprint
                        )
                    except BaseException:
                        discard_job_images(candidate.cover_path, candidate.data_path)
                        raise
                    similarity_index.add(article["title"], markdown)
                    published += 1
                    index_records.append({
                        "title": article["title"],
                        "slug": article["slug"],
                        "publication_date": job.publication_date,
                        "article_type": job.article_type,
                        "primary_technology": TECHNOLOGIES[job.primary_key]["name"],
                        "secondary_technology": (
                            TECHNOLOGIES[job.secondary_key]["name"] if job.secondary_key else None
                        ),
                        "tags": article["tags"],
                        "path": str(path),
                        "cover_image": str(candidate.cover_path),
                        "similarity": round(similarity, 4),
                    })
                    print(f"SAVED {path}")
                except sqlite3.IntegrityError as exc:
                    conn.rollback()
                    rejected += 1
                    retry(candidate)
                    print(f"REJECTED duplicate database key: {exc}")
                except Exception as exc:
                    failed += 1
                    retry(candidate)
                    print(f"FAILED [{candidate.label}]: {exc}", file=sys.stderr)
                    if args.fail_fast:
                        raise
    except KeyboardInterrupt:
        interrupted = True
        print("\nInterrupted — writing the batch index for what was saved.", file=sys.stderr)
    finally:
        for future in in_flight:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        conn.close()

    index_path = write_index(index_records)
    result = {
        "requested": args.count,
        "published": published,
        "rejected": rejected,
        "failed": failed,
        "attempts": attempts,
        "interrupted": interrupted,
        "concurrency": concurrency,
        "first_publication_date": index_records[0]["publication_date"] if index_records else first_date.isoformat(),
        "last_publication_date": index_records[-1]["publication_date"] if index_records else first_date.isoformat(),
        "articles_per_date": ARTICLES_PER_DATE,
        "output_directory": str(OUTPUT_DIR.resolve()),
        "batch_index": str(index_path.resolve()),
        "database": str(DB_PATH.resolve()),
        "model": LLM_MODEL,
        "llm_calls": TOKEN_USAGE["calls"],
        "prompt_tokens": TOKEN_USAGE["prompt"],
        "completion_tokens": TOKEN_USAGE["completion"],
    }
    print("\n" + json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
