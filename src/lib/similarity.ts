import type { Project } from "./catalog";

/** Tunable weights — must sum to 1. */
export const SIMILARITY_WEIGHTS = {
  category: 0.22,
  topics: 0.32,
  stack: 0.18,
  langs: 0.12,
  stars: 0.11,
  author: 0.05,
} as const;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function tokenSet(values: string[]): Set<string> {
  return new Set(values.map(norm).filter(Boolean));
}

/** |A ∩ B| / |A ∪ B| — 0 when either set is empty. */
export function jaccard(a: string[], b: string[]): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Overlap of language share (0–1). Uses min pct for shared languages. */
export function languageSimilarity(
  a: { name: string; pct: number }[],
  b: { name: string; pct: number }[],
): number {
  const bm = new Map(b.map((l) => [norm(l.name), l.pct]));
  let overlap = 0;
  for (const l of a) {
    const pct = bm.get(norm(l.name));
    if (pct != null) overlap += Math.min(l.pct, pct);
  }
  return overlap / 100;
}

/** 1 when star counts are in the same log bucket; decays with log distance. */
export function starProximity(a: number, b: number): number {
  const la = Math.log10(Math.max(1, a));
  const lb = Math.log10(Math.max(1, b));
  const diff = Math.abs(la - lb);
  return Math.max(0, 1 - diff / 3); // ~0 beyond 1000× star gap
}

export interface SimilarityBreakdown {
  score: number;
  category: number;
  topics: number;
  stack: number;
  langs: number;
  stars: number;
  author: number;
}

/** Weighted similarity between two catalog projects (0–1). */
export function similarityScore(current: Project, candidate: Project): SimilarityBreakdown {
  const w = SIMILARITY_WEIGHTS;
  const category = current.category === candidate.category ? 1 : 0;
  const topics = jaccard(current.topics, candidate.topics);
  const stack = jaccard(current.stack, candidate.stack);
  const langs = languageSimilarity(current.langs, candidate.langs);
  const stars = starProximity(current.stars, candidate.stars);
  const author = norm(current.author) === norm(candidate.author) ? 1 : 0;

  const score =
    w.category * category +
    w.topics * topics +
    w.stack * stack +
    w.langs * langs +
    w.stars * stars +
    w.author * author;

  return { score, category, topics, stack, langs, stars, author };
}

export interface RankedSimilar extends Project {
  similarity: number;
}

/**
 * Rank candidates by multi-signal similarity to `current`.
 * Tie-break: higher stars, then name (stable, deterministic).
 */
export function similarProjects(projects: Project[], current: Project, n = 3): Project[] {
  return projects
    .filter((p) => p.slug !== current.slug)
    .map((p) => ({ project: p, ...similarityScore(current, p) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.project.stars !== a.project.stars) return b.project.stars - a.project.stars;
      return a.project.name.localeCompare(b.project.name);
    })
    .slice(0, n)
    .map((r) => r.project);
}

/** Same as similarProjects but exposes scores (for debugging / admin). */
export function similarProjectsRanked(projects: Project[], current: Project, n = 3): RankedSimilar[] {
  return projects
    .filter((p) => p.slug !== current.slug)
    .map((p) => {
      const breakdown = similarityScore(current, p);
      return { ...p, similarity: breakdown.score };
    })
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (b.stars !== a.stars) return b.stars - a.stars;
      return a.name.localeCompare(b.name);
    })
    .slice(0, n);
}
