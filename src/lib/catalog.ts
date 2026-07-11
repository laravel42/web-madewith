import { CATEGORY_META, CATEGORY_ORDER } from "../config/categories";

export interface Lang { name: string; pct: number; }

export interface Project {
  slug: string;
  name: string;
  fullName: string;
  category: string;
  stars: number;
  author: string;
  avatar: string;
  desc: string;
  demo: string | null;
  repoUrl: string;
  long1: string;
  long2: string;
  stack: string[];
  updated: string;
  license: string;
  langs: Lang[];
  topics: string[];
}

export interface CatalogData {
  slug: string;
  scrapedAt: string;
  source: string;
  totalRepos: number;
  projects: Project[];
}

/** Eagerly import every scraped domain dataset at build time. */
const files = import.meta.glob<CatalogData>("../data/*.json", { eager: true, import: "default" });
const BY_SLUG: Record<string, CatalogData> = {};
for (const path in files) {
  const data = files[path];
  BY_SLUG[data.slug] = data;
}

export function getCatalog(slug: string): CatalogData {
  const data = BY_SLUG[slug];
  if (!data) throw new Error(`No scraped data for "${slug}". Run: npm run scrape`);
  return data;
}

/** Format a star count the GitHub way: 3200 → "3.2k". */
export function formatStars(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : "" + n;
}

/** Human total for the hero ("8,584+"). */
export function formatTotal(n: number): string {
  return n.toLocaleString() + "+";
}

/** Projects sorted by stars, enriched with display fields + 1-based rank. */
export function rankedProjects(data: CatalogData): (Project & { rank: string; starsLabel: string; initial: string })[] {
  return [...data.projects]
    .sort((a, b) => b.stars - a.stars)
    .map((p, i) => ({
      ...p,
      rank: (i < 9 ? "0" : "") + (i + 1),
      starsLabel: formatStars(p.stars),
      initial: p.author.charAt(0).toUpperCase(),
    }));
}

/** Category cards for the browse screen (only categories that have projects). */
export function categoryCards(data: CatalogData) {
  return CATEGORY_ORDER
    .map((label) => ({
      label,
      count: data.projects.filter((p) => p.category === label).length,
      blurb: CATEGORY_META[label].blurb,
    }))
    .filter((c) => c.count > 0);
}

export function categoryCount(data: CatalogData): number {
  return categoryCards(data).length;
}

/** Related projects for a detail page: same category first, then fill from the rest. */
export function relatedProjects(data: CatalogData, current: Project, n = 3) {
  const ranked = rankedProjects(data);
  const sameCat = ranked.filter((p) => p.slug !== current.slug && p.category === current.category);
  const others = ranked.filter((p) => p.slug !== current.slug && p.category !== current.category);
  return [...sameCat, ...others].slice(0, n);
}
