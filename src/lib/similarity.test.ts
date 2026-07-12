import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project } from "./catalog.ts";
import { jaccard, languageSimilarity, similarProjects, similarityScore, starProximity } from "./similarity.ts";

const base = (over: Partial<Project> = {}): Project => ({
  slug: "alpha",
  name: "Alpha",
  fullName: "org/alpha",
  category: "DevTools",
  stars: 1000,
  author: "org",
  avatar: "",
  desc: "CLI toolkit",
  demo: null,
  repoUrl: "https://github.com/org/alpha",
  long1: "",
  long2: "",
  stack: ["TypeScript", "Cli"],
  updated: "today",
  license: "MIT",
  langs: [{ name: "TypeScript", pct: 90 }, { name: "JavaScript", pct: 10 }],
  topics: ["cli", "devtools", "typescript"],
  ...over,
});

describe("similarity", () => {
  it("jaccard returns 0 for empty overlap inputs", () => {
    assert.equal(jaccard([], ["a"]), 0);
    assert.equal(jaccard(["a"], []), 0);
  });

  it("jaccard scores shared tokens", () => {
    assert.equal(jaccard(["a", "b"], ["b", "c"]), 1 / 3);
  });

  it("languageSimilarity sums min pct for shared langs", () => {
    const a = [{ name: "TypeScript", pct: 80 }, { name: "Go", pct: 20 }];
    const b = [{ name: "TypeScript", pct: 60 }, { name: "Rust", pct: 40 }];
    assert.equal(languageSimilarity(a, b), 0.6);
  });

  it("starProximity decays with log distance", () => {
    assert.equal(starProximity(1000, 1000), 1);
    assert.ok(starProximity(100, 10_000) < starProximity(1000, 2000));
  });

  it("prefers same category and topic overlap", () => {
    const current = base();
    const close = base({
      slug: "beta",
      name: "Beta",
      fullName: "x/beta",
      topics: ["cli", "devtools", "node"],
      stack: ["TypeScript", "Cli"],
    });
    const far = base({
      slug: "gamma",
      name: "Gamma",
      fullName: "x/gamma",
      category: "Blogs",
      topics: ["blog", "cms"],
      stack: ["PHP"],
      langs: [{ name: "PHP", pct: 100 }],
      stars: 50_000,
    });
    assert.ok(similarityScore(current, close).score > similarityScore(current, far).score);
  });

  it("similarProjects returns top n excluding self", () => {
    const current = base();
    const pool = [
      current,
      base({ slug: "b", name: "B", topics: ["cli", "devtools"] }),
      base({ slug: "c", name: "C", category: "Blogs", topics: ["blog"] }),
      base({ slug: "d", name: "D", topics: ["cli", "typescript", "node"] }),
    ];
    const related = similarProjects(pool, current, 2);
    assert.equal(related.length, 2);
    assert.ok(related.every((p) => p.slug !== current.slug));
    assert.ok(related.every((p) => p.slug !== "c")); // blog project ranks last
    assert.deepEqual(new Set(related.map((p) => p.slug)), new Set(["b", "d"]));
  });
});
