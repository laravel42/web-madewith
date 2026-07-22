/**
 * Small storage interfaces that replace the Cloudflare bindings. Business code
 * depends on these shapes, not on any concrete backend, so the filesystem and
 * Redis adapters (storage.ts, kv.ts) are the only Cloudflare-specific bits that
 * had to change.
 */

/** Object store — R2 replacement (filesystem-backed in this deployment). */
export interface ObjectStore {
  getText(key: string): Promise<string | null>;
  getJson<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

/** Key-value store with TTL — KV replacement (Redis-backed). */
export interface Kv {
  get(key: string): Promise<string | null>;
  getJson<T = unknown>(key: string): Promise<T | null>;
  /** ttlSeconds mirrors KV's expirationTtl. */
  put(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>;
  /** Atomic increment used by the rate limiters; sets TTL on first write. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}
