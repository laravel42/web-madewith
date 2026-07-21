import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify, classifyDetailed, LOW_CONFIDENCE, CATEGORIES } from "../src/classify.ts";
import { CATEGORIES as ENGINE_CATEGORIES } from "../../shared/classify.mjs";
import { parseCategory, refineCategories } from "../src/classify-ai.ts";
import type { Project } from "../src/scrape.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.json");

interface GoldenEntry { name: string; description: string; topics: string[]; accepted: string[]; }

test("engine taxonomy stays in sync with src/config/categories.json", () => {
  assert.deepEqual([...ENGINE_CATEGORIES].sort(), [...CATEGORIES].sort(),
    "shared/classify.mjs CATEGORIES must match categories.json labels");
});

test("golden set: ≥95% accuracy on 72 hand-labeled real repos", () => {
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as GoldenEntry[];
  assert.ok(golden.length >= 70, "fixture intact");
  const misses: string[] = [];
  for (const g of golden) {
    const got = classify({ name: g.name, description: g.description, topics: g.topics });
    if (!g.accepted.includes(got)) misses.push(`${g.name}: got ${got}, want ${g.accepted.join("|")}`);
  }
  const accuracy = (golden.length - misses.length) / golden.length;
  assert.ok(accuracy >= 0.95, `accuracy ${(accuracy * 100).toFixed(1)}% — misses:\n${misses.join("\n")}`);
});

// --- regression cases for the failure modes of the old substring classifier ---

test("word boundaries: 'ai' inside 'maintain'/'email' does not trigger AI & ML", () => {
  const r = classify({ name: "mailer", description: "Maintain email templates for your domain with a simple API", topics: [] });
  assert.notEqual(r, "AI & ML");
});

test("word boundaries: 'ml' inside 'html' does not trigger AI & ML", () => {
  const r = classify({ name: "renderer", description: "Fast HTML renderer", topics: ["html"] });
  assert.notEqual(r, "AI & ML");
});

test("word boundaries: 'ui' inside 'building' does not trigger UI Kits", () => {
  const r = classify({ name: "nest", description: "A progressive framework for building efficient server-side applications", topics: ["framework"] });
  assert.equal(r, "DevTools");
});

test("'toolkit' is not a UI 'kit'", () => {
  const r = classify({ name: "seo-pro", description: "The all-in-one SEO toolkit: meta tags, Open Graph, structured data", topics: ["addon", "seo", "statamic-addon"] });
  assert.equal(r, "DevTools");
});

test("a CMS *package* is DevTools, a CMS *site* is Blogs", () => {
  assert.equal(classify({ name: "twill-metadata", description: "SEO Metadata Package for Twill CMS", topics: ["laravel", "twill"] }), "DevTools");
  assert.equal(classify({ name: "ctdd", description: "Twill CMS website for a local community", topics: ["cms", "church"] }), "Blogs");
});

test("strong signals beat piles of weak incidental topics", () => {
  const r = classify({
    name: "nodebestpractices",
    description: "The Node.js best practices list",
    topics: ["best-practices", "eslint", "express", "jest", "microservices", "npm", "rest", "testing", "style-guide"],
  });
  assert.equal(r, "Docs");
});

test("phrase suppression: an app styled with shadcn/tailwind is not a UI kit", () => {
  const r = classify({
    name: "Sink",
    description: "A Simple Link Shortener with Analytics",
    topics: ["analytics", "link-shortener", "shadcn-ui", "tailwindcss", "web-analytics"],
  });
  assert.equal(r, "Dashboards");
});

test("dependency topics don't hijack the category (next-auth user ≠ auth library)", () => {
  const r = classify({ name: "myapp", description: "A scheduling app", topics: ["next-auth", "nextjs", "prisma", "tailwindcss"] });
  assert.notEqual(r, "Authentication");
});

test("new taxonomy: auth libraries → Authentication, AI apps → AI & ML, starters → Templates", () => {
  assert.equal(classify({ name: "next-auth", description: "Authentication for the Web", topics: ["auth", "authentication", "jwt", "oauth"] }), "Authentication");
  assert.equal(classify({ name: "NextChat", description: "Light and Fast AI Assistant", topics: ["chatgpt", "gemini", "claude"] }), "AI & ML");
  assert.equal(classify({ name: "statamic-peak", description: "An opinionated starter kit for all your sites", topics: ["page-builder", "starter-kit"] }), "Templates");
});

test("Object.prototype member words in repo text don't crash or score", () => {
  const r = classifyDetailed({ name: "constructor", description: "toString valueOf hasOwnProperty __proto__ constructor patterns", topics: ["constructor"] });
  assert.equal(r.category, "DevTools"); // default — no real signals
});

test("no evidence → defaults to DevTools with low confidence", () => {
  const r = classifyDetailed({ name: "Monopoly", description: "Monopoly game made with Laravel", topics: [] });
  assert.equal(r.category, "DevTools");
  assert.ok(r.confidence < LOW_CONFIDENCE, "flagged for the AI fallback");
});

// --- Workers AI fallback ---

function proj(over: Partial<Project> = {}): Project {
  return {
    githubId: 1, slug: "x", name: "x", fullName: "o/x", category: "DevTools", stars: 1, author: "o",
    avatar: "", desc: "", demo: null, repoUrl: "", long1: "", long2: "", stack: [], updated: "", license: "—",
    langs: [], topics: [], score: 0.5, ...over,
  } as Project;
}
const fakeKv = (store = new Map<string, string>()) => ({
  get: async (k: string) => store.get(k) ?? null,
  put: async (k: string, v: string) => void store.set(k, v),
}) as unknown as KVNamespace;

test("parseCategory enforces the strict one-label contract", () => {
  assert.equal(parseCategory("Docs"), "Docs");
  assert.equal(parseCategory("  ai & ml.\n"), "AI & ML");
  assert.equal(parseCategory("The category is UI Kits"), "UI Kits");
  assert.equal(parseCategory("Games"), null);
  assert.equal(parseCategory(42), null);
});

test("refineCategories reclassifies only low-confidence projects and caches the answer", async () => {
  let calls = 0;
  const ai = { run: async () => { calls++; return { response: "Docs" }; } } as unknown as Ai;
  const kv = fakeKv();
  const lowConf = proj({ githubId: 7, name: "mystery", desc: "Monopoly game made with Laravel", topics: [] });
  const highConf = proj({ githubId: 8, name: "bootstrap-vue", desc: "Component library", topics: ["component-library"], category: "UI Kits" });

  const changed = await refineCategories(ai, kv, [lowConf, highConf]);
  assert.equal(changed, 1);
  assert.equal(lowConf.category, "Docs", "low-confidence repo reclassified by AI");
  assert.equal(highConf.category, "UI Kits", "confident repo untouched");
  assert.equal(calls, 1, "AI consulted only for the low-confidence repo");

  const again = proj({ githubId: 7, name: "mystery", desc: "Monopoly game made with Laravel", topics: [] });
  await refineCategories(ai, kv, [again]);
  assert.equal(again.category, "Docs");
  assert.equal(calls, 1, "cache hit, no extra AI call");
});

test("refineCategories keeps the rule answer on invalid AI replies or missing binding", async () => {
  const bad = { run: async () => ({ response: "Board Games" }) } as unknown as Ai;
  const p = proj({ githubId: 9, desc: "Monopoly game", topics: [] });
  assert.equal(await refineCategories(bad, fakeKv(), [p]), 0);
  assert.equal(p.category, "DevTools", "contract violation → rule answer stands");
  assert.equal(await refineCategories(undefined, fakeKv(), [p]), 0, "no binding → no-op");
});
