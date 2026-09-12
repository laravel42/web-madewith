#!/usr/bin/env python3
"""
MadeWithWhat Project Discovery Worker
=====================================

A single continuously-running cycle:

    1. Discover a new GitHub repository for one of the catalog technologies
       (one not already in the catalog).
    2. Scrape it into the catalog — db.upsert_repository() writes the full
       repositories row plus topics/languages/metrics/technology link.
    3. Analyze it: the project's own website first when it has one, falling
       back to the repository codebase (README + metadata).
    4. Write a ~500-word SEO-optimized project README in Markdown (Introduction,
       Key Features, Ecosystem and Community, Use Cases, Roadmap and Future
       Development, Conclusion) and store it on the repository. It renders in
       the project page's README/About block; the templated long1/long2 stay
       as the fallback for projects that don't have one yet.
    5. Start over.

Publishing is deliberately NOT part of this loop — workers/utils/redeploy_worker.py
rebuilds and deploys on its own schedule, so discovery isn't blocked behind a
multi-minute site build.

The description is stored in `repositories.metadata.generated_description`,
beside (not inside) the `raw` GitHub payload, so a later re-scrape that
refreshes `raw` can't wipe it — `_build_repo_metadata` preserves unknown
metadata keys and the UPDATE merges with `||`.

Fault-tolerant: every cycle is wrapped in a broad try/except that logs and
continues, so one bad repo, one unreachable homepage, or one LLM hiccup never
stops the worker. Ctrl+C still exits (KeyboardInterrupt isn't an Exception).

Usage:
    workers/.venv/bin/python workers/projects/discovery_worker.py
    workers/.venv/bin/python workers/projects/discovery_worker.py --once
    workers/.venv/bin/python workers/projects/discovery_worker.py --dry-run
    workers/.venv/bin/python workers/projects/discovery_worker.py --domain laravel
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import subprocess
import sys
import time
import traceback
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from openai import OpenAI

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent

# override=True: this repo's .env is the source of truth for LLM credentials.
# A stale shell OPENAI_API_KEY/OPENAI_BASE_URL (e.g. left over from routing
# another tool through OpenRouter) otherwise wins silently and sends requests
# to the wrong provider — see workers/posts/content_factory.py's same note.
load_dotenv(REPO_ROOT / ".env", override=True)

sys.path.insert(0, str(BASE_DIR))
from madewith_scraper import db  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("project-discovery")

DOMAIN_CATALOG_PATH = REPO_ROOT / "src" / "config" / "domain-catalog.json"
GITHUB_API = "https://api.github.com"
GITHUB_API_VERSION = os.getenv("GITHUB_API_VERSION", "2022-11-28")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "45"))

WEBSITE_MAX_CHARS = 8_000
README_MAX_CHARS = 8_000
TARGET_WORDS = 500
# Length is scaled to the grounding source. Asking for 500 words about a repo
# whose entire README is 200 words leaves the model nothing to do but invent —
# the worst audit results came from exactly those repos.
# Six mandatory sections have a floor of roughly 350 words before they stop
# being sections, so the thin tier is calibrated to that rather than to an
# arbitrary smaller number: at a 320-word target the model overshot on every
# attempt and the repo ended up with no description at all.
LENGTH_TIERS = [
    (1_200, 350),   # under 1.2k chars of source → 350 words
    (3_500, 420),   # under 3.5k                 → 420 words
]
WORD_TOLERANCE = 0.30  # retry the model when it strays this far from TARGET_WORDS
# The one-line abstract under the project title. GitHub descriptions are often
# truncated, tag-stuffed or emoji-led; this rewrites them as a clean sentence
# without inventing anything the original didn't say.
ABSTRACT_MAX_CHARS = 300
ABSTRACT_MIN_CHARS = 140

# Rendered as Markdown in the project page's README/About block
# (src/components/ProjectDetail.astro).
SECTIONS = [
    "Introduction",
    "Key Features",
    "Ecosystem and Community",
    "Use Cases",
    "Roadmap and Future Development",
    "Conclusion",
]
SLEEP_BETWEEN_CYCLES = int(os.getenv("DISCOVERY_SLEEP_SECONDS", "20"))
SLEEP_AFTER_ERROR = int(os.getenv("DISCOVERY_ERROR_SLEEP_SECONDS", "60"))
# Six sections, a scaled word budget, no invented facts, no leaked context: more
# constraints means more rejected drafts, and each retry now carries feedback.
LLM_MAX_RETRIES = int(os.getenv("DISCOVERY_MAX_RETRIES", "6"))
PUBLISH_TIMEOUT = int(os.getenv("DISCOVERY_PUBLISH_TIMEOUT", "600"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.3"))
LLM_TOP_P = float(os.getenv("LLM_TOP_P", "0.9"))

LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_BASE_URL = os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1"


def die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


# --- GitHub -------------------------------------------------------------------

def github_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "MadeWithWhat-ProjectDiscovery/1.0",
    }


def gh_get(path: str, token: str, *, params: dict[str, Any] | None = None,
           allow_404: bool = False, accept: str | None = None) -> requests.Response | None:
    url = path if path.startswith("http") else f"{GITHUB_API}{path}"
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
                delay = min(60, 2**attempt)
            log.info("GitHub throttled; retrying in %ds", delay)
            time.sleep(delay)
            continue
        if response.status_code >= 500:
            time.sleep(min(30, 2**attempt))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError(f"GitHub request failed after retries: {url}")


def load_domains() -> list[dict[str, Any]]:
    return json.loads(DOMAIN_CATALOG_PATH.read_text(encoding="utf-8"))


def search_repositories(domain: dict[str, Any], token: str) -> list[dict[str, Any]]:
    scrape = domain["scrape"]
    query = f"{scrape['query']} stars:>={scrape.get('minStars', 20)} archived:false"
    response = gh_get(
        "/search/repositories",
        token,
        params={"q": query, "sort": "updated", "order": "desc", "per_page": 40},
    )
    assert response is not None
    return response.json().get("items", [])


def known_full_names(conn, domain_slug: str) -> set[str]:
    """Everything already catalogued for this technology — the repos worth
    discovering are the ones the scrape pipeline hasn't picked up yet."""
    return {(r.get("full_name") or "").lower() for r in db.load_repos_for_slug(conn, domain_slug)}


