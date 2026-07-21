import { api, esc } from "./admin";

type SettingParam = {
  key: string;
  label: string;
  scope: string;
  configured: boolean;
  required: boolean;
  preview: string | null;
  purpose: string;
  configure: string;
};

type SettingsResponse = {
  email: string;
  access: { mode: string; teamDomain: string | null; audConfigured: boolean };
  scrape: { domainCount: number; keepPerDomain: number };
  groups: Array<{ title: string; parameters: SettingParam[] }>;
};

const SITE_GROUPS = [
  {
    title: "Site & Pages",
    parameters: [
      {
        key: "ADMIN_WORKER_URL",
        label: "Admin worker URL",
        required: true,
        purpose: "Pages Function proxy target for /admin/api/*.",
        configure: "Cloudflare Pages env · Local: .env (default http://127.0.0.1:8787)",
      },
      {
        key: "ADMIN_DEV_BYPASS",
        label: "Admin dev bypass (Pages)",
        required: false,
        purpose: "Pages Function sends x-admin-dev-bypass when proxying to localhost.",
        configure: "functions env ADMIN_DEV_BYPASS=true for local Pages preview",
      },
      {
        key: "PUBLIC_API_BASE",
        label: "Public API base",
        required: false,
        purpose: "Worker URL for the public submit form (POST /submit).",
        configure: ".env PUBLIC_API_BASE=… · Pages env in production",
      },
      {
        key: "DATABASE_URL",
        label: "Postgres (build hydration)",
        required: false,
        purpose: "scripts/pull-data.mjs publishes src/data/*.json from repositories before astro build.",
        configure: "Root .env DATABASE_URL=postgresql://…",
      },
      {
        key: "MADEWITH_DATA_BASE_URL",
        label: "Build data URL (fallback)",
        required: false,
        purpose: "Legacy fallback: pull-data fetches /data/*.json from the Worker when DATABASE_URL is unset.",
        configure: ".env or CI secret",
      },
    ],
  },
  {
    title: "Local tooling",
    parameters: [
      {
        key: "GITHUB_TOKEN",
        label: "GitHub token (site scrape)",
        required: false,
        purpose: "pnpm scrape — Scrapy GitHub discovery into Postgres.",
        configure: "Root .env GITHUB_TOKEN=…",
      },
      {
        key: "SCRAPE_KEEP",
        label: "Scrape keep per domain",
        required: false,
        purpose: "Max projects per domain in scrape:publish / pull-data (default 1000).",
        configure: "Root .env SCRAPE_KEEP=…",
      },
    ],
  },
];

function statusBadge(ok: boolean, required: boolean) {
  if (ok) return `<span class="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">OK</span>`;
  if (required) return `<span class="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">Missing</span>`;
  return `<span class="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">Optional</span>`;
}

function accessBadge(mode: string) {
  if (mode === "cloudflare-access") return statusBadge(true, true);
  if (mode === "dev-bypass") return `<span class="text-xs font-medium px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">Dev bypass</span>`;
  return statusBadge(false, true);
}

function renderParamRows(params: SettingParam[]) {
  return params
    .map(
      (p) => `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
        <td class="p-4 align-top"><code class="text-xs font-semibold text-gray-900 dark:text-white">${esc(p.key)}</code><div class="mt-1 text-sm text-gray-600 dark:text-gray-400">${esc(p.label)}</div></td>
        <td class="p-4 align-top text-sm text-gray-600 dark:text-gray-400">${esc(p.purpose)}</td>
        <td class="p-4 align-top whitespace-nowrap">${statusBadge(p.configured, p.required)}</td>
        <td class="p-4 align-top text-xs font-mono text-gray-500 dark:text-gray-400">${p.preview ? esc(p.preview) : "—"}</td>
        <td class="p-4 align-top text-xs text-gray-500 dark:text-gray-400">${esc(p.configure)}</td>
      </tr>`,
    )
    .join("");
}

