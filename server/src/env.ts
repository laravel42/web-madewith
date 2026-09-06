/**
 * Runtime context — the Node replacement for the Worker's `Env` bindings.
 * Builds the Postgres pool, Redis client, filesystem object store, and admin Db,
 * and reads configuration from process.env. Shared by the HTTP server and the
 * cron CLI.
 */
import { Pool } from "pg";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Db } from "./db";
import { fsStore } from "./storage";
import { createRedis, redisKv } from "./kv";
import { createAnalytics, type Analytics } from "./posthog";
import type { ObjectStore, Kv } from "./types";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppEnv {
  db: Db;
  store: ObjectStore;
  kv: Kv;
  /** Server-side PostHog capture (no-op when no token is configured). */
  analytics: Analytics;
  githubToken: string;
  refreshSecret: string;
  /** OpenAI (low-confidence category refinement + the chat widget). */
  openaiApiKey?: string;
  openaiClassifyModel?: string;
  /** Admin auth. */
  adminPassword?: string;
  adminToken?: string;
  sessionSecret: string;
  secureCookies: boolean;
  /** Infobip AI Assistant (the /api/chat widget backend). */
  infobipApiKey?: string;
  infobipBaseUrl?: string;
  infobipAssistantId: string;
  /** Best-effort rebuild trigger after publish (e.g. a Ploi deploy webhook). */
  rebuildHook?: string;
  dataDir: string;
  port: number;
}

export interface Runtime {
  env: AppEnv;
  pool: Pool;
  close(): Promise<void>;
}

/** Build the shared runtime. Callers own its lifecycle via close(). */
export function createRuntime(): Runtime {
  const databaseUrl = process.env.SCRAPE_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  const dataDir = resolve(process.env.DATA_DIR || join(REPO_ROOT, "server", ".data"));

  const pool = new Pool({ connectionString: databaseUrl });
  const redis = createRedis(redisUrl);
  const store = fsStore(dataDir);
  const kv = redisKv(redis);
  const db = new Db(pool);
  // Reuses the site token from the root .env; POSTHOG_* overrides for server-only setups.
  const analytics = createAnalytics(
    process.env.POSTHOG_PROJECT_TOKEN || process.env.PUBLIC_POSTHOG_PROJECT_TOKEN,
    process.env.POSTHOG_HOST || process.env.PUBLIC_POSTHOG_HOST,
  );

  const env: AppEnv = {
    db,
    store,
    kv,
    analytics,
    githubToken: process.env.GITHUB_TOKEN || "",
    refreshSecret: process.env.REFRESH_SECRET || "",
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiClassifyModel: process.env.OPENAI_CLASSIFY_MODEL || undefined,
    adminPassword: process.env.ADMIN_PASSWORD || undefined,
    adminToken: process.env.ADMIN_TOKEN || undefined,
    sessionSecret: process.env.SESSION_SECRET || "",
    secureCookies: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "true",
    infobipApiKey: process.env.INFOBIP_API_KEY || undefined,
    infobipBaseUrl: process.env.INFOBIP_BASE_URL || undefined,
    infobipAssistantId: process.env.INFOBIP_ASSISTANT_ID || "1014612c-95ad-4488-9ab6-b05c8f538b08",
    rebuildHook: process.env.REBUILD_HOOK || undefined,
    dataDir,
    port: Number(process.env.PORT || 8787),
  };

  return {
    env,
    pool,
    async close() {
      await Promise.allSettled([analytics.shutdown(), pool.end(), redis.quit()]);
    },
  };
}
