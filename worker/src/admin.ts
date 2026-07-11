/**
 * Admin API — every route is gated by Cloudflare Access. Covers the full flow:
 * overview stats, submission moderation, per-entry overrides (hide/feature/edit),
 * and manual refresh (scrape) / republish (re-apply overrides, no scrape).
 */
import type { Env } from "./env";
import { verifyAccess } from "./access";
import { Db, type Override } from "./db";
import { GitHub } from "./github";
import { DOMAINS, getDomain } from "./domains";
import { scrapeRepo, parseRepoUrl } from "./scrape";
import { publishFromRaw, scrapeAndPublish } from "./publish";
import { kvEtagStore, readRaw, readDataset } from "./storage";
import { json, triggerDeploy } from "./util";

const ghClient = (env: Env) => new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: (m) => console.log(m) });

export async function handleAdmin(req: Request, env: Env, path: string, ctx: ExecutionContext): Promise<Response> {
  const identity = await verifyAccess(req, env);
  if (!identity) return json({ error: "unauthorized" }, 401);

  const db = new Db(env.DB);
  const url = new URL(req.url);
  const seg = path.replace(/^\/admin\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const nowIso = new Date().toISOString();
  const body: any = method === "POST" ? await req.json().catch(() => ({})) : {};

  // GET /admin/api/me
  if (seg[0] === "me") return json({ email: identity.email });

  // GET /admin/api/overview
  if (seg[0] === "overview" && method === "GET") {
    const [lastRun, pending, domains] = await Promise.all([
      env.STATE.get("meta:lastRun", "json"),
      db.countPending(),
      Promise.all(DOMAINS.map(async (d) => {
        const [raw, pubText] = await Promise.all([readRaw(env.DATA, d.slug), readDataset(env.DATA, d.slug)]);
        let pub: any = null;
        if (pubText) { try { pub = JSON.parse(pubText); } catch (e) { console.error(`bad published dataset for ${d.slug}: ${(e as Error).message}`); } }
        return { slug: d.slug, techName: d.techName, published: pub?.projects.length ?? 0, total: pub?.totalRepos ?? 0, scrapedAt: pub?.scrapedAt ?? null, hasRaw: !!raw };
      })),
    ]);
    return json({ email: identity.email, pending, lastRun, domains });
  }

  // ---- submissions ----
  if (seg[0] === "submissions") {
    if (method === "GET" && !seg[1]) return json({ submissions: await db.listSubmissions(url.searchParams.get("status") || undefined) });
    if (method === "POST" && seg[1]) {
      const sub = await db.getSubmission(Number(seg[1]));
      if (!sub) return json({ error: "not found" }, 404);
      const note = typeof body.note === "string" ? body.note.slice(0, 400) : null;
      if (body.action === "reject") {
        await db.decideSubmission(sub.id, "rejected", identity.email, note, nowIso);
        return json({ ok: true, status: "rejected" });
      }
      if (body.action === "approve") {
        const parsed = parseRepoUrl(sub.repo_url);
        if (!parsed) return json({ error: "invalid repo_url" }, 400);
        let project;
        try {
          project = await scrapeRepo(ghClient(env), parsed.owner, parsed.name, Date.now());
        } catch (err) {
          return json({ error: `GitHub scrape failed: ${(err as Error).message}` }, 502);
        }
        if (!project) return json({ error: "repo not found on GitHub" }, 404);
        if (sub.category) project.category = sub.category;
        await db.upsertApproved(sub.slug, project, nowIso);
        await db.decideSubmission(sub.id, "approved", identity.email, note, nowIso);
        const merged = await publishFromRaw(env.DATA, db, sub.slug, getDomain(sub.slug)?.keep ?? 12);
        ctx.waitUntil(triggerDeploy(env));
        return json({ ok: true, status: "approved", published: merged?.projects.length ?? 0 });
      }
      return json({ error: "unknown action" }, 400);
    }
  }

  // ---- entries (per domain) ----
  if (seg[0] === "entries" && seg[1]) {
    const slug = seg[1];
    const dcfg = getDomain(slug);
    if (!dcfg) return json({ error: "unknown domain" }, 404);

    if (method === "GET" && !seg[2]) {
      const [raw, overrides, approved] = await Promise.all([readRaw(env.DATA, slug), db.overridesFor(slug), db.approvedFor(slug)]);
      const ov = new Map(overrides.map((o) => [o.github_id, o]));
      const manualIds = new Set(approved.map((a) => a.githubId));
      const base = [...(raw?.projects ?? []), ...approved];
      const seen = new Set<number>();
      const entries = base.filter((p) => (seen.has(p.githubId) ? false : (seen.add(p.githubId), true))).map((p) => ({
        githubId: p.githubId, name: p.name, author: p.author, stars: p.stars, category: p.category, score: p.score,
        manual: manualIds.has(p.githubId), override: ov.get(p.githubId) ?? null,
      }));
      return json({ slug, entries });
    }

    if (method === "POST" && seg[2]) {
      const o: Override = {
        slug, github_id: Number(seg[2]),
        hidden: !!body.hidden, featured: !!body.featured,
        name: body.name || null, description: body.description || null, category: body.category || null,
        updated_at: nowIso, updated_by: identity.email,
      };
      await db.upsertOverride(o);
      const merged = await publishFromRaw(env.DATA, db, slug, dcfg.keep);
      ctx.waitUntil(triggerDeploy(env));
      return json({ ok: true, published: merged?.projects.length ?? 0 });
    }
  }

  // ---- refresh (scrape) / republish (no scrape) ----
  if ((seg[0] === "refresh" || seg[0] === "republish") && method === "POST") {
    const targets = body.slug ? DOMAINS.filter((d) => d.slug === body.slug) : DOMAINS;
    if (!targets.length) return json({ error: "unknown domain" }, 404);
    if (seg[0] === "refresh") {
      const gh = ghClient(env);
      const results = [];
      for (const d of targets) {
        try { results.push({ slug: d.slug, published: (await scrapeAndPublish(gh, env.DATA, db, d, Date.now())).projects.length }); }
        catch (err) { console.error(`refresh failed for ${d.slug}: ${(err as Error).message}`); results.push({ slug: d.slug, error: (err as Error).message }); }
      }
      ctx.waitUntil(triggerDeploy(env));
      return json({ refreshed: results });
    }
    const results = [];
    for (const d of targets) results.push({ slug: d.slug, published: (await publishFromRaw(env.DATA, db, d.slug, d.keep))?.projects.length ?? 0 });
    ctx.waitUntil(triggerDeploy(env));
    return json({ republished: results });
  }

  return json({ error: "not found" }, 404);
}
