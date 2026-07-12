/**
 * MadeWith… Worker — scheduled scraper + public submissions + admin API.
 *
 *  - scheduled(): scrape every domain → store raw → merge (approved + overrides)
 *    → publish to R2 → ping the Pages deploy hook.
 *  - fetch():
 *      GET  /health
 *      GET  /data/<slug>.json          current published dataset (build hydration)
 *      POST /submit                    public project submission (validated, rate-limited)
 *      /admin/api/*                     Cloudflare Access-gated admin API
 *      POST /refresh                    legacy secret-gated full refresh
 *
 * Secrets: GITHUB_TOKEN, REFRESH_SECRET, PAGES_DEPLOY_HOOK.
 * Bindings: DATA (R2), STATE (KV), DB (D1). Access: ACCESS_TEAM_DOMAIN, ACCESS_AUD.
 */
import type { Env } from "./env";
import { GitHub } from "./github";
import { DOMAINS } from "./domains";
import { Db } from "./db";
import { scrapeAndPublish } from "./publish";
import { kvEtagStore, readDataset, readDomainConfig } from "./storage";
import { handleAdmin } from "./admin";
import { handleSubmit } from "./submit";
import { json, triggerDeploy } from "./util";

async function refreshAll(env: Env): Promise<Array<{ slug: string; published?: number; total?: number; error?: string }>> {
  const gh = new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: (m) => console.log(m) });
  const db = new Db(env.DB);
  const now = Date.now();
  const summary = [];
  for (const domain of DOMAINS) {
    try {
      const ds = await scrapeAndPublish(gh, env.DATA, db, domain, now);
      summary.push({ slug: domain.slug, published: ds.projects.length, total: ds.totalRepos });
    } catch (e) {
      // One domain failing (GitHub hiccup, etc.) must not abort the whole run.
      console.error(`scheduled scrape failed for ${domain.slug}: ${(e as Error).message}`);
      summary.push({ slug: domain.slug, error: (e as Error).message });
    }
  }
  await env.STATE.put("meta:lastRun", JSON.stringify({ at: new Date(now).toISOString(), summary }));
  await triggerDeploy(env);
  return summary;
}

function authorized(req: Request, env: Env): boolean {
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || new URL(req.url).searchParams.get("key") || "";
  const expected = env.REFRESH_SECRET || "";
  if (!expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAll(env).then((s) => console.log("refresh complete", JSON.stringify(s))).catch((e) => console.log(`refresh failed: ${(e as Error).message}`)));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, cf-access-jwt-assertion",
          "access-control-max-age": "86400",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") return json({ ok: true, domains: DOMAINS.map((d) => d.slug) });

    const dataMatch = path.match(/^\/data\/([a-z0-9-]+)\.json$/);
    if (dataMatch && req.method === "GET") {
      const bodyText = await readDataset(env.DATA, dataMatch[1]);
      if (!bodyText) return json({ error: "not found" }, 404);
      return new Response(bodyText, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300, s-maxage=3600", "access-control-allow-origin": "*" },
      });
    }

    const configMatch = path.match(/^\/config\/([a-z0-9-]+)\.json$/);
    if (configMatch && req.method === "GET") {
      const bodyText = await readDomainConfig(env.DATA, configMatch[1]);
      if (!bodyText) return json({ error: "not found" }, 404);
      return new Response(bodyText, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300, s-maxage=3600", "access-control-allow-origin": "*" },
      });
    }

    if (path === "/submit" && req.method === "POST") {
      return handleSubmit(req, new Db(env.DB), env.STATE, new Date().toISOString());
    }

    if (path === "/admin/api" || path.startsWith("/admin/api/")) {
      return handleAdmin(req, env, path, ctx);
    }

    if (path === "/refresh" && req.method === "POST") {
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
      ctx.waitUntil(refreshAll(env).catch((e) => console.log(`bg refresh failed: ${(e as Error).message}`)));
      return json({ started: true, domains: DOMAINS.map((d) => d.slug) });
    }

    return json({ error: "not found" }, 404);
  },
};