def has_description(conn, full_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT metadata->'generated_description' AS gd FROM repositories WHERE lower(full_name) = lower(%s)",
            (full_name,),
        )
        row = cur.fetchone()
    return bool(row and row.get("gd"))


def pick_candidate(domain: dict[str, Any], token: str, conn) -> dict[str, Any] | None:
    known = known_full_names(conn, domain["slug"])
    excluded = {e.lower() for e in domain["scrape"].get("exclude", [])}
    for item in search_repositories(domain, token):
        full_name = item["full_name"]
        if full_name.lower() in known or full_name.lower() in excluded:
            continue
        if item.get("fork") or item.get("archived"):
            continue
        return item
    return None


def enrich_repo(item: dict[str, Any], token: str) -> dict[str, Any]:
    """Fill in the fields upsert_repository wants that search results omit
    (languages, full topic list, README for the fallback analysis)."""
    full_name = item["full_name"]
    repo = dict(item)

    langs_response = gh_get(f"/repos/{full_name}/languages", token, allow_404=True)
    if langs_response is not None:
        by_bytes = langs_response.json()
        repo["_langs"] = [{"name": name, "size": size} for name, size in by_bytes.items()]

    readme_response = gh_get(
        f"/repos/{full_name}/readme", token, allow_404=True, accept="application/vnd.github.raw+json"
    )
    repo["_readme"] = readme_response.text[:README_MAX_CHARS] if readme_response is not None else ""

    # "Last updated" on the site is the default-branch tip commit, which is what
    # repositories.pushed_at is defined to hold. GitHub's own `pushed_at` counts
    # activity on ANY branch, so a push to a stale feature branch would show the
    # project as freshly updated. Overwrite it with the real tip date.
    branch = repo.get("default_branch") or "main"
    commits = gh_get(f"/repos/{full_name}/commits", token, allow_404=True,
                     params={"sha": branch, "per_page": 1})
    if commits is not None:
        try:
            payload = commits.json()
            commit = (payload[0] if isinstance(payload, list) and payload else {}).get("commit") or {}
            tip = (commit.get("committer") or {}).get("date") or (commit.get("author") or {}).get("date")
            if tip:
                if tip != repo.get("pushed_at"):
                    log.info("[2/6] scrape: tip commit on %s is %s (GitHub pushed_at was %s)",
                              branch, tip, repo.get("pushed_at"))
                repo["pushed_at"] = tip
        except (ValueError, KeyError, IndexError, TypeError) as exc:  # noqa: BLE001
            log.info("could not read tip commit for %s (%s); keeping GitHub pushed_at", full_name, exc)
    return repo


