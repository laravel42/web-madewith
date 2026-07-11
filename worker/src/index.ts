/**
 * MadeWith… data-scraping Worker.
 *
 * Replaces scheduled GitHub Actions with a Cloudflare Cron Trigger (far cheaper):
 *  - scheduled(): scrape every domain from GitHub, write datasets to R2, append
 *    metric snapshots, then ping the Pages deploy hook so the static site
 *    rebuilds with fresh data.
 *  - fetch(): serve the current datasets (for the build to hydrate) and a
 *    secret-gated manual /refresh for on-demand runs.
 *
 * Secrets (wrangler secret put): GITHUB_TOKEN, REFRESH_SECRET, PAGES_DEPLOY_HOOK.
 */
import { GitHub } from "./github";
import { scrapeAll, scrapeDomain } from "./scrape";
import { DOMAINS } from "./domains";
import { kvEtagStore, writeDataset, readDataset } from "./storage";

export interface Env {
  DATA: R2Bucket;
  STATE: KVNamespace;
  GITHUB_TOKEN: string;
  REFRESH_SECRET: string;
  /** Cloudflare Pages "Deploy hook" URL — POSTing it triggers a rebuild. */
  PAGES_DEPLOY_HOOK?: string;
}

function client(env: Env): GitHub {
  return new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: (m) => console.log(m) });
}

async function refreshAll(env: Env): Promise<{ slug: string; kept: number; total: number }[]> {
  const gh = client(env);
  const now = Date.now();
  const datasets = await scrapeAll(gh, now);
  const summary: { slug: string; kept: number; total: number }[] = [];
  for (const slug of Object.keys(datasets)) {
    const ds = datasets[slug];
    await writeDataset(env.DATA, ds);
    summary.push({ slug, kept: ds.projects.length, total: ds.totalRepos });
  }
  await env.STATE.put("meta:lastRun", JSON.stringify({ at: new Date(now).toISOString(), summary }));
  await triggerDeploy(env);
  return summary;
}

async function triggerDeploy(env: Env): Promise<void> {
  if (!env.PAGES_DEPLOY_HOOK) return;
  try {
    await fetch(env.PAGES_DEPLOY_HOOK, { method: "POST" });
    console.log("triggered Pages deploy hook");
  } catch (e) {
    console.log(`deploy hook failed: ${(e as Error).message}`);
  }
}

/** Constant-time-ish bearer check for the manual endpoint. */
function authorized(req: Request, env: Env): boolean {
  const hdr = req.headers.get("authorization") || "";
  const bearer = hdr.replace(/^Bearer\s+/i, "");
  const url = new URL(req.url);
  const provided = bearer || url.searchParams.get("key") || "";
  const expected = env.REFRESH_SECRET || "";
  if (!expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  // Cron Trigger — the replacement for the scheduled GitHub Action.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshAll(env)
        .then((s) => console.log("refresh complete", JSON.stringify(s)))
        .catch((e) => console.log(`refresh failed: ${(e as Error).message}`)),
    );
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight for cross-origin browser access to /data/*.
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") return json({ ok: true, domains: DOMAINS.map((d) => d.slug) });

    // Public read for the build to hydrate: GET /data/<slug>.json
    const m = path.match(/^\/data\/([a-z0-9-]+)\.json$/);
    if (m && req.method === "GET") {
      const body = await readDataset(env.DATA, m[1]);
      if (!body) return json({ error: "not found" }, 404);
      return new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=300, s-maxage=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    // Secret-gated manual refresh: POST /refresh[?slug=nuxt]
    if (path === "/refresh" && req.method === "POST") {
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
      const slug = url.searchParams.get("slug");
      if (slug) {
        const domain = DOMAINS.find((d) => d.slug === slug);
        if (!domain) return json({ error: "unknown slug" }, 404);
        const ds = await scrapeDomain(client(env), domain, Date.now());
        await writeDataset(env.DATA, ds);
        await triggerDeploy(env);
        return json({ refreshed: [{ slug, kept: ds.projects.length, total: ds.totalRepos }] });
      }
      // Full refresh can outlive the request; run it in the background.
      ctx.waitUntil(refreshAll(env).catch((e) => console.log(`bg refresh failed: ${(e as Error).message}`)));
      return json({ started: true, domains: DOMAINS.map((d) => d.slug) });
    }

    return json({ error: "not found" }, 404);
  },
};
