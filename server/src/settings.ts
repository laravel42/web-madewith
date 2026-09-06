/** Admin settings introspection — never returns full secret values. Node/Ploy edition. */
import type { AppEnv } from "./env";
import type { AdminIdentity } from "./auth";
import { DOMAINS, DEFAULT_KEEP } from "./domains";

export interface SettingParam {
  key: string;
  label: string;
  scope: "secret" | "config" | "service";
  configured: boolean;
  required: boolean;
  preview: string | null;
  purpose: string;
  configure: string;
}

export interface SettingsPayload {
  email: string;
  access: {
    mode: "app-auth" | "misconfigured";
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

export function buildAdminSettings(env: AppEnv, identity: AdminIdentity): SettingsPayload {
  const secrets: SettingParam[] = [
    {
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      scope: "secret",
      configured: has(env.githubToken),
      required: true,
      preview: preview(env.githubToken),
      purpose: "Scrape GitHub for Refresh, submission approval, and cron runs.",
      configure: ".env GITHUB_TOKEN=… (server) / Ploi environment",
    },
    {
      key: "OPENAI_API_KEY",
      label: "OpenAI key",
      scope: "secret",
      configured: has(env.openaiApiKey),
      required: false,
      preview: preview(env.openaiApiKey),
      purpose: "Powers the chat widget and the LLM second opinion for low-confidence category classifications.",
      configure: ".env OPENAI_API_KEY=…",
    },
    {
      key: "REFRESH_SECRET",
      label: "Refresh secret",
      scope: "secret",
      configured: has(env.refreshSecret),
      required: false,
      preview: preview(env.refreshSecret),
      purpose: "Gates POST /refresh outside the admin UI.",
      configure: ".env REFRESH_SECRET=…",
    },
  ];

  const auth: SettingParam[] = [
    {
      key: "ADMIN_PASSWORD",
      label: "Admin password",
      scope: "secret",
      configured: has(env.adminPassword),
      required: true,
      preview: has(env.adminPassword) ? "••••••••" : null,
      purpose: "Password for the /admin login (issues a signed session cookie).",
      configure: ".env ADMIN_PASSWORD=…",
    },
    {
      key: "ADMIN_TOKEN",
      label: "Admin API token",
      scope: "secret",
      configured: has(env.adminToken),
      required: false,
      preview: preview(env.adminToken),
      purpose: "Bearer token for automation calls to /admin/api/*.",
      configure: ".env ADMIN_TOKEN=…",
    },
    {
      key: "SESSION_SECRET",
      label: "Session secret",
      scope: "secret",
      configured: has(env.sessionSecret),
      required: true,
      preview: preview(env.sessionSecret),
      purpose: "HMAC key that signs admin session cookies.",
      configure: ".env SESSION_SECRET=…",
    },
    {
      key: "REBUILD_HOOK",
      label: "Rebuild hook",
      scope: "config",
      configured: has(env.rebuildHook),
      required: false,
      preview: has(env.rebuildHook) ? "set" : null,
      purpose: "Best-effort URL pinged after a publish to rebuild the static site (e.g. a Ploi deploy webhook).",
      configure: ".env REBUILD_HOOK=…",
    },
  ];

  const services: SettingParam[] = [
    {
      key: "DATABASE_URL",
      label: "Postgres",
      scope: "service",
      configured: !!env.db,
      required: true,
      preview: env.db ? "connected" : null,
      purpose: "Submissions, approved entries, overrides, domain settings, subscribers.",
      configure: ".env DATABASE_URL=postgres://…",
    },
    {
      key: "REDIS_URL",
      label: "Redis",
      scope: "service",
      configured: !!env.kv,
      required: true,
      preview: env.kv ? "connected" : null,
      purpose: "GitHub ETag cache, rate-limit counters, AI-category cache, last-run metadata.",
      configure: ".env REDIS_URL=redis://…",
    },
    {
      key: "DATA_DIR",
      label: "Data directory",
      scope: "service",
      configured: has(env.dataDir),
      required: true,
      preview: env.dataDir,
      purpose: "Filesystem store for raw scrape, published datasets, and domain config JSON.",
      configure: ".env DATA_DIR=/path/to/data",
    },
    {
      key: "INFOBIP",
      label: "Infobip AI Assistant",
      scope: "service",
      configured: has(env.infobipApiKey) && has(env.infobipBaseUrl),
      required: false,
      preview: has(env.infobipApiKey) ? "configured" : null,
      purpose: "Backs the public /api/chat widget.",
      configure: ".env INFOBIP_API_KEY / INFOBIP_BASE_URL",
    },
  ];

  return {
    email: identity.email,
    access: {
      mode: has(env.adminPassword) && has(env.sessionSecret) ? "app-auth" : "misconfigured",
      teamDomain: null,
      audConfigured: false,
    },
    scrape: { domainCount: DOMAINS.length, keepPerDomain: DEFAULT_KEEP },
    groups: [
      { title: "Secrets", parameters: secrets },
      { title: "Admin auth", parameters: auth },
      { title: "Services", parameters: services },
    ],
  };
}
