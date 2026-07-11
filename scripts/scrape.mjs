#!/usr/bin/env node
/**
 * MadeWith… — GitHub scraper.
 *
 * For each domain we query the GitHub search API for popular repos in that
 * technology, normalise the results into the catalog's project shape, classify
 * each repo into one of the six catalog categories, and write the result to
 * `src/data/<slug>.json`.
 *
 * Design goals:
 *  - Real data: names, stars, owners, avatars, descriptions, homepages (demo
 *    links) and topics all come straight from GitHub.
 *  - Resilient: the build must never break because GitHub is rate-limited or
 *    offline. On any failure we keep the existing cached JSON (or fall back to
 *    the bundled seed data) so `astro build` always has data to render.
 *
 * Beating GitHub's rate limits — three layers:
 *  1. Auth: set GITHUB_TOKEN. 60 → 5,000 req/hr core, 10 → 30 search/min.
 *  2. GraphQL (used automatically when a token is present): fetches each
 *     domain's repos AND their real language breakdowns in ONE request, so the
 *     whole 6-site network refreshes in ~6 requests instead of ~78 REST calls.
 *  3. Self-healing throttle: honours x-ratelimit-remaining/reset (pre-emptive
 *     wait), backs off on secondary-limit 403/429, and uses ETag conditional
 *     requests so unchanged data returns a free 304.
 *
 * Without a token it falls back to the REST search API (anonymous-friendly) and
 * synthesises the language split from the primary language to conserve quota.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");
const SEED_DIR = join(__dirname, "seed");
const CACHE_DIR = join(__dirname, ".cache");
const ETAG_FILE = join(CACHE_DIR, "etags.json");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ETag + payload cache so unchanged endpoints cost a free 304 (or nothing). */
let ETAGS = {};
try { ETAGS = JSON.parse(readFileSync(ETAG_FILE, "utf8")); } catch { ETAGS = {}; }
function saveEtags() {
  try { writeFileSync(ETAG_FILE, JSON.stringify(ETAGS)); } catch { /* best-effort */ }
}
const PER_DOMAIN = 12; // projects to keep per domain

/** Search queries per domain. Ordered — first match with enough results wins. */
const DOMAINS = [
  { slug: "nuxt",     query: "topic:nuxt",       minStars: 40,  exclude: ["nuxt/nuxt", "nuxt/framework"] },
  { slug: "node",     query: "topic:nodejs",     minStars: 500, exclude: ["nodejs/node"] },
  { slug: "next",     query: "topic:nextjs",     minStars: 200, exclude: ["vercel/next.js"] },
  { slug: "ionic",    query: "topic:ionic",      minStars: 20,  exclude: ["ionic-team/ionic-framework", "ionic-team/ionic"] },
  { slug: "statamic", query: "topic:statamic",   minStars: 3,   exclude: ["statamic/cms", "statamic/statamic"] },
  { slug: "twill",    query: "twill laravel cms", minStars: 0,  exclude: ["area17/twill"] },
];

const CATEGORIES = ["Dashboards", "E-commerce", "UI Kits", "Blogs", "DevTools", "Docs"];

/** Keyword → category classification, checked in priority order. */
const CLASSIFIERS = [
  ["E-commerce", ["ecommerce", "e-commerce", "commerce", "shop", "store", "cart", "checkout", "stripe", "payment", "marketplace"]],
  ["Dashboards", ["dashboard", "admin", "analytics", "panel", "backoffice", "back-office", "metrics", "monitoring"]],
  ["Docs",       ["docs", "documentation", "handbook", "knowledge", "wiki"]],
  ["Blogs",      ["blog", "cms", "content", "markdown", "mdx", "publishing", "newsletter", "portfolio"]],
  ["UI Kits",    ["ui", "component", "components", "design-system", "design", "kit", "tailwind", "css", "theme", "template", "starter", "boilerplate"]],
  ["DevTools",   ["cli", "devtool", "developer", "tool", "tools", "monitor", "lint", "build", "bundler", "framework", "api", "sdk", "plugin", "generator"]],
];

