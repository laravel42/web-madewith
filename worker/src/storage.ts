import type { EtagStore } from "./github";
import type { DomainDataset } from "./scrape";

/** KV-backed ETag store for conditional GitHub requests. */
export function kvEtagStore(kv: KVNamespace): EtagStore {
  return {
    async get(key) {
      return (await kv.get(`etag:${key}`, "json")) as { etag: string; body: string } | null;
    },
    async put(key, value) {
      // ETags are disposable; expire them so KV can't grow unbounded.
      await kv.put(`etag:${key}`, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 30 });
    },
  };
}

const PUBLISHED = (slug: string) => `data/${slug}.json`;
const RAW = (slug: string) => `raw/${slug}.json`;
const SNAPSHOT = (slug: string, iso: string) => `snapshots/${slug}/${iso}.json`;
const JSON_META = { contentType: "application/json" };

/** Raw scrape output, kept so we can re-publish (re-apply overrides) without re-scraping. */
export async function writeRaw(r2: R2Bucket, dataset: DomainDataset): Promise<void> {
  await r2.put(RAW(dataset.slug), JSON.stringify(dataset), { httpMetadata: JSON_META });
}

export async function readRaw(r2: R2Bucket, slug: string): Promise<DomainDataset | null> {
  const obj = await r2.get(RAW(slug));
  return obj ? ((await obj.json()) as DomainDataset) : null;
}

/** The dataset the site renders. Writes the current file + an append-only metric snapshot. */
export async function writePublished(r2: R2Bucket, dataset: DomainDataset): Promise<void> {
  await r2.put(PUBLISHED(dataset.slug), JSON.stringify(dataset), { httpMetadata: JSON_META });
  const snapshot = {
    scrapedAt: dataset.scrapedAt,
    totalRepos: dataset.totalRepos,
    metrics: dataset.projects.map((p) => ({ githubId: p.githubId, stars: p.stars, score: p.score, featured: !!p.featured })),
  };
  await r2.put(SNAPSHOT(dataset.slug, dataset.scrapedAt), JSON.stringify(snapshot), { httpMetadata: JSON_META });
}

export async function readDataset(r2: R2Bucket, slug: string): Promise<string | null> {
  const obj = await r2.get(PUBLISHED(slug));
  return obj ? obj.text() : null;
}
