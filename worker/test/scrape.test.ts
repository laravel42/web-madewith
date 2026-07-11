import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub, type EtagStore } from "../src/github.ts";
import { scrapeDomain } from "../src/scrape.ts";
import type { DomainDiscovery } from "../src/domains.ts";

/** Map-backed ETag store. */
function memStore(): EtagStore {
  const m = new Map<string, { etag: string; body: string }>();
  return { async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); } };
}

function repoNode(over: Partial<any> = {}) {
  return {
    databaseId: over.databaseId ?? Math.floor(Math.random() * 1e6),
    name: over.name ?? "proj",
    nameWithOwner: over.nameWithOwner ?? `owner/${over.name ?? "proj"}`,
    description: over.description ?? "A dashboard for teams.",
    stargazerCount: over.stargazerCount ?? 500,
    homepageUrl: over.homepageUrl ?? "https://example.com",
    url: over.url ?? "https://github.com/owner/proj",
    isFork: over.isFork ?? false,
    isArchived: over.isArchived ?? false,
    pushedAt: over.pushedAt ?? "2026-07-01T00:00:00Z",
    owner: { login: over.owner ?? "owner", avatarUrl: "https://avatars/owner" },
    licenseInfo: over.license === null ? null : { spdxId: over.license ?? "MIT" },
    primaryLanguage: { name: over.lang ?? "TypeScript" },
    repositoryTopics: { nodes: (over.topics ?? ["dashboard", "analytics"]).map((t: string) => ({ topic: { name: t } })) },
    languages: { totalSize: 100, edges: [{ size: 70, node: { name: "TypeScript" } }, { size: 30, node: { name: "CSS" } }] },
    ...(over._raw ?? {}),
  };
}

const DOMAIN: DomainDiscovery = { slug: "nuxt", techName: "Nuxt", match: "topic:nuxt", keep: 5, exclude: ["nuxt/nuxt"] };

function serve(nodes: any[]) {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/search/repositories"))
      return new Response(JSON.stringify({ total_count: 8584 }), { status: 200, headers: { etag: 'W/"abc"' } });
    return new Response(JSON.stringify({ data: { search: { repositoryCount: 8584, nodes } } }), { status: 200 });
  }) as any;
}

test("scrapeDomain dedupes by id, drops noise, classifies, scores and ranks", async () => {
  const clean = Array.from({ length: 7 }, (_, i) =>
    repoNode({ databaseId: 100 + i, name: `proj${i}`, nameWithOwner: `o/proj${i}`, stargazerCount: 8000 - i * 200, topics: ["dashboard"] }),
  );
  serve([
    repoNode({ databaseId: 1, name: "pulse", nameWithOwner: "a/pulse", stargazerCount: 9000, topics: ["dashboard"] }),
    repoNode({ databaseId: 1, name: "pulse", nameWithOwner: "a/pulse", stargazerCount: 9000, topics: ["dashboard"] }), // dupe id
    repoNode({ databaseId: 2, name: "shopkit", nameWithOwner: "b/shopkit", stargazerCount: 8500, topics: ["ecommerce", "stripe"] }),
    ...clean,
    repoNode({ databaseId: 3, name: "awesome-nuxt", nameWithOwner: "c/awesome-nuxt", stargazerCount: 20000 }), // soft noise
    repoNode({ databaseId: 4, name: "forked", nameWithOwner: "d/forked", isFork: true, stargazerCount: 15000 }), // hard: fork
    repoNode({ databaseId: 5, name: "nuxt", nameWithOwner: "nuxt/nuxt", stargazerCount: 60000 }), // hard: excluded core + name===slug
  ]);

  const gh = new GitHub({ token: "x", etags: memStore() });
  const ds = await scrapeDomain(gh, DOMAIN, Date.parse("2026-07-11T00:00:00Z"));

  assert.equal(ds.totalRepos, 8584, "uses REST total_count");
  assert.equal(ds.projects.length, 5, "keeps top N");
  const ids = ds.projects.map((p) => p.githubId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  assert.ok(!ids.some((id) => [3, 4, 5].includes(id)), "awesome/fork/core all dropped when enough clean repos exist");
  const scores = ds.projects.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "ranked by score");
  const pulse = ds.projects.find((p) => p.githubId === 1)!;
  assert.equal(pulse.category, "Dashboards");
  assert.equal(pulse.demo, "https://example.com");
  assert.equal(pulse.langs.reduce((s, l) => s + l.pct, 0), 100, "langs sum to 100");
  assert.match(pulse.long1, /9,?000 stars/, "long copy uses real metrics (locale-agnostic)");
});

