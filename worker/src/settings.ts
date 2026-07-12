/** Admin settings introspection — never returns full secret values. */
import type { Env } from "./env";
import type { AccessIdentity } from "./access";
import { DOMAINS, DEFAULT_KEEP } from "./domains";

export interface SettingParam {
  key: string;
  label: string;
  scope: "worker-secret" | "worker-var" | "binding";
  configured: boolean;
  required: boolean;
  preview: string | null;
  purpose: string;
  configure: string;
}

export interface SettingsPayload {
  email: string;
  access: {
    mode: "cloudflare-access" | "dev-bypass" | "misconfigured";
    teamDomain: string | null;
    audConfigured: boolean;
  };
  scrape: { domainCount: number; keepPerDomain: number };
  groups: Array<{ title: string; parameters: SettingParam[] }>;
}

function has(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function preview(v: unknown): string | null {
  if (!has(v)) return null;
  const s = String(v).trim();
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function buildAdminSettings(env: Env, identity: AccessIdentity): SettingsPayload {
  const accessConfigured = has(env.ACCESS_TEAM_DOMAIN) && has(env.ACCESS_AUD);
  const devBypass = env.ADMIN_DEV_BYPASS === "true";

  const secrets: SettingParam[] = [
    {
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      scope: "worker-secret",
      configured: has(env.GITHUB_TOKEN),
      required: true,
      preview: preview(env.GITHUB_TOKEN),
      purpose: "Scrape GitHub for Refresh, submission approval, and cron runs.",
      configure: "Local: worker/.dev.vars · Production: wrangler secret put GITHUB_TOKEN",
    },
    {
      key: "REFRESH_SECRET",
      label: "Refresh secret",
      scope: "worker-secret",
      configured: has(env.REFRESH_SECRET),
      required: false,
      preview: preview(env.REFRESH_SECRET),
      purpose: "Gates legacy POST /refresh outside the admin UI.",
      configure: "Local: worker/.dev.vars · Production: wrangler secret put REFRESH_SECRET",
    },
    {
      key: "PAGES_DEPLOY_HOOK",
      label: "Pages deploy hook",
      scope: "worker-secret",
      configured: has(env.PAGES_DEPLOY_HOOK),
      required: false,
      preview: preview(env.PAGES_DEPLOY_HOOK),
      purpose: "Triggers a Cloudflare Pages rebuild after publish/refresh.",
      configure: "Production: wrangler secret put PAGES_DEPLOY_HOOK",
    },
  ];

  const vars: SettingParam[] = [
    {
      key: "ACCESS_TEAM_DOMAIN",
      label: "Access team domain",
      scope: "worker-var",
      configured: has(env.ACCESS_TEAM_DOMAIN),
      required: !devBypass,
      preview: has(env.ACCESS_TEAM_DOMAIN) ? String(env.ACCESS_TEAM_DOMAIN) : null,
      purpose: "Cloudflare Access JWKS issuer (yourteam.cloudflareaccess.com).",
      configure: "wrangler.jsonc vars or wrangler secret",
    },
    {
      key: "ACCESS_AUD",
      label: "Access AUD tag",
      scope: "worker-var",
      configured: has(env.ACCESS_AUD),
      required: !devBypass,
      preview: preview(env.ACCESS_AUD),
      purpose: "Audience tag for the /admin Access application.",
      configure: "wrangler.jsonc vars or dashboard",
    },
    {
      key: "ADMIN_DEV_BYPASS",
      label: "Admin dev bypass",
      scope: "worker-var",
      configured: devBypass,
      required: false,
      preview: devBypass ? "true" : null,
      purpose: "Local dev only — allows admin API without Access when true.",
      configure: "worker/.dev.vars (never enable in production)",
    },
  ];

  const bindings: SettingParam[] = [
    {
      key: "DATA",
      label: "R2 DATA bucket",
      scope: "binding",
      configured: !!env.DATA,
      required: true,
      preview: env.DATA ? "bound" : null,
      purpose: "Raw scrape, published datasets, domain config JSON.",
      configure: "worker/wrangler.jsonc → r2_buckets",
    },
    {
      key: "STATE",
      label: "KV STATE",
      scope: "binding",
      configured: !!env.STATE,
      required: true,
      preview: env.STATE ? "bound" : null,
      purpose: "GitHub ETag cache, JWKS cache, last-run metadata.",
      configure: "worker/wrangler.jsonc → kv_namespaces",
    },
    {
      key: "DB",
      label: "D1 admin database",
      scope: "binding",
      configured: !!env.DB,
      required: true,
      preview: env.DB ? "bound" : null,
      purpose: "Submissions, overrides, domain settings.",
      configure: "worker/wrangler.jsonc → d1_databases + migrations apply",
    },
  ];

  return {
    email: identity.email,
    access: {
      mode: accessConfigured ? "cloudflare-access" : devBypass ? "dev-bypass" : "misconfigured",
      teamDomain: has(env.ACCESS_TEAM_DOMAIN) ? String(env.ACCESS_TEAM_DOMAIN) : null,
      audConfigured: has(env.ACCESS_AUD),
    },
    scrape: { domainCount: DOMAINS.length, keepPerDomain: DEFAULT_KEEP },
    groups: [
      { title: "Worker secrets", parameters: secrets },
      { title: "Worker configuration", parameters: vars },
      { title: "Worker bindings", parameters: bindings },
    ],
  };
}