# --- Analysis: website first, codebase as fallback ---------------------------

class _VisibleTextExtractor(HTMLParser):
    """Minimal, dependency-free HTML-to-text: drops script/style/nav/footer and
    keeps the rest. This is LLM context, not a faithful rendering."""

    SKIP_TAGS = {"script", "style", "nav", "footer", "svg", "noscript"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self.chunks.append(data.strip())

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.chunks)).strip()


def fetch_website_text(url: str | None) -> str | None:
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    if "github.com" in url:
        return None
    try:
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0 (compatible; MadeWithWhatBot/1.0)"},
            allow_redirects=True,
        )
        response.raise_for_status()
        if "text/html" not in response.headers.get("Content-Type", ""):
            return None
        parser = _VisibleTextExtractor()
        parser.feed(response.text)
        text = parser.text()
        return text[:WEBSITE_MAX_CHARS] if len(text) > 200 else None
    except Exception as exc:  # noqa: BLE001 — a dead site must not stop the cycle
        log.info("website fetch failed for %s: %s", url, exc)
        return None


def build_context(repo: dict[str, Any]) -> tuple[str, str]:
    """Returns (context_text, source_label)."""
    website_text = fetch_website_text(repo.get("homepage"))
    if website_text:
        return website_text, "project website"
    topics = ", ".join(repo.get("topics") or []) or "none listed"
    summary = (
        f"Repository: {repo.get('full_name')}\n"
        f"Description: {repo.get('description') or '(none)'}\n"
        f"Primary language: {repo.get('language') or 'Unknown'}\n"
        f"Topics: {topics}\n\n"
        f"README:\n{repo.get('_readme') or '(no README found)'}"
    )
    return summary, "repository codebase (README + metadata)"


# --- Generation ---------------------------------------------------------------

def target_words_for(context_text: str) -> int:
    """How many words the source can actually support."""
    n = len(context_text or "")
    for limit, words in LENGTH_TIERS:
        if n < limit:
            return words
    return TARGET_WORDS


def build_prompt(repo: dict[str, Any], domain: dict[str, Any], context_text: str, source_label: str,
                  target: int) -> str:
    return f"""You are writing the description shown on a project page in the
{domain['techName']} gallery of MadeWithWhat, a directory of open-source projects.

PROJECT
- Name: {repo.get('name')} ({repo.get('full_name')})
- Catalogued in: the {domain['techName']} gallery (a directory grouping, NOT a
  statement that this project uses, depends on, or is built on {domain['techName']})
- Stars: {repo.get('stargazers_count') or 0}
- Topics: {', '.join(repo.get('topics') or []) or 'none listed'}

GROUNDING SOURCE ({source_label})
###
{context_text}
###

TASK
Write a {target}-word SEO-optimized project README in Markdown, using
EXACTLY these six H1 headings, in this order, and no others:

{chr(10).join(f'# {s}' for s in SECTIONS)}

RULES
1. SEO is the primary goal. Work in the natural keyword phrases a developer
   would search for — the project name, what it does, its category — into the
   opening sentence of each section and throughout the prose. Mention
   {domain['techName']} only where the source supports a real connection.
   Never keyword-stuff: it must read as useful writing first.
2. The first two sentences under "# Introduction" carry the most search weight:
   lead with what the project is, what it does, and who it's for.
3. Use only facts from the GROUNDING SOURCE and PROJECT facts above. Never
   invent features, adoption numbers, benchmarks, or contributor counts. Do not
   name specific model, product or library versions unless the source names
   them.
3b. NEVER state or imply that the project is built on, built with, powered by,
   an extension of, or a fork of {domain['techName']} unless the GROUNDING
   SOURCE says so explicitly. The gallery is a directory category, not a
   dependency. If the source does not establish the relationship, describe the
   project on its own terms and do not mention {domain['techName']} as its
   foundation.
4. "Roadmap and Future Development" must be framed as what's stated or
   plausible, never asserted as fact unless the source states it. If the
   source says nothing about plans, keep that section short and honest.
5. Prose paragraphs under each heading. Short bullet lists are fine in
   "Key Features" and "Use Cases" where they genuinely help scanning.
6. Total length: {target} words (+/- 15%) across all six sections. Do not pad:
   if the source is thin, write shorter sections rather than inventing material.
7. Output ONLY the Markdown, starting with "# Introduction". No frontmatter,
   no preamble, no code fence around the whole thing.
8. Never mention MadeWithWhat, "the gallery", "the directory", or the fact that
   the project is catalogued anywhere. That is our context, not the project's
   story. Write as if the reader arrived at the project itself.
9. Do not name the author, their other projects, their employer or their
   biography. Nothing about the maintainer beyond the repository owner name.
10. Never state a star, fork, download or user count in the prose — those
   numbers are rendered separately and go stale the moment they are written.
11. Do not explain or assess your own work. No word counts, no notes on how the
   rules were followed, no "Breakdown" or "Notes" section. The output ends with
   the last sentence of "# Conclusion".
"""


