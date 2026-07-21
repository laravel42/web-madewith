"""Golden-set + regression tests for the publish-time category classifier.

Run:
    python3 scraper/tests/test_classify_engine.py

Uses the same hand-labeled 72-repo fixture as the Worker's test suite
(worker/test/fixtures/golden.json), so both language ports are held to the
same ≥95% accuracy bar against real scraped repos. No DB or network needed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))

from madewith_scraper.classify_engine import classify, classify_detailed, categories, low_confidence_threshold  # noqa: E402

FIXTURE = ROOT / "worker" / "test" / "fixtures" / "golden.json"
CATEGORIES_JSON = ROOT / "src" / "config" / "categories.json"

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def run(repo: dict) -> str:
    return classify({"name": repo.get("name"), "description": repo.get("description"), "topics": repo.get("topics") or []})


# --- taxonomy parity with the site config ---
site_labels = sorted(c["label"] for c in json.loads(CATEGORIES_JSON.read_text())["categories"])
check(sorted(categories()) == site_labels, f"engine taxonomy != categories.json: {sorted(categories())} vs {site_labels}")

# --- golden set: ≥95% on 72 hand-labeled real repos ---
golden = json.loads(FIXTURE.read_text())
check(len(golden) >= 70, "golden fixture intact")
misses = []
for g in golden:
    got = run(g)
    if got not in g["accepted"]:
        misses.append(f"{g['name']}: got {got}, want {'|'.join(g['accepted'])}")
accuracy = (len(golden) - len(misses)) / len(golden)
check(accuracy >= 0.95, f"golden accuracy {accuracy * 100:.1f}% — misses: {misses}")
print(f"golden accuracy: {accuracy * 100:.1f}% ({len(golden) - len(misses)}/{len(golden)})")

# --- regression cases for the old substring failure modes ---
check(run({"name": "mailer", "description": "Maintain email templates for your domain with a simple API", "topics": []}) != "AI & ML",
      "'ai' inside 'maintain'/'email' must not trigger AI & ML")
check(run({"name": "renderer", "description": "Fast HTML renderer", "topics": ["html"]}) != "AI & ML",
      "'ml' inside 'html' must not trigger AI & ML")
check(run({"name": "nest", "description": "A progressive framework for building efficient server-side applications", "topics": ["framework"]}) == "DevTools",
      "'ui' inside 'building' must not trigger UI Kits")
check(run({"name": "seo-pro", "description": "The all-in-one SEO toolkit: meta tags", "topics": ["addon", "seo"]}) == "DevTools",
      "'toolkit' is not a UI 'kit'")
check(run({"name": "twill-metadata", "description": "SEO Metadata Package for Twill CMS", "topics": ["laravel", "twill"]}) == "DevTools",
      "a CMS *package* is DevTools")
check(run({"name": "ctdd", "description": "Twill CMS website for a local community", "topics": ["cms", "church"]}) == "Blogs",
      "a CMS *site* is Blogs")
check(run({"name": "Sink", "description": "A Simple Link Shortener with Analytics",
           "topics": ["analytics", "link-shortener", "shadcn-ui", "tailwindcss", "web-analytics"]}) == "Dashboards",
      "an app styled with shadcn/tailwind is not a UI kit")
check(run({"name": "myapp", "description": "A scheduling app", "topics": ["next-auth", "nextjs", "prisma"]}) != "Authentication",
      "dependency topics must not hijack the category")
check(run({"name": "constructor", "description": "toString valueOf hasOwnProperty __proto__ patterns", "topics": ["constructor"]}) == "DevTools",
      "Object.prototype-style words must not crash or score")

# --- confidence contract ---
low = classify_detailed(name="Monopoly", description="Monopoly game made with Laravel", topics=[])
check(low["category"] == "DevTools" and low["confidence"] < low_confidence_threshold(),
      "no evidence → default with low confidence")
high = classify_detailed(name="bootstrap-vue", description="Component library", topics=["component-library", "components", "icons"])
check(high["category"] == "UI Kits" and high["confidence"] >= 0.7, "confident calls report high confidence")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("all checks passed")
