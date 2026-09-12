import { CATEGORY_META, CATEGORY_ORDER } from "../config/categories";
import { similarProjects as rankBySimilarity } from "./similarity";

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
  /**
   * LLM-written project README (Markdown) from the discovery worker. When
   * present it replaces the templated long1/long2 in the detail page's
   * README/About block; long1/long2 stay the fallback for older entries.
   */
  descriptionMd?: string;
  stack: string[];
  updated: string;
  /**
   * ISO datetime of the default-branch tip commit (GitHub code-tab "Latest
   * commit"). Not repository-level `pushedAt` (any-branch activity).
   */
  pushedAt?: string;
  /** When the project first entered this catalog (stamped at publish; feeds sort by it). */
  addedAt?: string;
  license: string;
  langs: Lang[];
  versions?: { name: string; url: string }[];
  topics: string[];
  /** Repository stats for the detail header; absent until a scrape captures them. */
  forks?: number;
  issues?: number;
  discussions?: number;
  /** Subscribers ("Watch"), not REST's watchers_count alias for stars. */
  watchers?: number;
  /** Contributor count. Needs a per-repo /contributors call — not collected yet. */
  contributors?: number;
  /** GitHub "Used by" (dependents). No API exposes it; not collected yet. */
  usedBy?: number;
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

/** Compact relative time ("3d ago", "5w ago"), computed at render. Empty for bad/absent input. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return m <= 1 ? "just now" : `${m}m ago`;
  }
  const h = s / 3600;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  // Keep week precision through ~2 months — flooring to months at day 30
  // turned 5–7 week-old commits into a misleading "1mo ago".
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.max(1, Math.round(d / 30.44))}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** Human total for the hero ("8,584+"). Uses GitHub search total — prefer formatGalleryTotal for UI copy. */
export function formatTotal(n: number): string {
  return n.toLocaleString() + "+";
}

/** Published gallery count for hero/category copy (exact, no "+"). */
export function formatGalleryTotal(data: CatalogData): string {
  return data.projects.length.toLocaleString();
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

export interface CategoryFilter {
  label: string;
  count: number;
}

/** Top category pills for the hero filter row on a domain gallery. */
export function topCategoryFilters(data: CatalogData, limit = 5, visibleCategories?: string[] | null): CategoryFilter[] {
  const cards = categoryCards(data).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (visibleCategories && visibleCategories.length > 0) {
    const order = new Map(visibleCategories.map((l, i) => [l, i]));
    return cards
      .filter((c) => order.has(c.label))
      .sort((a, b) => (order.get(a.label)! - order.get(b.label)!))
      .slice(0, limit)
      .map(({ label, count }) => ({ label, count }));
  }
  if (visibleCategories && visibleCategories.length === 0) return [];
  return cards.slice(0, limit).map(({ label, count }) => ({ label, count }));
}

export function categoryCount(data: CatalogData): number {
  return categoryCards(data).length;
}

/** Related projects for a detail page — ranked by multi-signal similarity. */
export function relatedProjects(data: CatalogData, current: Project, n = 3) {
  return rankBySimilarity(data.projects, current, n);
}
