/**
 * Filesystem-backed object store — R2 replacement. Keys map to files under
 * DATA_DIR, preserving the original R2 key layout so nothing downstream (or the
 * build's MADEWITH_DATA_BASE_URL hydration) has to change:
 *   data/<slug>.json  config/<slug>.json  raw/<slug>.json
 *   snapshots/<slug>/<iso>.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectStore } from "./types";
import type { DomainDataset } from "./scrape";

export function fsStore(baseDir: string): ObjectStore {
  const resolve = (key: string) => join(baseDir, key);

  async function getText(key: string): Promise<string | null> {
    try {
      return await readFile(resolve(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  return {
    getText,
    async getJson<T>(key: string): Promise<T | null> {
      const text = await getText(key);
      return text ? (JSON.parse(text) as T) : null;
    },
    async put(key: string, value: string): Promise<void> {
      const path = resolve(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value, "utf8");
    },
  };
}

const PUBLISHED = (slug: string) => `data/${slug}.json`;
const CONFIG = (slug: string) => `config/${slug}.json`;
const RAW = (slug: string) => `raw/${slug}.json`;
// ":" is legal on Linux ext4 but not everywhere — normalise for portability.
const SNAPSHOT = (slug: string, iso: string) => `snapshots/${slug}/${iso.replace(/:/g, "-")}.json`;

/** Raw scrape output, kept so we can re-publish (re-apply overrides) without re-scraping. */
export async function writeRaw(store: ObjectStore, dataset: DomainDataset): Promise<void> {
  await store.put(RAW(dataset.slug), JSON.stringify(dataset));
}

export async function readRaw(store: ObjectStore, slug: string): Promise<DomainDataset | null> {
  return store.getJson<DomainDataset>(RAW(slug));
}

/** The dataset the site renders. Writes the current file + an append-only metric snapshot. */
export async function writePublished(store: ObjectStore, dataset: DomainDataset): Promise<void> {
  await store.put(PUBLISHED(dataset.slug), JSON.stringify(dataset));
  const snapshot = {
    scrapedAt: dataset.scrapedAt,
    totalRepos: dataset.totalRepos,
    metrics: dataset.projects.map((p) => ({ githubId: p.githubId, stars: p.stars, score: p.score, featured: !!p.featured })),
  };
  await store.put(SNAPSHOT(dataset.slug, dataset.scrapedAt), JSON.stringify(snapshot));
}

export async function readDataset(store: ObjectStore, slug: string): Promise<string | null> {
  return store.getText(PUBLISHED(slug));
}

export async function writeDomainConfig(store: ObjectStore, slug: string, config: unknown): Promise<void> {
  await store.put(CONFIG(slug), JSON.stringify(config));
}

export async function readDomainConfig(store: ObjectStore, slug: string): Promise<string | null> {
  return store.getText(CONFIG(slug));
}
