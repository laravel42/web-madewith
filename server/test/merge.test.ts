import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDataset } from "../src/merge.ts";
import type { Project, DomainDataset } from "../src/scrape.ts";
import type { Override } from "../src/db.ts";

function proj(id: number, over: Partial<Project> = {}): Project {
  return {
    githubId: id, slug: `p${id}`, name: `P${id}`, fullName: `o/p${id}`, category: "DevTools",
    stars: 1000 - id, author: "o", avatar: "", desc: "d", demo: null, repoUrl: "", long1: "", long2: "",
    stack: [], updated: "today", license: "MIT", langs: [], topics: [], score: (1000 - id) / 1000, ...over,
  };
}
const ds = (projects: Project[]): DomainDataset => ({ slug: "nuxt", scrapedAt: "2026-01-01T00:00:00Z", source: "t", totalRepos: 999, projects });
const ov = (o: Partial<Override> & { github_id: number }): Override =>
  ({ slug: "nuxt", hidden: false, featured: false, name: null, description: null, category: null, updated_at: null, updated_by: null, ...o });

test("keeps top-N by score", () => {
  const out = mergeDataset(ds([proj(1), proj(2), proj(3)]), [], [], 2);
  assert.deepEqual(out.projects.map((p) => p.githubId), [1, 2]);
});

test("hidden entries are dropped", () => {
  const out = mergeDataset(ds([proj(1), proj(2), proj(3)]), [], [ov({ github_id: 1, hidden: true })], 5);
  assert.ok(!out.projects.some((p) => p.githubId === 1));
});

test("featured is pinned first and survives the keep cut", () => {
  // 4 has the lowest score, so without featuring it'd be cut at keep=2.
  const out = mergeDataset(ds([proj(1), proj(2), proj(3), proj(4)]), [], [ov({ github_id: 4, featured: true })], 2);
  assert.equal(out.projects[0].githubId, 4, "featured pinned to top");
  assert.equal(out.projects.length, 2, "total capped at keep, featured pinned within it");
});

test("featured entries are all kept even when they exceed keep", () => {
  const out = mergeDataset(ds([proj(1), proj(2), proj(3)]), [], [ov({ github_id: 2, featured: true }), ov({ github_id: 3, featured: true })], 1);
  const ids = out.projects.map((p) => p.githubId).sort();
  assert.deepEqual(ids, [2, 3], "both featured kept despite keep=1");
});

test("field overrides are applied", () => {
  const out = mergeDataset(ds([proj(1)]), [], [ov({ github_id: 1, name: "Renamed", category: "Docs" })], 5);
  assert.equal(out.projects[0].name, "Renamed");
  assert.equal(out.projects[0].category, "Docs");
});

test("approved manual entries are merged in (and win on id clash)", () => {
  const approved = [proj(1, { name: "Manual", stars: 50000, score: 0.99 })];
  const out = mergeDataset(ds([proj(1, { name: "Scraped" }), proj(2)]), approved, [], 5);
  const one = out.projects.find((p) => p.githubId === 1)!;
  assert.equal(one.name, "Manual", "manual entry wins");
  assert.equal(out.projects.length, 2, "deduped by id");
});
