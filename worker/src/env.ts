export interface Env {
  DATA: R2Bucket;
  STATE: KVNamespace;
  DB: D1Database;
  GITHUB_TOKEN: string;
  REFRESH_SECRET: string;
  /** Cloudflare Pages "Deploy hook" URL — POSTing it triggers a rebuild. */
  PAGES_DEPLOY_HOOK?: string;
  /** Cloudflare Access (admin auth). */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local dev only — set in worker/.dev.vars, never in production. */
  ADMIN_DEV_BYPASS?: string;
  /** Workers AI (optional) — LLM second opinion for low-confidence categories. */
  AI?: Ai;
}
