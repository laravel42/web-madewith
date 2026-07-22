/**
 * Rate-limit-aware GitHub client for the Cloudflare Worker runtime.
 *
 * Applies the rate-limit-handling doc directly:
 *  - explicit handling for 401 / 403 / 404 / 422 / 429 / 5xx
 *  - inspects x-ratelimit-remaining / reset and secondary-limit signals
 *  - exponential backoff + honours Retry-After
 *  - ETag conditional requests (304 → free, no quota) backed by KV
 *  - never logs the token
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal KV-shaped store so this is unit-testable in Node with a Map. */
export interface EtagStore {
  get(key: string): Promise<{ etag: string; body: string } | null>;
  put(key: string, value: { etag: string; body: string }): Promise<void>;
}

export class GitHubAuthError extends Error {}
export class GitHubQueryError extends Error {} // 422 — disable partition
export class GitHubUnavailable extends Error {} // 404

export interface ClientOpts {
  token: string;
  etags?: EtagStore;
  log?: (msg: string) => void;
  /** Max attempts for transient failures (429/5xx/secondary). */
  maxAttempts?: number;
}

export class GitHub {
  private token: string;
  private etags?: EtagStore;
  private log: (m: string) => void;
  private maxAttempts: number;
  /** Rolling view of the primary rate-limit bucket for pre-emptive throttling. */
  lastRemaining = Infinity;
  lastReset = 0;

  constructor(opts: ClientOpts) {
    this.token = opts.token;
    this.etags = opts.etags;
    this.log = opts.log ?? (() => {});
    this.maxAttempts = opts.maxAttempts ?? 5;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": "madewith-scraper",
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  /** Pre-emptively pause when the bucket is nearly empty. */
  private async throttleIfLow() {
    if (this.lastRemaining <= 1 && this.lastReset) {
      const waitMs = Math.max(0, this.lastReset * 1000 - Date.now()) + 1000;
      if (waitMs > 0 && waitMs < 120_000) {
        this.log(`rate bucket empty; waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }
  }

  private track(res: Response) {
    const rem = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(rem)) this.lastRemaining = rem;
    if (Number.isFinite(reset)) this.lastReset = reset;
  }

  /** REST GET with ETag conditional requests. `cacheKey` enables 304 caching. */
  async rest<T = any>(url: string, cacheKey?: string): Promise<{ data: T; notModified: boolean }> {
    for (let attempt = 0; ; attempt++) {
      await this.throttleIfLow();
      const cached = cacheKey && this.etags ? await this.etags.get(cacheKey) : null;
      const res = await fetch(url, {
        headers: this.headers(cached ? { "If-None-Match": cached.etag } : {}),
      });
      this.track(res);

      if (res.status === 304 && cached) return { data: JSON.parse(cached.body) as T, notModified: true };
      if (res.status === 401) throw new GitHubAuthError("GitHub 401 — check the token");
      if (res.status === 404) throw new GitHubUnavailable(url);
      if (res.status === 422) throw new GitHubQueryError(`invalid query: ${url}`);

      // Only retry a 403 when it's an actual rate limit (remaining 0 or Retry-After).
      // A permanent 403 (bad scope, blocked repo) must fail fast, not spin.
      const isRateLimit = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
      if ((isRateLimit || res.status >= 500) && attempt < this.maxAttempts) {
        await this.backoff(res, attempt);
        continue;
      }
      if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);

      const body = await res.text();
      const etag = res.headers.get("etag");
      if (cacheKey && etag && this.etags) await this.etags.put(cacheKey, { etag, body });
      return { data: JSON.parse(body) as T, notModified: false };
    }
  }

  /** GraphQL POST — one request can fetch repos + languages together. */
  async graphql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttleIfLow();
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      this.track(res);

      if (res.status === 401) throw new GitHubAuthError("GitHub 401 — check the token");
      // Only retry a 403 when it's an actual rate limit (remaining 0 or Retry-After).
      // A permanent 403 (bad scope, blocked repo) must fail fast, not spin.
      const isRateLimit = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
      if ((isRateLimit || res.status >= 500) && attempt < this.maxAttempts) {
        await this.backoff(res, attempt);
        continue;
      }
      if (!res.ok) throw new Error(`GitHub GraphQL ${res.status} ${res.statusText}`);

      const json = (await res.json()) as { data?: T; errors?: Array<{ type?: string; message: string }> };
      if (json.errors?.length) {
        // RATE_LIMITED errors are retryable; others are fatal for this call.
        if (json.errors.some((e) => e.type === "RATE_LIMITED") && attempt < this.maxAttempts) {
          await this.backoff(res, attempt);
          continue;
        }
        throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
      }
      return json.data as T;
    }
  }

  /** 403/429/5xx backoff: Retry-After → reset-wait → exponential. */
  private async backoff(res: Response, attempt: number) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    let waitMs: number;
    if (Number.isFinite(retryAfter)) waitMs = retryAfter * 1000 + 500;
    else if (remaining === 0 && this.lastReset) waitMs = Math.max(0, this.lastReset * 1000 - Date.now()) + 1000;
    else waitMs = Math.min(30_000, 1000 * 2 ** attempt);
    this.log(`${res.status}; backing off ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1})`);
    await sleep(Math.max(1000, waitMs));
  }
}
