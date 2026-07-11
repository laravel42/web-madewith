/**
 * Discovery configuration per domain. Mirrors the site's domains but adds the
 * GitHub search inputs. Discovery is partitioned by star range (per the
 * rate-limit doc) so each partition stays inside GitHub's 1,000-result search
 * ceiling and pages predictably.
 */
export interface DomainDiscovery {
  slug: string;
  techName: string;
  /** GitHub search qualifier for this technology (topic or free text). */
  match: string;
  /** Drop these full_names (framework core repos) from results. */
  exclude: string[];
  /** How many projects to keep in the published dataset. */
  keep: number;
}

/** Star-range partitions — keeps every search under the 1,000-result cap. */
export const STAR_PARTITIONS: Array<[number, number | null]> = [
  [1000, null],
  [100, 999],
  [20, 99],
];

export const DOMAINS: DomainDiscovery[] = [
  { slug: "nuxt",     match: "topic:nuxt",        techName: "Nuxt",     keep: 12, exclude: ["nuxt/nuxt", "nuxt/framework"] },
  { slug: "node",     match: "topic:nodejs",      techName: "Node",     keep: 12, exclude: ["nodejs/node"] },
  { slug: "next",     match: "topic:nextjs",      techName: "Next",     keep: 12, exclude: ["vercel/next.js"] },
  { slug: "ionic",    match: "topic:ionic",       techName: "Ionic",    keep: 12, exclude: ["ionic-team/ionic-framework", "ionic-team/ionic"] },
  { slug: "statamic", match: "topic:statamic",    techName: "Statamic", keep: 12, exclude: ["statamic/cms", "statamic/statamic"] },
  { slug: "twill",    match: "twill laravel cms", techName: "Twill",    keep: 12, exclude: ["area17/twill"] },
];
