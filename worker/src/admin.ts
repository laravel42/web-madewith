/**
 * Admin API — every route is gated by Cloudflare Access. Covers the full flow:
 * overview stats, submission moderation, per-entry overrides (hide/feature/edit),
 * and manual refresh (scrape) / republish (re-apply overrides, no scrape).
 */
import type { Env } from "./env";
import { verifyAccess } from "./access";
import { Db, type Override } from "./db";
import { GitHub } from "./github";
import { DOMAINS, getDomain, DEFAULT_KEEP } from "./domains";
import { scrapeRepo, parseRepoUrl } from "./scrape";
import { publishFromRaw, scrapeAndPublish } from "./publish";
import { kvEtagStore, readRaw, readDataset, writeDomainConfig } from "./storage";
import { json, triggerDeploy } from "./util";
import { baselineForSlug, mergeDomainSettings, type DomainSettingsPayload } from "./domain-settings";
import { buildAdminSettings } from "./settings";

const ghClient = (env: Env) => new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: (m) => console.log(m) });

async function galleryProjectCount(r2: Env["DATA"], slug: string): Promise<number> {
  const [pubText, raw] = await Promise.all([readDataset(r2, slug), readRaw(r2, slug)]);
  if (pubText) {
    try {
      const n = JSON.parse(pubText).projects?.length;
      if (typeof n === "number" && n > 0) return n;
    } catch { /* ignore */ }
  }
  return raw?.projects?.length ?? 0;
}

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

  // GET /admin/api/settings
  if (seg[0] === "settings" && method === "GET") {
    return json(buildAdminSettings(env, identity));
  }

  // GET /admin/api/overview
  if (seg[0] === "overview" && method === "GET") {
    const [lastRun, pending, domains] = await Promise.all([
      env.STATE.get("meta:lastRun", "json"),
      db.countPending(),
      Promise.all(DOMAINS.map(async (d) => {
        const [raw, pubText, published] = await Promise.all([
          readRaw(env.DATA, d.slug),
          readDataset(env.DATA, d.slug),
          galleryProjectCount(env.DATA, d.slug),
        ]);
        let pub: any = null;
        if (pubText) { try { pub = JSON.parse(pubText); } catch (e) { console.error(`bad published dataset for ${d.slug}: ${(e as Error).message}`); } }
        return { slug: d.slug, techName: d.techName, published, total: pub?.totalRepos ?? raw?.totalRepos ?? 0, scrapedAt: pub?.scrapedAt ?? raw?.scrapedAt ?? null, hasRaw: !!raw };
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
        const merged = await publishFromRaw(env.DATA, db, sub.slug, getDomain(sub.slug)?.keep ?? DEFAULT_KEEP);
        ctx.waitUntil(triggerDeploy(env));
        return json({ ok: true, status: "approved", published: merged?.projects.length ?? 0 });
      }
      return json({ error: "unknown action" }, 400);
    }
  }

  // ---- newsletter subscribers ----
  if (seg[0] === "newsletter" && method === "GET") {
    const filter = {
      status: url.searchParams.get("status") || undefined,
      slug: url.searchParams.get("slug") || undefined,
    };
    if (seg[1] === "export") {
      const rows = await db.listNewsletterSubscribers(filter, 100_000);
      const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [
        "email,scope,slug,status,created_at,unsubscribed_at",
        ...rows.map((r) => [r.email, r.scope, r.slug, r.status, r.created_at, r.unsubscribed_at].map(cell).join(",")),
      ].join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="newsletter-subscribers.csv"`,
        },
      });
    }
    const [stats, subscribers] = await Promise.all([
      db.newsletterStats(),
      db.listNewsletterSubscribers(filter),
    ]);
    return json({ stats, subscribers });
  }

  // ---- domain page settings ----
  if (seg[0] === "domains") {
    if (method === "GET" && !seg[1]) {
      const overrides = await db.listDomainSettings();
      const ovMap = new Map(overrides.map((o) => [o.slug, o.data]));
      const domains = await Promise.all(DOMAINS.map(async (d) => {
        const baseline = baselineForSlug(d.slug);
        const merged = mergeDomainSettings(baseline, ovMap.get(d.slug) ?? null);
        const published = await galleryProjectCount(env.DATA, d.slug);
        return { slug: d.slug, techName: d.techName, group: merged.group ?? baseline.group, domain: merged.domain ?? baseline.domain, pageUrl: merged.pageUrl ?? baseline.pageUrl, published, hasOverrides: ovMap.has(d.slug) };
      }));
      return json({ domains });
    }

    if (seg[1]) {
      const slug = seg[1];
      const dcfg = getDomain(slug);
      if (!dcfg) return json({ error: "unknown domain" }, 404);

      if (method === "GET") {
        const baseline = baselineForSlug(slug);
        const override = await db.getDomainSettings(slug);
        const merged = mergeDomainSettings(baseline, override);
        const [raw, overrides, approved, pubText] = await Promise.all([
          readRaw(env.DATA, slug),
          db.overridesFor(slug),
          db.approvedFor(slug),
          readDataset(env.DATA, slug),
        ]);
        const ov = new Map(overrides.map((o) => [o.github_id, o]));
        const manualIds = new Set(approved.map((a) => a.githubId));
        const base = [...(raw?.projects ?? []), ...approved];
        const seen = new Set<number>();
        const entries = base.filter((p) => (seen.has(p.githubId) ? false : (seen.add(p.githubId), true))).map((p) => ({
          githubId: p.githubId, name: p.name, author: p.author, stars: p.stars, category: p.category,
          manual: manualIds.has(p.githubId), hidden: !!ov.get(p.githubId)?.hidden, featured: !!ov.get(p.githubId)?.featured,
        }));

        let published: any[] = [];
        if (pubText) { try { published = JSON.parse(pubText).projects ?? []; } catch { /* ignore */ } }
        const categoryCounts: Record<string, number> = {};
        for (const p of published.length ? published : base) {
          categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
        }

        return json({ slug, baseline, override, merged, entries, categoryCounts });
      }

      if (method === "POST") {
        const payload: DomainSettingsPayload = {
          eyebrow: strOrNull(body.eyebrow),
          heroTitle: strOrNull(body.heroTitle),
          heroHeadline: strOrNull(body.heroHeadline),
          tagline: strOrNull(body.tagline),
          domain: strOrNull(body.domain),
          pageUrl: strOrNull(body.pageUrl),
          seoTitle: strOrNull(body.seoTitle),
          seoDescription: strOrNull(body.seoDescription),
          group: validGroup(body.group),
          visibleCategories: Array.isArray(body.visibleCategories) ? body.visibleCategories.map(String) : body.visibleCategories === null ? null : undefined,
        };
        await db.upsertDomainSettings(slug, payload, identity.email, nowIso);
        const baseline = baselineForSlug(slug);
        const merged = mergeDomainSettings(baseline, payload);
        await writeDomainConfig(env.DATA, slug, { slug, ...merged, updatedAt: nowIso });
        ctx.waitUntil(triggerDeploy(env));
        return json({ ok: true, merged });
      }
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
      if (!env.GITHUB_TOKEN?.trim()) {
        return json({ error: "GITHUB_TOKEN is not configured on the worker", refreshed: [] }, 503);
      }
      const gh = ghClient(env);
      const results: Array<{ slug: string; published?: number; error?: string; log?: string }> = [];
      const logs: string[] = [];
      for (const d of targets) {
        const started = Date.now();
        logs.push(`[${d.slug}] scrape started`);
        try {
          const ds = await scrapeAndPublish(gh, env.DATA, db, d, Date.now(), { ai: env.AI, kv: env.STATE });
          const ms = Date.now() - started;
          const line = `[${d.slug}] ok — ${ds.projects.length} projects, ecosystem ${ds.totalRepos} (${ms}ms)`;
          logs.push(line);
          results.push({ slug: d.slug, published: ds.projects.length, log: line });
        } catch (err) {
          const msg = (err as Error).message;
          console.error(`refresh failed for ${d.slug}: ${msg}`);
          logs.push(`[${d.slug}] failed — ${msg}`);
          results.push({ slug: d.slug, error: msg });
        }
      }
      if (targets.length > 1 || !body.slug) {
        await env.STATE.put("meta:lastRun", JSON.stringify({ at: new Date().toISOString(), summary: results }));
      }
      ctx.waitUntil(triggerDeploy(env));
      return json({ refreshed: results, logs });
    }
    const results: Array<{ slug: string; published?: number; error?: string; log?: string }> = [];
    const logs: string[] = [];
    for (const d of targets) {
      logs.push(`[${d.slug}] republish started`);
      const merged = await publishFromRaw(env.DATA, db, d.slug, d.keep);
      if (!merged) {
        const msg = "no raw dataset — run Refresh (scrape) first";
        logs.push(`[${d.slug}] skipped — ${msg}`);
        results.push({ slug: d.slug, published: 0, error: msg });
        continue;
      }
      const line = `[${d.slug}] ok — ${merged.projects.length} projects`;
      logs.push(line);
      results.push({ slug: d.slug, published: merged.projects.length, log: line });
    }
    ctx.waitUntil(triggerDeploy(env));
    return json({ republished: results, logs });
  }

  return json({ error: "not found" }, 404);
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

const DOMAIN_GROUPS = ["frameworks", "frontend", "backend", "cms-crm", "commerce", "ai-llm"] as const;

function validGroup(v: unknown): DomainSettingsPayload["group"] {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v);
  return DOMAIN_GROUPS.includes(s as (typeof DOMAIN_GROUPS)[number]) ? (s as DomainSettingsPayload["group"]) : undefined;
}
