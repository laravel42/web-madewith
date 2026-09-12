import { DOMAINS } from "../config/domains";
import { getCatalog, type Project } from "./catalog";

/**
 * Network-wide author index.
 *
 * Each gallery's `?author=` filter only ever searches its own catalog, so an
 * owner with repos in several galleries always under-reported — 20% of authors
 * span more than one. This builds the cross-gallery view once at build time.
 */

export interface AuthorEntry {
  project: Project;
  /** Gallery whose card styling and detail link this entry uses. */
  techSlug: string;
  techName: string;
  /**
   * Every gallery the repo is catalogued in. A repo tagged for several stacks
   * (vercel/ai is in next, react, svelte and vue) is ONE card listing all of
   * them — listing it once per gallery filled the page with near-identical
   * cards that differed only in accent colour.
   */
  galleries: { slug: string; techName: string }[];
}

export interface AuthorRecord {
  /** Lowercased login — the URL segment. */
  login: string;
  /** Login as GitHub spells it, taken from the most-starred project. */
  display: string;
  avatar: string;
  entries: AuthorEntry[];
  /** Distinct gallery slugs, most projects first. */
  galleries: { slug: string; techName: string; count: number }[];
  stars: number;
}

let cache: Map<string, AuthorRecord> | null = null;

function build(): Map<string, AuthorRecord> {
  const byLogin = new Map<string, AuthorRecord>();
  for (const theme of DOMAINS) {
    let data;
    try {
      data = getCatalog(theme.slug);
    } catch {
      continue; // a gallery with no scraped data yet
    }
    for (const project of data.projects) {
      const login = (project.author || "").toLowerCase();
      if (!login) continue;
      let rec = byLogin.get(login);
      if (!rec) {
        rec = { login, display: project.author, avatar: project.avatar, entries: [], galleries: [], stars: 0 };
        byLogin.set(login, rec);
      }
      rec.entries.push({ project, techSlug: theme.slug, techName: theme.techName, galleries: [] });
    }
  }
  for (const rec of byLogin.values()) {
    // How many listings each gallery holds for this author, before dedupe —
    // used only to pick which gallery a multi-gallery repo is shown under.
    const weight = new Map<string, number>();
    for (const e of rec.entries) weight.set(e.techSlug, (weight.get(e.techSlug) ?? 0) + 1);

    // One card per repository, carrying every gallery it appears in.
    const byRepo = new Map<string, AuthorEntry[]>();
    for (const e of rec.entries) {
      const key = (e.project.fullName || e.project.slug).toLowerCase();
      (byRepo.get(key) ?? byRepo.set(key, []).get(key)!).push(e);
    }
    rec.entries = [...byRepo.values()].map((group) => {
      const primary = [...group].sort(
        (a, b) => (weight.get(b.techSlug) ?? 0) - (weight.get(a.techSlug) ?? 0) || a.techName.localeCompare(b.techName),
      )[0];
      return {
        ...primary,
        galleries: group
          .map((e) => ({ slug: e.techSlug, techName: e.techName }))
          .sort((a, b) => a.techName.localeCompare(b.techName)),
      };
    });

    // Most-starred project wins the casing and the avatar — a stale avatar on
    // an old fork shouldn't represent the owner.
    rec.entries.sort((a, b) => (b.project.stars || 0) - (a.project.stars || 0));
    rec.display = rec.entries[0].project.author;
    rec.avatar = rec.entries[0].project.avatar;
    rec.stars = rec.entries.reduce((n, e) => n + (e.project.stars || 0), 0);

    // Chips count every gallery a repo appears in, not just the one its card is
    // styled as — otherwise the headline undercounted the galleries and the
    // chips contradicted the per-card labels. They sum above the repo count,
    // which is correct: one repo can belong to several galleries.
    const counts = new Map<string, { slug: string; techName: string; count: number }>();
    for (const e of rec.entries) {
      for (const gal of e.galleries) {
        const g = counts.get(gal.slug) ?? { slug: gal.slug, techName: gal.techName, count: 0 };
        g.count += 1;
        counts.set(gal.slug, g);
      }
    }
    rec.galleries = [...counts.values()].sort((a, b) => b.count - a.count || a.techName.localeCompare(b.techName));
  }
  return byLogin;
}

export function authorIndex(): Map<string, AuthorRecord> {
  if (!cache) cache = build();
  return cache;
}

export function getAuthor(login: string): AuthorRecord | undefined {
  return authorIndex().get((login || "").toLowerCase());
}

/**
 * Authors that get their own page: anyone the gallery filter cannot fully
 * answer for. That means more than one repo, OR a single repo catalogued in
 * several galleries — the page is then the only place that says where else it
 * appears. Owners of one repo in one gallery are excluded (~19,000 of them):
 * their filter is already complete, and the page would restate the project the
 * visitor just came from.
 */
function qualifies(a: AuthorRecord): boolean {
  return a.entries.length > 1 || (a.entries[0]?.galleries.length ?? 0) > 1;
}

export function pagedAuthors(): AuthorRecord[] {
  return [...authorIndex().values()].filter(qualifies);
}

/** True when this author has a page — decides whether to link to it. */
export function hasAuthorPage(login: string): boolean {
  const rec = getAuthor(login);
  return !!rec && qualifies(rec);
}

export function authorHref(login: string): string {
  return `/author/${encodeURIComponent((login || "").toLowerCase())}/`;
}
