import { GitHub } from "./github";
import { scrapeDomain, type DomainDataset } from "./scrape";
import type { DomainDiscovery } from "./domains";
import { Db } from "./db";
import { mergeDataset } from "./merge";
import { writeRaw, readRaw, writePublished } from "./storage";

/** Re-publish from the stored raw scrape (re-applies approved entries + overrides). No GitHub calls. */
export async function publishFromRaw(r2: R2Bucket, db: Db, slug: string, keep: number): Promise<DomainDataset | null> {
  const raw = await readRaw(r2, slug);
  if (!raw) return null;
  const [approved, overrides] = await Promise.all([db.approvedFor(slug), db.overridesFor(slug)]);
  const merged = mergeDataset(raw, approved, overrides, keep);
  await writePublished(r2, merged);
  return merged;
}

/** Scrape a domain from GitHub, store raw, then merge + publish. */
export async function scrapeAndPublish(gh: GitHub, r2: R2Bucket, db: Db, domain: DomainDiscovery, now: number): Promise<DomainDataset> {
  const raw = await scrapeDomain(gh, domain, now);
  await writeRaw(r2, raw);
  const [approved, overrides] = await Promise.all([db.approvedFor(domain.slug), db.overridesFor(domain.slug)]);
  const merged = mergeDataset(raw, approved, overrides, domain.keep);
  await writePublished(r2, merged);
  return merged;
}
