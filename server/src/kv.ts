/**
 * Redis-backed key-value store — KV replacement. Same TTL semantics the Worker
 * relied on (etags, rate-limit counters, JWKS→now unused, AI-category cache,
 * meta:lastRun). The ETag store keeps the exact `etag:<key>` layout.
 */
import { Redis } from "ioredis";
import type { Kv } from "./types";
import type { EtagStore } from "./github";

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3 });
}

export function redisKv(redis: Redis): Kv {
  return {
    async get(key: string): Promise<string | null> {
      return redis.get(key);
    },
    async getJson<T>(key: string): Promise<T | null> {
      const value = await redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    },
    async put(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void> {
      if (opts?.ttlSeconds) await redis.set(key, value, "EX", opts.ttlSeconds);
      else await redis.set(key, value);
    },
    async incr(key: string, ttlSeconds: number): Promise<number> {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttlSeconds); // set TTL only on first write
      return n;
    },
  };
}

/** ETag store for conditional GitHub requests (was KV, now Redis). */
export function kvEtagStore(kv: Kv): EtagStore {
  return {
    async get(key) {
      return kv.getJson<{ etag: string; body: string }>(`etag:${key}`);
    },
    async put(key, value) {
      // ETags are disposable; expire them so the store can't grow unbounded.
      await kv.put(`etag:${key}`, JSON.stringify(value), { ttlSeconds: 60 * 60 * 24 * 30 });
    },
  };
}