test("hard noise (fork / framework core) is never kept, even in a tiny ecosystem", async () => {
  serve([
    repoNode({ databaseId: 10, name: "twill-metadata", nameWithOwner: "cws/twill-metadata", stargazerCount: 33, topics: ["cms"] }),
    repoNode({ databaseId: 11, name: "twill-graphql", nameWithOwner: "k/twill-graphql", stargazerCount: 8, topics: ["cms"] }),
    repoNode({ databaseId: 12, name: "forked", nameWithOwner: "x/forked", isFork: true, stargazerCount: 99999 }),
    repoNode({ databaseId: 13, name: "twill", nameWithOwner: "area17/twill", stargazerCount: 4000 }),
  ]);
  const gh = new GitHub({ token: "x", etags: memStore() });
  const ds = await scrapeDomain(gh, { slug: "twill", techName: "Twill", match: "twill", keep: 12, exclude: ["area17/twill"] }, Date.now());
  const ids = ds.projects.map((p) => p.githubId);
  assert.ok(!ids.includes(12), "fork never kept");
  assert.ok(!ids.includes(13), "excluded framework core never kept");
  assert.ok(ids.includes(10) && ids.includes(11), "real projects kept");
});

test("rest() fails fast on a permanent 403 (no rate-limit signal), but retries a rate-limited 403", async () => {
  // Permanent 403 (scopes/blocked) → throw on the first call, no spinning.
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "42" } }); }) as any;
  const gh = new GitHub({ token: "x", etags: memStore(), maxAttempts: 5 });
  await assert.rejects(() => gh.rest("https://api.github.com/x"), /GitHub 403/);
  assert.equal(calls, 1, "permanent 403 is not retried");

  // Rate-limited 403 (remaining 0, reset in the past) → retried, then succeeds.
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    if (n === 1) return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 1) } });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;
  const gh2 = new GitHub({ token: "x", etags: memStore(), maxAttempts: 5 });
  const res = await gh2.rest<{ ok: boolean }>("https://api.github.com/y");
  assert.equal(res.data.ok, true);
  assert.equal(n, 2, "rate-limited 403 is retried once then succeeds");
});

test("rest() uses ETag conditional requests (304 → cached, no re-parse cost)", async () => {
  const store = memStore();
  const gh = new GitHub({ token: "x", etags: store });
  let sentIfNoneMatch: string | null = null;
  let call = 0;

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    call++;
    const inm = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
    if (call === 1) return new Response(JSON.stringify({ total_count: 42 }), { status: 200, headers: { etag: 'W/"e1"' } });
    sentIfNoneMatch = inm ?? null;
    return new Response(null, { status: 304 });
  }) as any;

  const a = await gh.rest<{ total_count: number }>("https://api.github.com/search/repositories?q=x", "count:x");
  assert.equal(a.data.total_count, 42);
  assert.equal(a.notModified, false);
  const b = await gh.rest<{ total_count: number }>("https://api.github.com/search/repositories?q=x", "count:x");
  assert.equal(b.data.total_count, 42, "304 returns cached body");
  assert.equal(b.notModified, true);
  assert.equal(sentIfNoneMatch, 'W/"e1"', "sent stored ETag");
});