def call_llm(client: OpenAI, prompt: str) -> str:
    kwargs: dict[str, Any] = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2200,
        # The default of 1.0 was producing confabulated proper nouns and
        # mid-sentence collapse into other scripts. This is grounded factual
        # writing, not creative work — sample conservatively.
        "temperature": LLM_TEMPERATURE,
        "top_p": LLM_TOP_P,
    }
    try:
        response = client.chat.completions.create(**kwargs)
    except Exception as exc:  # noqa: BLE001
        # Newer OpenAI model families reject `max_tokens` and want
        # `max_completion_tokens`; most other OpenAI-compatible endpoints only
        # accept the former. Adapt rather than hard-coding one per endpoint.
        if "max_tokens" in str(exc) and "max_completion_tokens" in str(exc):
            kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")
            response = client.chat.completions.create(**kwargs)
        else:
            raise
    if response.choices[0].finish_reason == "length":
        raise ValueError("description cut off at token limit")
    return (response.choices[0].message.content or "").strip()


# Trailing meta-commentary the model adds after the README itself — a report on
# how it followed the brief ("**Breakdown**: word count…"). It rendered on the
# page as if it were part of the project description.
# The brief asks for English prose. Letters from scripts it would never need are
# the signature of a model coming apart mid-generation — one README dissolved
# into Cyrillic and CJK fragments halfway through. Counted, not measured as a
# ratio: four stray Cyrillic letters in 4,000 characters is already broken, and
# a ratio that low would fire on a single legitimate foreign proper noun.
SCRIPT_NOISE = re.compile(
    r"[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF"
    r"\u0900-\u097F\u0B80-\u0BFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF"
    r"\u4E00-\u9FFF\uAC00-\uD7AF]"
)

# Things the audit caught leaking into the copy: our own directory, and counts
# that are rendered separately and go stale in prose.
LEAKED_CONTEXT = re.compile(
    r"(MadeWithWhat|\bthe (?:gallery|directory)\b|catalogued in|catalogued on|"
    r"[\d,]{2,}\s*(?:GitHub\s*)?(?:stars|forks|downloads|users))",
    re.IGNORECASE,
)

META_TAIL = re.compile(
    r"^\s*(?:\*\*|##?#?\s*)?(?:breakdown|notes?|note to|summary of (?:changes|approach)|"
    r"word count|compliance|rationale|explanation|how (?:this|i) (?:meets|follows))\b",
    re.IGNORECASE,
)


def clean_markdown(raw: str) -> str:
    """Models wrap the answer in prose on both sides: a preface ("Here's the
    README:") and/or a ```markdown fence before it, and a self-assessment after
    it. Neither is anchored to the string ends, so cut to the first real heading
    and drop everything from the first meta marker that follows the content."""
    text = raw.strip()
    match = re.search(r"^#\s*Introduction\s*$", text, flags=re.MULTILINE)
    if match:
        text = text[match.start():]

    lines = text.splitlines()
    # An unbalanced ``` means the model fenced the whole document; everything
    # from that closing fence onward is wrapper, not content.
    fences = [i for i, l in enumerate(lines) if l.strip().startswith("```")]
    if len(fences) % 2 == 1:
        lines = lines[:fences[-1]]

    # Cut at trailing meta-commentary, but only after the last real section so a
    # legitimate "## Notes" inside the body survives.
    last_heading = max((i for i, l in enumerate(lines)
                        if re.match(rf"^#+\s*{re.escape(SECTIONS[-1])}\s*$", l.strip())), default=-1)
    for i in range(max(last_heading, 0), len(lines)):
        if META_TAIL.match(lines[i]):
            lines = lines[:i]
            break

    text = "\n".join(lines).strip()
    text = re.sub(r"\n+(?:---|\*\*\*)\s*$", "", text)  # dangling rule left by the cut
    # Stray HTML tags (an unmatched </div> once broke the detail page's grid).
    # The site strips these at render time too; keeping the stored copy clean
    # means the database never holds markup that only renders by luck.
    text = re.sub(r"</?[a-zA-Z][^>\n]{0,80}>", "", text)
    return text.strip()


