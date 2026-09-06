#!/usr/bin/env node
/**
 * Cross-domain contamination scrub for the published datasets.
 *
 * Mirrors the discovery-side qualification guards (github/…/detection.py and
 * worker/src/scrape.ts) using only fields available in the published JSON:
 *
 *  1. Broad-topic mismatch — a repo whose topics span ≥3 catalog technologies
 *     is a multi-tech tool (deploy platform, boilerplate hub). It is evicted
 *     from a domain unless its name mentions the tech or its primary language
 *     fits the domain's expected language families
 *     (src/config/domain-catalog.json → scrape.languageFamilies).
 *  2. Shared-vendor rival — symfony/* components are plumbing for the whole
 *     PHP ecosystem: a repo in the Symfony gallery that topic-tags Laravel but
 *     not Symfony is a Laravel app that matched on components; evict.
 *
 * Run after a republish until the fixed discovery engine has requalified the
 * database:  node workers/utils/scrub-cross-domain.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve paths from the repo root so the script works from any CWD
// (projects:publish invokes it after publish.py).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DRY = process.argv.includes("--dry-run");
const TOPIC_BREADTH_LIMIT = 3;

const LANG_FAMILY = {
  javascript: "js", typescript: "js", vue: "js", svelte: "js", astro: "js",
  coffeescript: "js", html: "js", css: "js", scss: "js", mdx: "js",
  php: "php", blade: "php", hack: "php",
  python: "python", "jupyter notebook": "python",
  ruby: "ruby", go: "go", rust: "rust",
  java: "jvm", kotlin: "jvm", groovy: "jvm", scala: "jvm",
  "c#": "dotnet", "f#": "dotnet", elixir: "elixir", dart: "dart",
  c: "c", "c++": "c", "objective-c": "c", swift: "swift",
};

/** slug → topic-tag that opposes it via a shared vendor namespace. */
const SHARED_VENDOR_RIVALS = { symfony: "laravel" };

const catalog = JSON.parse(readFileSync(join(ROOT, "src/config/domain-catalog.json"), "utf8"));
const slugs = catalog.map((d) => d.slug.toLowerCase());
const families = Object.fromEntries(catalog.map((d) => [d.slug, d.scrape.languageFamilies ?? []]));

function breadth(topics) {
  const t = new Set(topics.map((x) => String(x).toLowerCase()));
  return slugs.filter((s) => t.has(s) || t.has(s + "js")).length;
}

let evicted = 0, kept = 0;
for (const d of catalog) {
  const path = join(ROOT, "src", "data", `${d.slug}.json`);
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const before = data.projects.length;
  const removed = [];

  data.projects = data.projects.filter((p) => {
    const topics = p.topics ?? [];
    const name = (p.name ?? "").toLowerCase();
    const primary = ((p.langs ?? [])[0]?.name ?? "").toLowerCase();
    const family = LANG_FAMILY[primary];

    // Rule 2 — shared-vendor rival
    const rival = SHARED_VENDOR_RIVALS[d.slug];
    const tset = new Set(topics.map((t) => String(t).toLowerCase()));
    if (rival && tset.has(rival) && !tset.has(d.slug) && !name.includes(d.slug)) {
      removed.push(`${p.fullName} (rival:${rival})`);
      return false;
    }

    // Rule 1 — broad-topic mismatch
    if (breadth(topics) >= TOPIC_BREADTH_LIMIT && !name.includes(d.slug.toLowerCase())) {
      const expected = families[d.slug] ?? [];
      if (family && expected.length && !expected.includes(family)) {
        removed.push(`${p.fullName} (broad:${breadth(topics)},lang:${primary})`);
        return false;
      }
    }
    kept++;
    return true;
  });

  if (removed.length) {
    evicted += removed.length;
    console.log(`${d.slug}: -${removed.length}  ${removed.slice(0, 5).join("  ")}${removed.length > 5 ? " …" : ""}`);
    if (!DRY) writeFileSync(path, JSON.stringify(data, null, 2));
  }
  void before;
}
console.log(`\n${DRY ? "[dry-run] " : ""}evicted ${evicted}, kept ${kept}`);
