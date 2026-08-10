"""Unit checks for the article finalisation pass.

Each check maps to a defect that reached src/content/blog before these fixes:
dead table-of-contents anchors, mangled asset paths, leaked SEO blocks, and
duplicated FAQ sections. Run via `python tests/run.py`.
"""
from __future__ import annotations

import re
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import content_factory as cf  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
IMAGES = {
    "LOCAL_COVER_PATH": "/assets/2026/02/04/x-cover.jpg",
    "LOCAL_DATA_PATH": "/assets/2026/02/04/x-data.jpg",
}


def site_slugify(value: str) -> str:
    """Mirror of slugify() in src/lib/blog-markdown.ts, the anchor ids the
    rendered page actually uses."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def run(check) -> None:
    # anchors --------------------------------------------------------------
    samples = ["The team's checklist", "Node.js & Deno", "C++ / Rust", "Don't do this"]
    check(
        "anchor_slug matches the site renderer",
        all(cf.anchor_slug(s) == site_slugify(s) for s in samples),
        str([(s, cf.anchor_slug(s), site_slugify(s)) for s in samples if cf.anchor_slug(s) != site_slugify(s)]),
    )
    check(
        "slugify still differs (why anchor_slug exists)",
        cf.slugify("The team's checklist") != site_slugify("The team's checklist"),
    )

    # image paths ----------------------------------------------------------
    fixed = cf.normalize_image_embeds(
        "![a](//assets/2026/02/04/x-cover.jpg)\n\n![b](LOCAL_DATA_PATH)\n\n![c](assets/y.jpg)",
        IMAGES,
    )
    check("repairs protocol-relative //assets", "//assets" not in fixed and "](/assets/2026/02/04/x-cover.jpg)" in fixed)
    check("substitutes the literal placeholder", "LOCAL_DATA_PATH" not in fixed and IMAGES["LOCAL_DATA_PATH"] in fixed)
    check("absolutises a relative asset path", "](/assets/y.jpg)" in fixed)

    injected = cf.ensure_images("Intro.\n\n## One\ntext\n\n## Sources\n- [a](https://x)", IMAGES, "Django", "Release News")
    check("injects a missing cover image", injected.startswith(f"![Django release news cover image]({IMAGES['LOCAL_COVER_PATH']})"))
    check("injects the data image before Sources", injected.index(IMAGES["LOCAL_DATA_PATH"]) < injected.index("## Sources"))

    # table of contents ----------------------------------------------------
    body = "\n".join([
        "## Table of contents", "", "- [Stale](#wrong-anchor)", "",
        "> [!NOTE]", "> A note parked after the TOC.", "",
        "## What's new", "a", "", "## Repository signals at generation time", "b", "",
        "```python", "## not a heading", "```", "", "## Sources", "- [s](https://x)",
    ])
    toc = cf.rebuild_table_of_contents(body)
    check("drops the stale TOC", "#wrong-anchor" not in toc)
    check("keeps content parked after the TOC", "A note parked after the TOC." in toc)
    check("lists sections injected during finalisation", "(#repository-signals-at-generation-time)" in toc)
    check("ignores headings inside code fences", "## not a heading" in toc and "[not a heading]" not in toc)
    anchors = set(re.findall(r"\]\(#([a-z0-9-]+)\)", toc))
    heads = {site_slugify(t) for _, t in cf.iter_h2_lines(toc)}
    check("every TOC anchor resolves", bool(anchors) and anchors <= heads, f"dangling={anchors - heads}")

    # pseudo-headings ------------------------------------------------------
    promoted = cf.promote_pseudo_headings("Executive answer\n\nText.\n\nNot a heading, just prose.\n")
    check("promotes a bare section label", "## Executive answer" in promoted)
    check("leaves ordinary prose alone", "## Not a heading" not in promoted)

    # meta leakage ---------------------------------------------------------
    stripped = cf.strip_meta_blocks(
        '## Overview\nreal\n\n## Article metadata\ntitle: x\n\n## JSON-LD\n```json\n{"a":1}\n```\n\n## Sources\n- [s](https://x)'
    )
    check("strips an Article metadata section", "title: x" not in stripped)
    check("strips a JSON-LD block including its fence", '{"a":1}' not in stripped and "```" not in stripped)
    check("keeps real sections", "## Overview" in stripped and "## Sources" in stripped)

    # FAQ ------------------------------------------------------------------
    deduped = cf.dedupe_faq_sections("## FAQs\n1. Q: a A: b\n\n## Mid\ntext\n\n## FAQ\n### Real?\nyes\n\n## Sources\n- x")
    check("drops the earlier duplicate FAQ", "1. Q: a A: b" not in deduped and "### Real?" in deduped)
    check("keeps sections between the two FAQs", "## Mid" in deduped)

    normalised = cf.ensure_faq_section("## Frequently asked questions\n### Is it ready?\nYes, with caveats.\n\n## Sources\n- x", [])
    check("normalises the FAQ heading", "## FAQ\n" in normalised and "Frequently asked" not in normalised)
    check(
        "extracts FAQ pairs for the FAQPage schema",
        cf.faq_pairs_from_body(normalised, []) == [{"question": "Is it ready?", "answer": "Yes, with caveats."}],
    )

    # model output parsing --------------------------------------------------
    check("parses fenced JSON", cf.extract_json('```json\n{"a": 1}\n```') == {"a": 1})
    check("parses JSON wrapped in prose", cf.extract_json('Here it is:\n{"a": 1}\nHope that helps.') == {"a": 1})
    try:
        cf.extract_json("no json here")
        check("rejects a response with no JSON", False)
    except ValueError:
        check("rejects a response with no JSON", True)

    # slugs ----------------------------------------------------------------
    signature_images = {
        "LOCAL_COVER_PATH": "/assets/2026/07/21/repository-spotlight-fastify-5-cover.jpg",
        "LOCAL_DATA_PATH": "/assets/2026/07/21/repository-spotlight-fastify-5-data.jpg",
    }
    title = "Fastify Repository Deep Dive: Performance Architecture"
    check(
        "rejects a slug echoing the asset filename",
        cf.choose_slug({"slug": "repository-spotlight-fastify-5", "title": title}, signature_images)
        == "fastify-repository-deep-dive-performance-architecture",
        cf.choose_slug({"slug": "repository-spotlight-fastify-5", "title": title}, signature_images),
    )
    check(
        "rejects the asset stem minus its sequence number",
        cf.choose_slug({"slug": "repository-spotlight-fastify", "title": title}, signature_images)
        == "fastify-repository-deep-dive-performance-architecture",
    )
    check(
        "keeps a genuine model slug",
        cf.choose_slug({"slug": "fastify-performance-deep-dive", "title": title}, signature_images)
        == "fastify-performance-deep-dive",
    )
    check(
        "falls back to the title when the slug is empty",
        cf.choose_slug({"slug": "", "title": title}, signature_images)
        == "fastify-repository-deep-dive-performance-architecture",
    )

    check("caps slug length", len(cf.article_slug("a" * 400)) == cf.SLUG_MAX_LEN)
    check("slug is idempotent", cf.article_slug(cf.article_slug("Some Title! Here")) == cf.article_slug("Some Title! Here"))

    # dedup index ----------------------------------------------------------
    blog = REPO_ROOT / "src" / "content" / "blog"
    bodies = [p.read_text(encoding="utf-8") for p in sorted(blog.rglob("*.md"))][:60]
    if len(bodies) < 5:
        check("similarity corpus available", False, f"only {len(bodies)} articles under {blog}")
        return
    conn = sqlite3.connect(":memory:")
    cf.init_db(conn)
    for i, text in enumerate(bodies):
        conn.execute(
            "INSERT INTO articles (content_hash,title_hash,article_type,primary_tech,secondary_tech,"
            "title,slug,description,tags_json,publication_date,body,max_similarity,source_fingerprint,"
            "status,created_at) VALUES (?,?,'x','y',NULL,?,?,'','[]','2026-01-01',?,0,'f','published','n')",
            (str(i), f"t{i}", f"T{i}", f"s{i}", text),
        )
    conn.commit()
    index = cf.SimilarityIndex(conn)
    candidate = bodies[3]
    start = time.perf_counter()
    new_score, _ = index.closest(candidate)
    new_elapsed = time.perf_counter() - start
    rows = conn.execute("SELECT title, body FROM articles").fetchall()
    start = time.perf_counter()
    old_score = max(cf.jaccard_similarity(candidate, body) for _, body in rows)
    old_elapsed = time.perf_counter() - start
    check("index scores identically to pairwise jaccard", abs(new_score - old_score) < 1e-9, f"{new_score} vs {old_score}")
    check(
        "index is faster than rescanning",
        new_elapsed < old_elapsed,
        f"index={new_elapsed * 1000:.0f}ms rescan={old_elapsed * 1000:.0f}ms",
    )
    print(f"       {len(index)} articles: rescan {old_elapsed * 1000:.0f}ms -> index {new_elapsed * 1000:.0f}ms")
