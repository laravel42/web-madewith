/**
 * Same-origin admin API proxy (Cloudflare Pages Function).
 *
 * The /admin/* path (this proxy + the /admin UI) sits behind one Cloudflare
 * Access application, so the browser talks only to its own origin — no CORS,
 * no cross-site cookies. Access injects the `Cf-Access-Jwt-Assertion` header;
 * we forward it to the scraper Worker, which verifies it and does the work.
 *
 * Pages env: ADMIN_WORKER_URL = the Worker's base URL
 * (e.g. https://madewith-scraper.<account>.workers.dev).
 */
export async function onRequest(context: {
  request: Request;
  params: { path?: string | string[] };
  env: { ADMIN_WORKER_URL?: string };
}): Promise<Response> {
  const { request, params, env } = context;
  if (!env.ADMIN_WORKER_URL) {
    return json({ error: "ADMIN_WORKER_URL is not configured on the Pages project" }, 500);
  }

  const sub = Array.isArray(params.path) ? params.path.join("/") : params.path || "";
  const inUrl = new URL(request.url);
  const target = `${env.ADMIN_WORKER_URL.replace(/\/+$/, "")}/admin/api/${sub}${inUrl.search}`;

  const headers = new Headers();
  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (jwt) headers.set("cf-access-jwt-assertion", jwt);
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.text();

  const res = await fetch(target, init);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" },
  });
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