def body_word_count(markdown: str) -> int:
    """Prose words only — headings and list markers aren't the 500 the brief
    is about."""
    lines = [l for l in markdown.splitlines() if not l.lstrip().startswith("#")]
    body = " ".join(lines)
    body = re.sub(r"^[\s>*-]+", " ", body, flags=re.MULTILINE)
    return len(body.split())


def validate_markdown(markdown: str, low: int, high: int) -> str | None:
    """The single definition of an acceptable README. Returns the problem, or
    None when the text is usable — also used to judge an already-stored copy."""
    missing = [s for s in SECTIONS if not re.search(rf"^#+\s*{re.escape(s)}\s*$", markdown, re.MULTILINE)]
    if missing:
        return f"missing headings: {missing}"
    if META_TAIL.search(markdown):
        return "output contains commentary about the brief"
    noise = SCRIPT_NOISE.findall(markdown)
    if len(noise) >= 3:
        return (f"output contains {len(noise)} characters from unexpected scripts "
                f"({''.join(sorted(set(noise))[:8])}) — the model degenerated into mixed-language text")
    words = body_word_count(markdown)
    if not low <= words <= high:
        return f"README is {words} body words, wanted {low}-{high}"
    return None


def drop_unusable_description(conn, full_name: str, low: int, high: int) -> bool:
    """Remove a stored README that no longer passes validation.

    When generation fails for a repo that already has a bad description on file,
    keeping it would leave degenerate text on the page indefinitely. The site
    falls back to the templated long1/long2 when this key is absent, which is a
    worse page but an honest one.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT metadata FROM repositories WHERE lower(full_name)=lower(%s)", (full_name,))
        row = cur.fetchone()
        if not row:
            return False
        # db.connect() uses psycopg's dict_row factory — rows are mappings.
        meta = row["metadata"] if isinstance(row, dict) else row[0]
        meta = json.loads(meta) if isinstance(meta, str) else (meta or {})
        stored = (meta.get("generated_description") or {}).get("markdown")
        if not stored or not validate_markdown(stored, low, high):
            return False
        cur.execute(
            """UPDATE repositories
                  SET metadata = (COALESCE(metadata::jsonb,'{}'::jsonb) - 'generated_description')::json,
                      updated_at = NOW()
                WHERE lower(full_name) = lower(%s)""",
            (full_name,),
        )
    conn.commit()
    return True


def generate_readme(repo: dict[str, Any], domain: dict[str, Any], client: OpenAI,
                     context_text: str, source_label: str) -> str:
    target = target_words_for(context_text)
    prompt = build_prompt(repo, domain, context_text, source_label, target)
    last_exc: Exception | None = None
    low = int(target * (1 - WORD_TOLERANCE))
    high = int(target * (1 + WORD_TOLERANCE))
    # Retrying the identical prompt just reproduces the same overshoot — a model
    # that wrote 978 words writes ~978 again. Each retry is told what went wrong.
    correction = ""

    for attempt in range(LLM_MAX_RETRIES):
        try:
            markdown = clean_markdown(call_llm(client, prompt + correction))
            if not markdown:
                raise ValueError("model returned no usable text")
            leak = LEAKED_CONTEXT.search(markdown)
            if leak:
                raise ValueError(f"mentions our directory or a star count: {leak.group(0)!r}")
            problem = validate_markdown(markdown, low, high)
            if problem:
                raise ValueError(problem)
            return markdown
        except ValueError as exc:
            last_exc = exc
            detail = str(exc)
            if "body words" in detail:
                words = int(re.search(r"is (\d+) body", detail).group(1))
                verb = "far too long" if words > high else "too short"
                correction = (
                    f"\n\nIMPORTANT — your previous attempt was rejected: it ran to {words} words of prose, "
                    f"which is {verb}. Rewrite it with between {low} and {high} words of prose "
                    f"(headings and list markers do not count), targeting {target}. "
                    "Keep all six headings; cut detail from the longest sections rather than dropping a section."
                )
            elif "missing headings" in detail:
                correction = (
                    f"\n\nIMPORTANT — your previous attempt was rejected: {detail}. "
                    "Emit every heading exactly as given, each on its own line as a level-1 heading."
                )
            elif "directory or a star count" in detail:
                correction = (
                    f"\n\nIMPORTANT — your previous attempt was rejected: {detail} "
                    "Remove every mention of MadeWithWhat, of any gallery or directory, of being "
                    "catalogued anywhere, and every star/fork/download count. Write only about the "
                    "project itself."
                )
            elif "unexpected scripts" in detail:
                correction = (
                    "\n\nIMPORTANT — your previous attempt was rejected: it drifted into another "
                    "language mid-text. Write the entire response in English."
                )
            delay = min(30, 2**attempt)
            log.info("LLM attempt %d/%d failed (%s); retrying in %ds",
                      attempt + 1, LLM_MAX_RETRIES, exc, delay)
            time.sleep(delay)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
            if status in {400, 401, 403, 404}:
                raise
            delay = min(30, 2**attempt)
            log.info("LLM attempt %d/%d failed (%s); retrying in %ds",
                      attempt + 1, LLM_MAX_RETRIES, exc, delay)
            time.sleep(delay)
    raise RuntimeError(f"README generation failed after {LLM_MAX_RETRIES} attempts: {last_exc}")


def build_abstract_prompt(repo: dict[str, Any], context_text: str, source_label: str) -> str:
    original = (repo.get("description") or "").strip()
    return f"""Rewrite the one-sentence abstract for the open-source project "{repo.get('full_name')}".