function renderSiteRows(workerOk: boolean) {
  return SITE_GROUPS.map((group) => {
    const rows = group.parameters
      .map((p) => {
        let configured = false;
        if (p.key === "ADMIN_WORKER_URL") configured = workerOk;
        if (p.key === "PUBLIC_API_BASE") configured = !!import.meta.env.PUBLIC_API_BASE;
        return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
          <td class="p-4 align-top"><code class="text-xs font-semibold text-gray-900 dark:text-white">${esc(p.key)}</code><div class="mt-1 text-sm text-gray-600 dark:text-gray-400">${esc(p.label)}</div></td>
          <td class="p-4 align-top text-sm text-gray-600 dark:text-gray-400">${esc(p.purpose)}</td>
          <td class="p-4 align-top whitespace-nowrap">${statusBadge(configured, p.required)}</td>
          <td class="p-4 align-top text-xs font-mono text-gray-500 dark:text-gray-400">—</td>
          <td class="p-4 align-top text-xs text-gray-500 dark:text-gray-400">${esc(p.configure)}</td>
        </tr>`;
      })
      .join("");
    return `<tr><td colspan="5" class="px-4 pt-6 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${esc(group.title)}</td></tr>${rows}`;
  }).join("");
}

function renderTable(title: string, rows: string) {
  return `<section class="overflow-hidden shadow rounded-lg mb-6">
    <div class="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
      <h2 class="text-sm font-semibold text-gray-900 dark:text-white">${esc(title)}</h2>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
        <thead class="bg-gray-100 dark:bg-gray-700">
          <tr>
            <th class="p-4 text-xs font-medium text-left text-gray-600 uppercase dark:text-gray-300">Parameter</th>
            <th class="p-4 text-xs font-medium text-left text-gray-600 uppercase dark:text-gray-300">Purpose</th>
            <th class="p-4 text-xs font-medium text-left text-gray-600 uppercase dark:text-gray-300">Status</th>
            <th class="p-4 text-xs font-medium text-left text-gray-600 uppercase dark:text-gray-300">Preview</th>
            <th class="p-4 text-xs font-medium text-left text-gray-600 uppercase dark:text-gray-300">How to set</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">${rows}</tbody>
      </table>
    </div>
  </section>`;
}

export async function initSettingsPage() {
  const root = document.getElementById("settings-root");
  if (!root) return;

  try {
    const s = (await api("settings")) as SettingsResponse;
    const missing = s.groups.flatMap((g) => g.parameters).filter((p) => p.required && !p.configured);
    const missingBanner = missing.length
      ? `<div class="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p class="font-semibold">Action required</p>
          <ul class="mt-2 list-disc pl-5 space-y-1">${missing.map((p) => `<li><code class="font-mono text-xs">${esc(p.key)}</code> — ${esc(p.configure)}</li>`).join("")}</ul>
        </div>`
      : "";

    const workerGroups = s.groups
      .map((g) => `<tr><td colspan="5" class="px-4 pt-6 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${esc(g.title)}</td></tr>${renderParamRows(g.parameters)}`)
      .join("");

    root.innerHTML = `
      ${missingBanner}
      <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Worker API</p>
          <p class="mt-2 text-lg font-semibold text-green-700 dark:text-green-400">Connected</p>
        </div>
        <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Admin auth</p>
          <p class="mt-2">${accessBadge(s.access.mode)}</p>
        </div>
        <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Domains / keep</p>
          <p class="mt-2 text-lg font-semibold text-gray-900 dark:text-white">${s.scrape.domainCount} · ${s.scrape.keepPerDomain} each</p>
        </div>
        <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Signed in as</p>
          <p class="mt-2 text-sm font-semibold text-gray-900 dark:text-white truncate">${esc(s.email)}</p>
        </div>
      </div>
      ${renderTable("Worker (Cloudflare)", workerGroups)}
      ${renderTable("Site, Pages & local dev", renderSiteRows(true))}
      <p class="text-xs text-gray-500 dark:text-gray-400">Secrets are never shown in full — only configured/missing status and a masked preview. Set worker secrets in <code class="font-mono">worker/.dev.vars</code> locally or via <code class="font-mono">wrangler secret put</code>.</p>`;
  } catch (e) {
    root.innerHTML = `
      <div class="mb-6 p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Worker unreachable: ${esc((e as Error).message)}. Start the worker (<code class="font-mono">cd worker && npm run dev</code>) and set <code class="font-mono">ADMIN_WORKER_URL</code> in <code class="font-mono">.env</code>.
      </div>
      ${renderTable("Site, Pages & local dev (worker offline)", renderSiteRows(false))}
      <p class="text-xs text-gray-500 dark:text-gray-400">Worker settings load when <code class="font-mono">/admin/api/settings</code> is reachable.</p>`;
  }
}
