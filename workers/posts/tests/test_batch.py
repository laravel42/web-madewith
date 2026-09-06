"""End-to-end batch checks against a stubbed LLM and stubbed GitHub.

Covers the parts of main() that are easy to break and expensive to discover in
production: asset lifecycle, publication-date cadence, archive resume, the
batch index, and that --concurrency changes only wall-clock time.
Run via `python tests/run.py`.
"""
from __future__ import annotations

import json
import os
import sqlite3
import random
import re
import shutil
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path

WORK = Path(tempfile.mkdtemp(prefix="factory-batch-"))
os.environ.update(
    CONTENT_DB=str(WORK / "db.sqlite3"),
    CONTENT_OUTPUT_DIR=str(WORK / "out"),
    SITE_BLOG_DIR=str(WORK / "absent-blog"),
    GITHUB_TOKEN="stub",
    OPENROUTER_API_KEY="stub",
)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import content_factory as cf  # noqa: E402

# content_factory loads the repo .env with override=True, so exported env vars
# do NOT win — CONTENT_DB/CONTENT_OUTPUT_DIR above are overwritten at import.
# Pin the module attributes directly or the suite writes into the real database.
cf.DB_PATH = WORK / "db.sqlite3"
cf.OUTPUT_DIR = WORK / "out"
cf.SITE_BLOG_DIR = WORK / "absent-blog"

OUT = WORK / "out"
VOCAB = (
    "deploy cache queue schema latency worker registry index shard replica runtime bundle module "
    "adapter policy quota tenant socket digest cursor buffer stream lattice kernel harness fixture "
    "beacon anchor vector token"
).split()

_state = {"calls": 0, "live": 0, "peak": 0}
_lock = threading.Lock()


def _prose(rng: random.Random, words: int) -> str:
    return " ".join(rng.choice(VOCAB) for _ in range(words)).capitalize() + "."


def _repo(full_name: str, _token: str) -> cf.RepoFacts:
    name = full_name.split("/")[1]
    return cf.RepoFacts(
        full_name, name, full_name.split("/")[0], f"https://github.com/{full_name}",
        f"{name} description", 1234, 56, 7, 89, "Python", "MIT", ["web"],
        "2015-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z",
        "main", "", False, "# Readme\nsome prose", None,
    )


def _body(seed: int, tech: str) -> str:
    rng = random.Random(seed * 7919)
    return "\n".join([
        "## Executive answer", _prose(rng, 60), "", _prose(rng, 60), "",
        "> [!NOTE]", f"> {_prose(rng, 12)}", "", "> [!TIP]", f"> {_prose(rng, 12)}", "",
        "> [!WARNING]", f"> {_prose(rng, 12)}", "",
        f"## What changed for {tech}", _prose(rng, 220), "",
        "| Signal | A | B |", "| --- | --- | --- |", "| Stars | 1 | 2 |",
        "| Forks | 3 | 4 |", "| Issues | 5 | 6 |", "| License | MIT | MIT |", "",
        f"## Operating notes for {tech}", _prose(rng, 220), "",
        "## Risk register", _prose(rng, 200), "",
        "```mermaid", "flowchart LR", "  a[A] --> b[B]", "```", "",
        "## Sources", "- [Django canonical repository](https://github.com/django/django)", "",
        "## FAQ", "### Is this real?", f"No, fixture {seed}.",
    ])


def _generate(_client, prompt: str) -> dict:
    with _lock:
        _state["calls"] += 1
        _state["live"] += 1
        _state["peak"] = max(_state["peak"], _state["live"])
        seed = _state["calls"]
    time.sleep(0.25)  # stand in for the LLM round trip
    with _lock:
        _state["live"] -= 1
    cover = re.search(r"!\[descriptive alt text\]\((/assets/[^)]+-cover\.jpg)\)", prompt).group(1)
    data = re.search(r"!\[descriptive alt text\]\((/assets/[^)]+-data\.jpg)\)", prompt).group(1)
    tech = re.search(r'"primary_technology": \{\s*"name": "([^"]+)"', prompt).group(1)
    body = f"![cover]({cover})\n\n" + _body(seed, tech).replace(
        "## Sources", f"![chart]({data})\n\n## Sources", 1
    )
    return {
        "title": f"{tech} Repository Signals Review, Fixture Number {seed}"[:78],
        "description": (
            f"Fixture description {seed} covering repository evidence, trade-offs, and what "
            "teams should verify before adopting it today."
        ),
        "slug": f"fixture-article-{seed}",
        "excerpt": "Excerpt.",
        "primary_keyphrase": "kp",
        "secondary_keyphrases": ["a", "b"],
        "tags": ["GitHub", "Open Source"],
        "search_intent": "informational",
        "body_markdown": body,
        "faq": [{"question": "Is this real?", "answer": f"No, fixture {seed}."}],
    }


