/**
 * Discovery configuration per domain. Mirrors src/config/domain-catalog.json.
 */
import catalog from "../../src/config/domain-catalog.json";

export interface DomainDiscovery {
  slug: string;
  techName: string;
  match: string;
  exclude: string[];
  keep: number;
  /** Expected primary-language families (derived from the domain's own data). */
  languageFamilies: string[];
}

export const STAR_PARTITIONS: Array<[number, number | null]> = [
  [1000, null],
  [100, 999],
  [20, 99],
];

/** Published gallery size per domain — matches `SCRAPE_PER_DOMAIN` in scripts/scrape.mjs. */
export const DEFAULT_KEEP = 100;

export const DOMAINS: DomainDiscovery[] = catalog.map((d) => ({
  slug: d.slug,
  techName: d.techName,
  match: d.scrape.query,
  exclude: d.scrape.exclude,
  keep: DEFAULT_KEEP,
  languageFamilies: (d.scrape as { languageFamilies?: string[] }).languageFamilies ?? [],
}));

export const DOMAIN_SLUGS = DOMAINS.map((d) => d.slug);
export const getDomain = (slug: string): DomainDiscovery | undefined => DOMAINS.find((d) => d.slug === slug);
