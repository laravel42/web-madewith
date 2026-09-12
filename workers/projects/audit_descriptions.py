#!/usr/bin/env python3
"""Audit generated project descriptions against the sources they were written from.

Two passes per project:

1. Mechanical — the checks that need no model: stray HTML, meta-commentary,
   mixed-script degeneration, word/character budgets, star counts quoted in the
   prose that disagree with the catalog, and the "built on <gallery tech>" claim
   that the gallery membership does not support.

2. Grounding — re-fetches the same context the worker used (project website,
   falling back to the repo README) and asks the model to list claims the source
   does not support. The judge only ever flags; nothing is rewritten here.

Usage:
  audit_descriptions.py <domain-slug> [--repo owner/name] [--workers N] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent
sys.path.insert(0, str(BASE_DIR))
# discovery_worker reads argv during import; hide ours, then put it back.
_ARGV = list(sys.argv)
sys.argv = [sys.argv[0]]

import discovery_worker as w  # noqa: E402
from openai import OpenAI  # noqa: E402

sys.argv = _ARGV

JUDGE_PROMPT = """You are auditing a generated project description for factual grounding.

SOURCE (everything that may be treated as true about the project):
###
{source}
###

KNOWN FACTS:
- Repository: {full_name}
- Stars: {stars}
- Primary languages: {langs}
- Gallery it is catalogued in: {tech} (a directory category — this does NOT mean
  the project uses or depends on {tech})

GENERATED TEXT:
###
{generated}
###

Classify every unsupported claim into exactly one kind:

"fabrication" — a checkable fact the source does not contain: an invented
feature, integration, version number, model or product name, adoption figure,
customer, benchmark; a claim the project is built on/with, powered by, part of,
leverages, or is a fork of {tech} when the source does not say so; or text about
some other project entirely. These are the serious ones.

"embellishment" — an unsupported judgement or tone: "seamless", "powerful",
"active community", "contributions are welcome", "ideal for", "production-ready",
a use case that is plausible but not stated. The words are unsupported; no false
fact is asserted.

Do NOT flag: reasonable paraphrase of something the source does say, or a
roadmap framed as possibility rather than fact.