Original GitHub description:
\"\"\"{original or '(none provided)'}\"\"\"

Supporting context from the project's {source_label}:
\"\"\"{context_text[:4000]}\"\"\"

Rules:
- Preserve the meaning of the original description. Do not introduce features,
  claims or technologies it does not support. The context is there to clarify
  wording, not to add new material.
- HARD LIMIT: at most {ABSTRACT_MAX_CHARS} characters, and at least
  {ABSTRACT_MIN_CHARS}. Count characters, not words.
- One or two plain sentences. No markdown, no emoji, no bullet points, no
  surrounding quotes, no "This project..." preamble, no trailing hashtags.
- Lead with what the project is and what it does, in the third person.
- Write in English regardless of the original's language.

Return the abstract text only, with nothing before or after it."""


def clean_abstract(raw: str) -> str:
    """Strip the wrappers models add around a bare sentence: fences, quotes,
    an "Abstract:" label, markdown emphasis and trailing whitespace."""
    text = (raw or "").strip()
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    text = re.sub(r"^(abstract|description|rewritten abstract)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = text.strip().strip('"\u201c\u201d\'')
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def generate_abstract(repo: dict[str, Any], client: OpenAI,
                       context_text: str, source_label: str) -> str:
    prompt = build_abstract_prompt(repo, context_text, source_label)
    last_exc: Exception | None = None
    correction = ""
    for attempt in range(LLM_MAX_RETRIES):
        try:
            text = clean_abstract(call_llm(client, prompt + correction))
            if not text:
                raise ValueError("model returned no usable text")
            if len(text) > ABSTRACT_MAX_CHARS:
                raise ValueError(f"abstract is {len(text)} chars, max {ABSTRACT_MAX_CHARS}")
            if len(text) < ABSTRACT_MIN_CHARS:
                raise ValueError(f"abstract is {len(text)} chars, min {ABSTRACT_MIN_CHARS}")
            if "\n" in text:
                raise ValueError("abstract must be a single paragraph")
            return text
        except ValueError as exc:
            last_exc = exc
            detail = str(exc)
            if "chars" in detail:
                correction = (
                    f"\n\nIMPORTANT — your previous attempt was rejected: {detail}. "
                    f"Rewrite it between {ABSTRACT_MIN_CHARS} and {ABSTRACT_MAX_CHARS} characters."
                )
            delay = min(30, 2**attempt)
            log.info("abstract attempt %d/%d failed (%s); retrying in %ds",
                      attempt + 1, LLM_MAX_RETRIES, exc, delay)
            time.sleep(delay)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
            if status in {400, 401, 403, 404}:
                raise
            delay = min(30, 2**attempt)
            log.info("abstract attempt %d/%d failed (%s); retrying in %ds",
                      attempt + 1, LLM_MAX_RETRIES, exc, delay)
            time.sleep(delay)
    raise RuntimeError(f"abstract generation failed after {LLM_MAX_RETRIES} attempts: {last_exc}")


# --- Persistence ---------------------------------------------------------------

def store_description(conn, full_name: str, markdown: str, *, source_label: str,
                       abstract: str | None = None) -> None:
    """Merged into repositories.metadata beside `raw`, so a later re-scrape
    refreshing `raw` leaves it intact."""
    now = datetime.now(UTC).isoformat()
    payload: dict[str, Any] = {
        "generated_description": {
            "markdown": markdown,
            "source": source_label,
            "model": LLM_MODEL,
            "words": body_word_count(markdown),
            "generated_at": now,
        }
    }
    if abstract:
        payload["generated_abstract"] = {
            "text": abstract,
            "source": source_label,
            "model": LLM_MODEL,
            "chars": len(abstract),
            "generated_at": now,
        }
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE repositories
               SET metadata = (COALESCE(metadata::jsonb, '{}'::jsonb) || %s::jsonb)::json,
                   updated_at = NOW()
             WHERE lower(full_name) = lower(%s)
            """,
            (json.dumps(payload), full_name),
        )
    conn.commit()


