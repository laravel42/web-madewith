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
}
