import { GitHub } from "./github";
import { scrapeDomain, type DomainDataset } from "./scrape";
import type { DomainDiscovery } from "./domains";
import { Db } from "./db";
import { mergeDataset } from "./merge";
import { writeRaw, readRaw, writePublished } from "./storage";
import { refineCategories } from "./ai";
import type { ObjectStore, Kv } from "./types";

export interface RefineOpts {
  /** Redis KV for the per-repo AI-answer cache. */
  kv?: Kv;
  /** OpenAI key — low-confidence categories get an LLM second opinion. */
  openaiApiKey?: string;
  openaiModel?: string;
}

/** Re-publish from the stored raw scrape (re-applies approved entries + overrides). No GitHub calls. */
export async function publishFromRaw(store: ObjectStore, db: Db, slug: string, keep: number): Promise<DomainDataset | null> {
  const raw = await readRaw(store, slug);
  if (!raw) return null;
  const [approved, overrides] = await Promise.all([db.approvedFor(slug), db.overridesFor(slug)]);
  const merged = mergeDataset(raw, approved, overrides, keep);
  await writePublished(store, merged);
  return merged;
}

/** Scrape a domain from GitHub, store raw, then merge + publish. */
export async function scrapeAndPublish(gh: GitHub, store: ObjectStore, db: Db, domain: DomainDiscovery, now: number, refine?: RefineOpts): Promise<DomainDataset> {
  const raw = await scrapeDomain(gh, domain, now);
  if (refine?.kv && refine.openaiApiKey) {
    const n = await refineCategories(refine.kv, raw.projects, { apiKey: refine.openaiApiKey, model: refine.openaiModel });
    if (n) console.log(`ai reclassified ${n} low-confidence repos in ${domain.slug}`);
  }
  await writeRaw(store, raw);
  const [approved, overrides] = await Promise.all([db.approvedFor(domain.slug), db.overridesFor(domain.slug)]);
  const merged = mergeDataset(raw, approved, overrides, domain.keep);
  await writePublished(store, merged);
  return merged;
}
