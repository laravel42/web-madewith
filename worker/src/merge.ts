/**
 * Publish-time merge: raw scraped data + approved manual entries + editorial
 * overrides → the dataset the static site actually renders.
 *
 * Rules:
 *  - Approved manual entries are added (dedup by GitHub id; a manual entry wins).
 *  - Overrides can hide an entry, edit its name/description/category, or feature it.
 *  - Featured entries are pinned to the top and always kept; the rest fill up to
 *    `keep`, ranked by quality score.
 */
import type { Project, DomainDataset } from "./scrape";
import type { Override } from "./db";

export function mergeDataset(raw: DomainDataset, approved: Project[], overrides: Override[], keep: number): DomainDataset {
  const ov = new Map(overrides.map((o) => [o.github_id, o]));

  const byId = new Map<number, Project>();
  for (const p of raw.projects) byId.set(p.githubId, p);
  for (const p of approved) byId.set(p.githubId, p); // manual entries added / win

  const projects: Project[] = [];
  for (const p of byId.values()) {
    const o = ov.get(p.githubId);
    if (o?.hidden) continue;
    projects.push({
      ...p,
      name: o?.name || p.name,
      desc: o?.description || p.desc,
      category: o?.category || p.category,
      featured: !!o?.featured,
    });
  }

  projects.sort((a, b) => Number(b.featured) - Number(a.featured) || b.score - a.score);
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured).slice(0, Math.max(0, keep - featured.length));

  return { ...raw, projects: [...featured, ...rest] };
}
