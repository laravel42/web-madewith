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

const CURRENT = (slug: string) => `data/${slug}.json`;
const SNAPSHOT = (slug: string, iso: string) => `snapshots/${slug}/${iso}.json`;

/** Write the current dataset to R2 and append an immutable metric snapshot. */
export async function writeDataset(r2: R2Bucket, dataset: DomainDataset): Promise<void> {
  const httpMetadata = { contentType: "application/json" };
  await r2.put(CURRENT(dataset.slug), JSON.stringify(dataset), { httpMetadata });
  // Append-only snapshot (never overwrite metrics) — the resume/audit rule.
  const snapshot = {
    scrapedAt: dataset.scrapedAt,
    totalRepos: dataset.totalRepos,
    metrics: dataset.projects.map((p) => ({ githubId: p.githubId, stars: p.stars, score: p.score })),
  };
  await r2.put(SNAPSHOT(dataset.slug, dataset.scrapedAt), JSON.stringify(snapshot), { httpMetadata });
}

export async function readDataset(r2: R2Bucket, slug: string): Promise<string | null> {
  const obj = await r2.get(CURRENT(slug));
  return obj ? obj.text() : null;
}