def _batch(argv: list[str]) -> float:
    _state["peak"] = 0
    sys.argv = ["content_factory.py", *argv]
    start = time.perf_counter()
    cf.main()
    return time.perf_counter() - start


def _articles() -> list[Path]:
    return sorted((OUT / "articles").rglob("*.md"))


def run(check) -> None:
    cf.fetch_repo = _repo
    cf.fetch_security_advisories = lambda token, per_page=100: []
    cf.openai_generate = _generate

    try:
        serial = _batch(["--count", "4", "--start-date", "2026-03-01", "--seed", "7"])
        articles = _articles()
        assets = sorted((OUT / "assets").rglob("*.jpg"))
        check("produces the requested article count", len(articles) == 4, str(len(articles)))
        check("writes exactly two images per article", len(assets) == 8, str(len(assets)))
        referenced: set[str] = set()
        for path in articles:
            referenced |= set(re.findall(r"/assets/\S+?\.jpg", path.read_text(encoding="utf-8")))
        on_disk = {f"/assets/{p.relative_to(OUT / 'assets').as_posix()}" for p in assets}
        check("leaves no orphan images", on_disk == referenced, f"disk-only={on_disk - referenced}")

        text = articles[0].read_text(encoding="utf-8")
        frontmatter, body = text.split("\n---\n", 1)
        check("emits front matter", text.startswith("---\ntitle:"))
        graph = json.loads(json.loads(re.search(r'^jsonLd: (".*")$', frontmatter, re.M).group(1)))
        check(
            "JSON-LD carries TechArticle and FAQPage",
            isinstance(graph, list) and {n["@type"] for n in graph} == {"TechArticle", "FAQPage"},
            str(graph)[:120],
        )
        check("FAQPage questions come from the body", graph[1]["mainEntity"][0]["name"] == "Is this real?")
        check("generates a table of contents", "## Table of contents" in body)
        heads = {re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", t.lower())) for _, t in cf.iter_h2_lines(body)}
        anchors = set(re.findall(r"\]\(#([a-z0-9-]+)\)", body))
        check("every TOC anchor resolves", bool(anchors) and anchors <= heads, f"dangling={anchors - heads}")
        canonical = re.search(r'^canonical: "(.+)"$', frontmatter, re.M).group(1)
        check("canonical URL matches the filename", canonical.rsplit("/", 1)[1] == articles[0].stem, canonical)
        check("holds one date until it is full", len({str(p.parent) for p in articles}) == 1)

        # resume ------------------------------------------------------------
        _batch(["--count", "2", "--seed", "99"])
        days = sorted({p.parent.relative_to(OUT / "articles").as_posix() for p in _articles()})
        check("resumes into the partly-filled date, then rolls over", days == ["2026/03/01", "2026/03/02"], str(days))
        check("keeps five articles on the first date", len(list((OUT / "articles" / "2026" / "03" / "01").glob("*.md"))) == 5)

        index = json.loads((OUT / "batch-index.json").read_text(encoding="utf-8"))
        files = sorted(p.stem for p in _articles())
        check("batch index has one row per article", sorted(r["slug"] for r in index) == files,
              f"index={sorted(r['slug'] for r in index)} files={files}")
        cf.OUTPUT_DIR = OUT
        cf.write_index([{"title": "T", "slug": index[0]["slug"], "publication_date": "2026-03-01", "note": "rewritten"}])
        reindexed = json.loads((OUT / "batch-index.json").read_text(encoding="utf-8"))
        check(
            "re-publishing a slug replaces its row",
            len(reindexed) == len(index) and any(r.get("note") == "rewritten" for r in reindexed),
            f"{len(index)} -> {len(reindexed)}",
        )

        # concurrency ---------------------------------------------------------
        shutil.rmtree(OUT)
        (WORK / "db.sqlite3").unlink()
        parallel = _batch(["--count", "4", "--start-date", "2026-04-01", "--seed", "7", "--concurrency", "4"])
        check("concurrent run produces the same count", len(_articles()) == 4, str(len(_articles())))
        check("generation actually overlapped", _state["peak"] > 1, f"peak={_state['peak']}")
        check("concurrency reduces wall clock", parallel < serial, f"serial={serial:.2f}s parallel={parallel:.2f}s")
        check("dates stay gapless under concurrency", len({str(p.parent) for p in _articles()}) == 1)
        print(f"       wall clock: serial {serial:.2f}s -> parallel {parallel:.2f}s (peak {_state['peak']} in flight)")

        # dedup + asset lifecycle on rejection ---------------------------------
        first: list[str] = []

        def repeating(client, prompt):
            article = _generate(client, prompt)
            if first:
                article["body_markdown"] = first[0]
                article["slug"] += "-dup"
            else:
                first.append(article["body_markdown"])
            return article

        cf.openai_generate = repeating
        shutil.rmtree(OUT)
        (WORK / "db.sqlite3").unlink()
        _batch(["--count", "2", "--start-date", "2026-05-01", "--max-attempts", "4"])
        check("rejects the near-duplicate", len(_articles()) == 1, str(len(_articles())))
        check("a rejected attempt writes no images", len(list((OUT / "assets").rglob("*.jpg"))) == 2,
              str(len(list((OUT / "assets").rglob("*.jpg")))))

        # prune ---------------------------------------------------------------
        stray = OUT / "assets" / "2026" / "05" / "01" / "stray-cover.jpg"
        stray.write_bytes(b"x" * 32)
        orphans, freed = cf.prune_orphan_assets(dry_run=True)
        check("prune finds the stray asset", [p.name for p in orphans] == ["stray-cover.jpg"], str(orphans))
        check("prune dry run deletes nothing", stray.exists() and freed == 32)
        cf.prune_orphan_assets(dry_run=False)
        check("prune removes the stray asset", not stray.exists())
        check("prune keeps referenced assets", len(list((OUT / "assets").rglob("*.jpg"))) == 2)

        run_failed_save_leaves_no_images(check)
        run_resume_from_site(check)
    finally:
        shutil.rmtree(WORK, ignore_errors=True)


def run_resume_from_site(check) -> None:
    """A fresh database must resume after the committed site articles, not
    reuse their dates. Exercised separately because it needs its own
    SITE_BLOG_DIR before content_factory reads the environment."""
    work = Path(tempfile.mkdtemp(prefix="factory-resume-"))
    try:
        blog = work / "blog"
        (blog / "2026" / "06" / "09").mkdir(parents=True)
        for i in range(5):
            (blog / "2026" / "06" / "09" / f"a{i}.md").write_text(
                f'---\ntitle: "A{i}"\nslug: "a{i}"\ndate: "2026-06-09"\n---\n\nBody {i}.\n',
                encoding="utf-8",
            )
        (blog / "2026" / "06" / "10").mkdir(parents=True)
        (blog / "2026" / "06" / "10" / "b0.md").write_text(
            '---\ntitle: "B0"\nslug: "b0"\ndate: "2026-06-10"\n---\n\nBody b0.\n', encoding="utf-8"
        )

        db = work / "resume.sqlite3"
        prior_site, prior_db = cf.SITE_BLOG_DIR, cf.DB_PATH
        cf.SITE_BLOG_DIR, cf.DB_PATH = blog, db
        try:
            conn = sqlite3.connect(db)
            cf.init_db(conn)
            cf.import_existing_articles(conn)
            start, offset = cf.next_archive_slot(conn, date(2020, 1, 1))
            conn.close()
        finally:
            cf.SITE_BLOG_DIR, cf.DB_PATH = prior_site, prior_db

        check("resumes onto the partly-filled site date", start == date(2026, 6, 10), str(start))
        check("counts the slot that date already uses", offset == 1, str(offset))
        job = cf.job_for_slot(("comparison", "django", "flask"), 0, start, offset)
        check("first new article lands in a free slot", job.publication_date == "2026-06-10", job.publication_date)
        check(
            "the fifth new article rolls to the next day",
            cf.job_for_slot(("comparison", "django", "flask"), 4, start, offset).publication_date == "2026-06-11",
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_failed_save_leaves_no_images(check) -> None:
    """A duplicate-key insert is a routine outcome; it must not strand the
    cover/data pair that was written just before it."""
    work = Path(tempfile.mkdtemp(prefix="factory-rollback-"))
    try:
        cover = work / "2026" / "09" / "01" / "job-cover.jpg"
        data = cover.with_name("job-data.jpg")
        cover.parent.mkdir(parents=True)
        cover.write_bytes(b"cover")
        data.write_bytes(b"data")
        cf.discard_job_images(cover, data)
        check("failed save removes both images", not cover.exists() and not data.exists())
        check("failed save removes the empty date folder", not cover.parent.exists())

        keep = work / "2026" / "09" / "02" / "other-cover.jpg"
        keep.parent.mkdir(parents=True)
        keep.write_bytes(b"keep")
        gone = keep.with_name("gone-cover.jpg")
        gone.write_bytes(b"gone")
        cf.discard_job_images(gone, keep.with_name("gone-data.jpg"))
        check("rollback keeps a sibling article's images", keep.exists() and not gone.exists())
        check("rollback keeps a non-empty folder", keep.parent.is_dir())
    finally:
        shutil.rmtree(work, ignore_errors=True)