Return STRICT JSON, no prose, no code fence. Every issue MUST have all three keys:
{{"issues": [{{"kind": "fabrication|embellishment", "claim": "<quoted text>", "why": "<short reason>"}}]}}
If everything is supported, return {{"issues": []}}."""


def mechanical_checks(project: dict[str, Any], tech_name: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    md = project.get("descriptionMd") or ""
    desc = project.get("desc") or ""
    low = int(w.TARGET_WORDS * (1 - w.WORD_TOLERANCE))
    high = int(w.TARGET_WORDS * (1 + w.WORD_TOLERANCE))

    if not md:
        out.append({"severity": "high", "claim": "(no README)", "why": "no generated description stored"})
        return out

    problem = w.validate_markdown(md, low, high)
    if problem:
        out.append({"severity": "high", "claim": "(structure)", "why": problem})
    if re.search(r"</?[a-zA-Z][^>\n]{0,80}>", md):
        out.append({"severity": "high", "claim": "(raw HTML)", "why": "HTML tags in stored Markdown"})
    if len(desc) > w.ABSTRACT_MAX_CHARS:
        out.append({"severity": "medium", "claim": "(abstract)",
                    "why": f"{len(desc)} chars, over the {w.ABSTRACT_MAX_CHARS} limit"})

    # A dependency claim the gallery membership does not establish.
    dep = re.compile(
        rf"\b(built (?:on|with|upon)|powered by|based on|a fork of|an? extension of)\s+"
        rf"(\*\*)?{re.escape(tech_name)}", re.IGNORECASE)
    for m in dep.finditer(md):
        out.append({"severity": "high", "claim": m.group(0),
                    "why": f"asserts a dependency on {tech_name}; the gallery is only a category"})

    # Star counts quoted in prose drift as soon as the number moves.
    stars = project.get("stars") or 0
    for m in re.finditer(r"([\d,]{2,})\s*(?:GitHub\s*)?stars", md, re.IGNORECASE):
        quoted = int(m.group(1).replace(",", ""))
        if abs(quoted - stars) > max(50, stars * 0.05):
            out.append({"severity": "medium", "claim": m.group(0),
                        "why": f"catalog says {stars:,} stars"})
    return out


def judge(client: OpenAI, project: dict[str, Any], tech_name: str, token: str) -> tuple[list[dict], str]:
    """Re-fetch the worker's grounding context and ask the model what is unsupported."""
    repo = {
        "full_name": project["fullName"],
        "name": project["name"],
        "description": project.get("desc"),
        "homepage": project.get("demo"),
        "html_url": project.get("repoUrl"),
    }
    readme = w.gh_get(f"/repos/{project['fullName']}/readme", token, allow_404=True,
                      accept="application/vnd.github.raw+json")
    repo["_readme"] = readme.text[:w.README_MAX_CHARS] if readme is not None else ""
    context_text, source_label = w.build_context(repo)

    prompt = JUDGE_PROMPT.format(
        source=context_text[:9000],
        full_name=project["fullName"],
        stars=f"{project.get('stars', 0):,}",
        langs=", ".join(l["name"] for l in (project.get("langs") or [])[:4]) or "unknown",
        tech=tech_name,
        generated=(project.get("descriptionMd") or "")[:9000],
    )
    raw = w.call_llm(client, prompt)
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", raw.strip()).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return [{"severity": "low", "claim": "(judge)", "why": "model returned no JSON"}], source_label
    try:
        payload = json.loads(match.group())
    except json.JSONDecodeError as exc:
        return [{"severity": "low", "claim": "(judge)", "why": f"unparseable verdict: {exc}"}], source_label
    # The judge is itself a model: it drops keys, renames them, and sometimes
    # returns a bare list. Normalise rather than trusting the shape.
    raw_issues = payload.get("issues", payload) if isinstance(payload, dict) else payload
    if not isinstance(raw_issues, list):
        return [{"severity": "low", "claim": "(judge)", "why": "verdict was not a list"}], source_label
    issues = []
    for item in raw_issues:
        if isinstance(item, str):
            issues.append({"kind": "unclassified", "severity": "medium", "claim": item,
                           "why": "unsupported by source"})
            continue
        if not isinstance(item, dict):
            continue
        # Severity follows the kind: a fabricated fact is a defect, an
        # unsupported adjective is a style note. Conflating them made the
        # before/after numbers useless.
        kind = str(item.get("kind") or item.get("type") or "").lower()
        sev = "high" if "fabricat" in kind else ("low" if "embellish" in kind else
              str(item.get("severity") or "medium").lower())
        issues.append({
            "kind": kind or "unclassified",
            "severity": sev if sev in {"high", "medium", "low"} else "medium",
            "claim": str(item.get("claim") or item.get("text") or item.get("quote") or "(unquoted)"),
            "why": str(item.get("why") or item.get("reason") or item.get("explanation") or ""),
        })
    return issues, source_label


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit generated descriptions for a domain")
    parser.add_argument("slug")
    parser.add_argument("--repo", default=None, help="Audit a single owner/name.")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--json", default=None, help="Write the full report here.")
    parser.add_argument("--skip-judge", action="store_true", help="Mechanical checks only.")
    args = parser.parse_args()

    data = json.loads((REPO_ROOT / "src" / "data" / f"{args.slug}.json").read_text())
    projects = data["projects"]
    if args.repo:
        projects = [p for p in projects if p["fullName"].lower() == args.repo.lower()]

    domains = w.load_domains()
    tech_name = next((d["techName"] for d in domains if d["slug"] == args.slug), args.slug)

    token = w.github_token() if hasattr(w, "github_token") else (
        __import__("os").getenv("GITHUB_TOKEN") or __import__("os").getenv("GH_TOKEN") or "")
    client = OpenAI(api_key=w.LLM_API_KEY, base_url=w.LLM_BASE_URL,
                    default_headers={"User-Agent": "MadeWithWhat-ProjectAudit/1.0"})

    def audit(project: dict[str, Any]) -> dict[str, Any]:
        issues = mechanical_checks(project, tech_name)
        source_label = "(not fetched)"
        if not args.skip_judge and project.get("descriptionMd"):
            try:
                found, source_label = judge(client, project, tech_name, token)
                issues += found
            except Exception as exc:  # noqa: BLE001
                issues.append({"severity": "low", "claim": "(judge)", "why": f"failed: {exc}"})
        return {"repo": project["fullName"], "slug": project["slug"],
                "source": source_label, "issues": issues}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(audit, projects))

    rank = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (min([rank.get(i["severity"], 3) for i in r["issues"]], default=9), r["repo"]))

    total = sum(len(r["issues"]) for r in results)
    highs = sum(1 for r in results for i in r["issues"] if i["severity"] == "high")
    print(f"\n=== {args.slug}: {len(results)} projects, {total} issues ({highs} high) ===\n")
    for r in results:
        if not r["issues"]:
            print(f"  ✓ {r['repo']}")
            continue
        print(f"  ✗ {r['repo']}  [grounded on: {r['source']}]")
        for i in sorted(r["issues"], key=lambda x: rank.get(x["severity"], 3)):
            claim = re.sub(r"\s+", " ", i["claim"])[:110]
            print(f"      [{i['severity']:6s}] {claim}")
            print(f"               → {i['why']}")
        print()

    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2))
        print(f"full report → {args.json}")
    return 1 if highs else 0


if __name__ == "__main__":
    raise SystemExit(main())