function classify({ topics = [], description = "", name = "" }) {
  const hay = (topics.join(" ") + " " + (description || "") + " " + name).toLowerCase();
  for (const [cat, kws] of CLASSIFIERS) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return "DevTools";
}

function relativeTime(iso) {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.max(0, Math.round((now - then) / 86400000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.round(days / 365)} year${days < 730 ? "" : "s"} ago`;
}

/** Curate the stack chips from real topics, tidied for display. */
function stackFrom(repo) {
  const skip = new Set(["hacktoberfest", "javascript", "typescript"]);
  const pretty = { nextjs: "Next.js", nuxtjs: "Nuxt", nodejs: "Node", vuejs: "Vue", reactjs: "React", tailwindcss: "Tailwind CSS", graphql: "GraphQL", postgresql: "PostgreSQL", mongodb: "MongoDB" };
  const chips = (repo.topics || [])
    .filter((t) => !skip.has(t))
    .slice(0, 4)
    .map((t) => pretty[t] || t.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
  if (repo.language && !chips.some((c) => c.toLowerCase() === repo.language.toLowerCase())) {
    chips.unshift(repo.language);
  }
  return chips.slice(0, 5);
}

/** Pre-emptively wait when the bucket is nearly empty; return seconds waited. */
async function throttle(res) {
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(remaining) && remaining <= 1 && Number.isFinite(reset)) {
    const waitMs = Math.max(0, reset * 1000 - Date.now()) + 1000;
    if (waitMs > 0 && waitMs < 90_000) { // don't stall forever on a long window
      console.log(`   …rate bucket empty, waiting ${Math.ceil(waitMs / 1000)}s for reset`);
      await sleep(waitMs);
    }
  }
}

/**
 * Rate-limit-aware fetch with ETag caching and exponential backoff on
 * secondary limits. `cacheKey` (when given) enables 304 conditional requests.
 */
async function ghFetch(url, { method = "GET", body, cacheKey } = {}, attempt = 0) {
  const headers = { "Accept": "application/vnd.github+json", "User-Agent": "madewith-catalog-scraper" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (body) headers["Content-Type"] = "application/json";
  const cached = cacheKey ? ETAGS[cacheKey] : null;
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  const res = await fetch(url, { method, headers, body });

  // 304 → nothing changed, reuse cached payload for free (doesn't burn quota).
  if (res.status === 304 && cached) return cached.data;

  // Secondary rate limit / abuse detection → honour Retry-After, else backoff.
  if ((res.status === 403 || res.status === 429) && attempt < 4) {
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const retryAfter = Number(res.headers.get("retry-after"));
    let waitMs;
    if (Number.isFinite(retryAfter)) waitMs = retryAfter * 1000 + 500;
    else if (remaining === 0) { await throttle(res); waitMs = 0; }
    else waitMs = Math.min(30_000, 1000 * 2 ** attempt); // 1s,2s,4s,8s
    if (waitMs) { console.log(`   …${res.status}, backing off ${Math.ceil(waitMs / 1000)}s`); await sleep(waitMs); }
    return ghFetch(url, { method, body, cacheKey }, attempt + 1);
  }

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    throw new Error(`GitHub ${res.status} ${res.statusText}${remaining != null ? ` (rate-limit remaining: ${remaining})` : ""}`);
  }

  const data = await res.json();
  if (cacheKey) { ETAGS[cacheKey] = { etag: res.headers.get("etag"), data }; }
  await throttle(res); // keep the next call inside the window
  return data;
}

async function gh(url, cacheKey) {
  return ghFetch(url, { cacheKey });
}

/** GraphQL: one request returns a domain's repos AND their language breakdowns. */
async function ghGraphQL(query, variables) {
  const data = await ghFetch("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (data.errors) throw new Error(`GraphQL: ${data.errors.map((e) => e.message).join("; ")}`);
  return data.data;
}

/** Real language byte breakdown → top 3 as rounded percentages summing to 100. */
async function languagesFor(repo) {
  if (!TOKEN) return synthLangs(repo.language);
  try {
    const bytes = await gh(repo.languages_url);
    const entries = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    let langs = entries.map(([name, v]) => ({ name, pct: Math.round((v / total) * 100) }));
    // normalise rounding drift so the bar fills exactly 100%
    const drift = 100 - langs.reduce((s, l) => s + l.pct, 0);
    if (langs.length) langs[0].pct += drift;
    return langs.length ? langs : synthLangs(repo.language);
  } catch {
    return synthLangs(repo.language);
  }
}

function synthLangs(primary) {
  const lang = primary || "JavaScript";
  if (lang === "CSS" || lang === "HTML") return [{ name: lang, pct: 62 }, { name: "JavaScript", pct: 30 }, { name: "Other", pct: 8 }];
  return [{ name: lang, pct: 72 }, { name: lang === "TypeScript" ? "JavaScript" : "CSS", pct: 20 }, { name: "Other", pct: 8 }];
}

function longCopy(repo) {
  const desc = (repo.description || "").trim().replace(/\s+/g, " ");
  const base = desc ? (desc.endsWith(".") ? desc : desc + ".") : `An open-source project built with a modern stack.`;
  const stars = repo.stargazers_count.toLocaleString();
  const topicPhrase = (repo.topics || []).slice(0, 3).join(", ");
  const long1 = `${base} Maintained by ${repo.owner.login} on GitHub, where it has earned ${stars} stars from the community.`;
  const long2 = topicPhrase
    ? `It's actively developed around ${topicPhrase}, and is a solid reference for anyone building with these tools.`
    : `It's actively developed and a solid reference for anyone building on this stack.`;
  return { long1, long2 };
}

function normalise(repo) {
  const category = classify(repo);
  const { long1, long2 } = longCopy(repo);
  return {
    slug: repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || repo.id.toString(),
    name: repo.name,
    fullName: repo.full_name,
    category,
    stars: repo.stargazers_count,
    author: repo.owner.login,
    avatar: repo.owner.avatar_url,
    desc: (repo.description || "A project worth exploring.").trim(),
    demo: repo.homepage && /^https?:\/\//.test(repo.homepage) ? repo.homepage : null,
    repoUrl: repo.html_url,
    long1,
    long2,
    stack: stackFrom(repo),
    updated: relativeTime(repo.pushed_at),
    license: (repo.license && repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION") ? repo.license.spdx_id : "—",
    langs: null, // filled in below
    topics: repo.topics || [],
  };
}

/** Shared noise/quality filter + top-N pick, variant-agnostic. */
function selectRepos(domain, repos) {
  const exclude = new Set((domain.exclude || []).map((s) => s.toLowerCase()));
  const base = repos.filter((r) => !r.fork && !r.archived && r.stargazers_count >= domain.minStars);
  const isNoise = (r) =>
    exclude.has(r.full_name.toLowerCase()) ||
    r.name.toLowerCase() === domain.slug ||
    /^awesome[-_]/.test(r.name.toLowerCase()) ||
    (r.topics || []).includes("awesome-list");
  const curated = base.filter((r) => !isNoise(r));
  return (curated.length >= 6 ? curated : base).slice(0, PER_DOMAIN);
}

const GQL_SEARCH = `
query($q: String!, $n: Int!) {
  rateLimit { remaining resetAt cost }
  search(query: $q, type: REPOSITORY, first: $n) {
    repositoryCount
    nodes {
      ... on Repository {
        name nameWithOwner description stargazerCount homepageUrl url
        isFork isArchived pushedAt
        owner { login avatarUrl }
        licenseInfo { spdxId }
        primaryLanguage { name }
        repositoryTopics(first: 12) { nodes { topic { name } } }
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
          totalSize edges { size node { name } }
        }
      }
    }
  }
}`;

/** Map a GraphQL repository node to the REST-ish shape selectRepos/normalise expect. */
function fromGraphQL(node) {
  const topics = (node.repositoryTopics?.nodes || []).map((t) => t.topic.name);
  const total = node.languages?.totalSize || 0;
  let langs = (node.languages?.edges || [])
    .map((e) => ({ name: e.node.name, pct: total ? Math.round((e.size / total) * 100) : 0 }))
    .slice(0, 3);
  const drift = 100 - langs.reduce((s, l) => s + l.pct, 0);
  if (langs.length) langs[0].pct += drift;
  return {
    name: node.name,
    full_name: node.nameWithOwner,
    description: node.description,
    stargazers_count: node.stargazerCount,
    homepage: node.homepageUrl,
    html_url: node.url,
    fork: node.isFork,
    archived: node.isArchived,
    pushed_at: node.pushedAt,
    owner: { login: node.owner.login, avatar_url: node.owner.avatarUrl },
    license: { spdx_id: node.licenseInfo?.spdxId },
    language: node.primaryLanguage?.name,
    topics,
    _langs: langs.length ? langs : synthLangs(node.primaryLanguage?.name),
  };
}

async function scrapeDomainGraphQL(domain) {
  const gql = `${domain.query} sort:stars-desc`;
  const data = await ghGraphQL(GQL_SEARCH, { q: gql, n: 50 });
  const nodes = (data.search.nodes || []).map(fromGraphQL);
  const items = selectRepos(domain, nodes);
  if (!items.length) throw new Error("no repositories matched");
  const projects = items.map((repo) => ({ ...normalise(repo), langs: repo._langs }));
  return { total: data.search.repositoryCount, projects };
}

async function scrapeDomainREST(domain) {
  const q = encodeURIComponent(domain.query);
  const search = await gh(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=50`, `search:${domain.slug}`);
  const items = selectRepos(domain, search.items || []);
  if (!items.length) throw new Error("no repositories matched");

  const projects = [];
  for (const repo of items) {
    const p = normalise(repo);
    p.langs = await languagesFor(repo);
    projects.push(p);
  }
  return { total: search.total_count, projects };
}

/** Use GraphQL when authenticated (far fewer requests); REST otherwise. */
async function scrapeDomain(domain) {
  return TOKEN ? scrapeDomainGraphQL(domain) : scrapeDomainREST(domain);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  const mode = TOKEN ? "token · GraphQL (≈1 request/domain, 5,000/hr)" : "anonymous · REST (60 req/hr — set GITHUB_TOKEN for headroom)";
  console.log(`MadeWith… scraper — ${mode}\n`);
  let ok = 0;

  for (const domain of DOMAINS) {
    const out = join(DATA_DIR, `${domain.slug}.json`);
    try {
      const { total, projects } = await scrapeDomain(domain);
      const payload = {
        slug: domain.slug,
        scrapedAt: new Date().toISOString(),
        source: "github",
        totalRepos: total,
        projects,
      };
      await writeFile(out, JSON.stringify(payload, null, 2));
      console.log(`✓ ${domain.slug.padEnd(9)} ${projects.length} projects  (of ~${total.toLocaleString()} on GitHub)`);
      ok++;
    } catch (err) {
      const seed = join(SEED_DIR, `${domain.slug}.json`);
      if (existsSync(out)) {
        console.log(`• ${domain.slug.padEnd(9)} kept cached data — ${err.message}`);
      } else if (existsSync(seed)) {
        await writeFile(out, await readFile(seed));
        console.log(`• ${domain.slug.padEnd(9)} used seed data — ${err.message}`);
      } else {
        console.log(`✗ ${domain.slug.padEnd(9)} FAILED, no fallback — ${err.message}`);
      }
    }
  }
  saveEtags();
  console.log(`\nDone. ${ok}/${DOMAINS.length} domains scraped fresh.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
