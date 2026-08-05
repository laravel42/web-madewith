/**
 * HTTP surface (Hono) — ports every route from the Worker's fetch() handler,
 * plus the folded-in Infobip chat route and the app-level admin login/logout.
 * Handlers are written against web Request/Response, so they carry over verbatim
 * via `c.req.raw`.
 */
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { DOMAINS } from "./domains";
import { handleSubmit } from "./submit";
import { handleNewsletter } from "./newsletter";
import { handleAdmin } from "./admin";
import { handleLogin, handleLogout } from "./auth";
import { handleChat } from "./chat";
import { readDataset, readDomainConfig } from "./storage";
import { refreshAll } from "./refresh";

const SLUG = /^[a-z0-9-]+$/;
const jsonHeaders = { "content-type": "application/json", "cache-control": "public, max-age=300" };

/** Allow browser POSTs from the static site when PUBLIC_API_BASE is cross-origin. */
async function corsPublic(c: any, next: () => Promise<void>) {
  const origin = c.req.header("Origin") || "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  await next();
  for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
}

/** Constant-time refresh-secret check (ports the Worker's `authorized`). */
function authorized(req: Request, env: AppEnv): boolean {
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || new URL(req.url).searchParams.get("key") || "";
  const expected = env.refreshSecret || "";
  if (!expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function createApp(env: AppEnv) {
  const app = new Hono();

  // Public form POSTs may come from the static site origin (Pages / local Astro)
  // when PUBLIC_API_BASE points at this host. Same-origin proxy skips CORS.
  // /api/* are the canonical paths (no static-page collision); the bare
  // /newsletter and /submit aliases predate them and are kept for old clients.
  app.use("/newsletter", corsPublic);
  app.use("/submit", corsPublic);
  app.use("/api/newsletter", corsPublic);
  app.use("/api/submit", corsPublic);
  app.use("/api/chat", corsPublic);

  app.get("/health", (c) => c.json({ ok: true, domains: DOMAINS.map((d) => d.slug) }));

  // Build hydration source (MADEWITH_DATA_BASE_URL) + runtime dataset reads.
  app.get("/data/:file", async (c) => {
    const file = c.req.param("file");
    const slug = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !SLUG.test(slug)) return c.json({ error: "not found" }, 404);
    const text = await readDataset(env.store, slug);
    return text ? new Response(text, { headers: jsonHeaders }) : c.json({ error: "not found" }, 404);
  });

  app.get("/config/:file", async (c) => {
    const file = c.req.param("file");
    const slug = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !SLUG.test(slug)) return c.json({ error: "not found" }, 404);
    const text = await readDomainConfig(env.store, slug);
    return text ? new Response(text, { headers: jsonHeaders }) : c.json({ error: "not found" }, 404);
  });

  // Public APIs.
  for (const path of ["/submit", "/api/submit"]) {
    app.post(path, (c) => handleSubmit(c.req.raw, env.db, env.kv, new Date().toISOString(), env.analytics));
  }
  for (const path of ["/newsletter", "/api/newsletter"]) {
    app.post(path, (c) => handleNewsletter(c.req.raw, env.db, env.kv, new Date().toISOString(), env.analytics));
  }
  app.post("/api/chat", (c) => handleChat(c.req.raw, env));

  // Admin auth + API (specific routes before the wildcard).
  app.post("/admin/api/login", (c) => handleLogin(c.req.raw, env));
  app.post("/admin/api/logout", () => Promise.resolve(handleLogout(env)));
  app.all("/admin/api/*", (c) => handleAdmin(c.req.raw, env, new URL(c.req.url).pathname));

  // Legacy secret-gated full refresh.
  app.post("/refresh", (c) => {
    if (!authorized(c.req.raw, env)) return c.json({ error: "unauthorized" }, 401);
    refreshAll(env).catch((e) => console.log(`bg refresh failed: ${(e as Error).message}`));
    return c.json({ started: true, domains: DOMAINS.map((d) => d.slug) });
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