def publish_domain(slug: str) -> bool:
    """Regenerate src/data/<slug>.json from Postgres for the domain just written.

    Runs publish.py as a subprocess: it loads its own .env and opens its own
    connection, and importing it here would run that at import time. Publishing
    only (no build, no deploy) — the redeploy worker owns that half of the job.
    """
    script = Path(__file__).resolve().parent / "publish.py"
    try:
        result = subprocess.run(
            [sys.executable, str(script), slug],
            cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=PUBLISH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        log.error("publish timed out after %ds for domain=%s", PUBLISH_TIMEOUT, slug)
        return False
    if result.returncode != 0:
        log.error("publish failed for domain=%s (exit %d): %s",
                  slug, result.returncode, (result.stderr or result.stdout).strip()[-500:])
        return False
    summary = next((l.strip() for l in reversed(result.stdout.splitlines()) if l.strip()), "")
    log.info("[6/6] publish: src/data/%s.json rewritten (%s)", slug, summary)
    return True


# --- One cycle -----------------------------------------------------------------

def run_one_cycle(*, github_token: str, client: OpenAI, conn,
                   domains: list[dict[str, Any]], forced_domain_slug: str | None, dry_run: bool,
                   target_repo: str | None = None, publish: bool = True) -> bool:
    domain = (
        next(d for d in domains if d["slug"] == forced_domain_slug)
        if forced_domain_slug
        else random.choice(domains)
    )

    if target_repo:
        # Regenerate a project already in the catalog: skip discovery, which only
        # ever returns repos that have no description yet.
        log.info("[1/6] discover: targeting existing repo=%s", target_repo)
        response = gh_get(f"/repos/{target_repo}", github_token, allow_404=True)
        candidate = response.json() if response is not None else None
        if not candidate or not candidate.get("full_name"):
            log.error("repo %s not found on GitHub", target_repo)
            return False
    else:
        log.info("[1/6] discover: searching domain=%s", domain["slug"])
        candidate = pick_candidate(domain, github_token, conn)
        if candidate is None:
            log.info("[1/6] discover: no new repository in domain=%s this cycle", domain["slug"])
            return False

    full_name = candidate["full_name"]
    if not target_repo:
        log.info("[1/6] discover: candidate=%s (%s stars)", full_name, candidate.get("stargazers_count"))

    repo = enrich_repo(candidate, github_token)

    if dry_run:
        log.info("[2/6] scrape: [dry-run] would upsert %s into domain=%s", full_name, domain["slug"])
    else:
        action = db.upsert_repository(conn, domain["slug"], repo)
        log.info("[2/6] scrape: %s %s into domain=%s", action, full_name, domain["slug"])
        if action == "skipped":
            log.info("skipped (no technologies row for %s) — nothing to describe", domain["slug"])
            return True

    context_text, source_label = build_context(repo)
    log.info("[3/6] analyze: grounding source=%s (%d chars)", source_label, len(context_text))

    try:
        markdown = generate_readme(repo, domain, client, context_text, source_label)
    except RuntimeError as exc:
        log.error("[4/6] describe: giving up on %s — %s", full_name, exc)
        target = target_words_for(context_text)
        if not dry_run and drop_unusable_description(
                conn, full_name, int(target * (1 - WORD_TOLERANCE)), int(target * (1 + WORD_TOLERANCE))):
            log.info("[4/6] describe: removed the unusable stored README; the page "
                      "falls back to the templated description")
            if publish:
                publish_domain(domain["slug"])
        return True
    log.info("[4/6] describe: %d body words across %d sections",
              body_word_count(markdown), len(SECTIONS))

    # A failed abstract must not discard a good README: the README is the
    # expensive half of the cycle, and big-AGI lost a clean 600-word rewrite
    # because the one-line abstract came in 23 characters over budget.
    try:
        abstract = generate_abstract(repo, client, context_text, source_label)
        log.info("[5/6] abstract: %d chars (was %d)", len(abstract), len(repo.get("description") or ""))
    except RuntimeError as exc:
        abstract = None
        log.error("[5/6] abstract: giving up — %s (keeping the README, leaving the "
                  "original GitHub description in place)", exc)

    if dry_run:
        log.info("[dry-run] not storing:\n\nABSTRACT: %s\n\n%s", abstract or "(failed)", markdown)
        return True

    store_description(conn, full_name, markdown, source_label=source_label, abstract=abstract)
    log.info("stored description for %s", full_name)

    if publish:
        publish_domain(domain["slug"])
    else:
        log.info("[6/6] publish: skipped (--no-publish)")

    log.info("project page (after next redeploy): %s/%s/project/%s/",
              os.getenv("SITE_URL", "https://madewithwhat.net").rstrip("/"),
              domain["slug"],
              re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", (repo.get("name") or "").lower())))
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="MadeWithWhat project discovery worker")
    parser.add_argument("--once", action="store_true", help="Run a single cycle then exit.")
    parser.add_argument("--dry-run", action="store_true",
                         help="Discover + generate but write nothing to the database.")
    parser.add_argument("--domain", default=None, help="Force a domain slug instead of a random pick.")
    parser.add_argument("--no-publish", action="store_true",
                        help="Skip rewriting src/data/<slug>.json after storing. Never builds or deploys either way.")
    parser.add_argument("--repo", default=None,
                        help="Regenerate one existing repo (owner/name) instead of discovering a new one. Implies --once.")
    args = parser.parse_args()

    github_token = os.getenv("GITHUB_TOKEN")
    if not github_token:
        die("GITHUB_TOKEN is missing from .env")
    if not LLM_API_KEY:
        die("An LLM key is missing from .env: set LLM_API_KEY (or OPENAI_API_KEY)")
    if os.getenv("LLM_API_KEY") and not os.getenv("LLM_BASE_URL"):
        die("LLM_API_KEY is set but LLM_BASE_URL is not — set both (e.g. LLM_BASE_URL=https://llm.laravel42.com/v1)")

    # default_headers: the llm.laravel42.com edge blocks the openai-python
    # SDK's own User-Agent with a bare 403; any other UA is fine.
    client = OpenAI(
        api_key=LLM_API_KEY,
        base_url=LLM_BASE_URL,
        default_headers={"User-Agent": "MadeWithWhat-ProjectDiscovery/1.0"},
    )
    domains = load_domains()
    if args.domain and not any(d["slug"] == args.domain for d in domains):
        die(f"unknown domain slug: {args.domain}")

    if args.repo:
        args.once = True
    conn = db.connect()
    log.info("project discovery worker starting (model=%s via %s)", LLM_MODEL, LLM_BASE_URL)

    try:
        while True:
            try:
                run_one_cycle(
                    github_token=github_token,
                    client=client,
                    conn=conn,
                    domains=domains,
                    forced_domain_slug=args.domain,
                    dry_run=args.dry_run,
                    target_repo=args.repo,
                    publish=not args.no_publish,
                )
            except Exception:
                log.error("cycle failed, continuing:\n%s", traceback.format_exc())
                if args.once:
                    return 1
                # A failed cycle can leave the connection in an aborted
                # transaction; roll back so the next cycle starts clean.
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(SLEEP_AFTER_ERROR)
                continue

            if args.once:
                return 0
            time.sleep(SLEEP_BETWEEN_CYCLES)
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
