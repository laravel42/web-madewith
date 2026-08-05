/** Public project submission: validate, rate-limit, store as pending for moderation (Postgres + PostHog). */
import { Db } from "./db";
import { DOMAIN_SLUGS } from "./domains";
import { CATEGORIES } from "./classify";
import { noopAnalytics, type Analytics } from "./posthog";
import type { Kv } from "./types";
import { json, clientIp } from "./util";

export interface SubmitInput {
  slug: string;
  repo_url: string;
  name: string;
  description: string | null;
  category: string | null;
  demo_url: string | null;
}

const GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i;
const cap = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export function validateSubmission(body: any): { ok: true; value: SubmitInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid body" };
  const slug = cap(body.slug, 40).toLowerCase();
  if (!DOMAIN_SLUGS.includes(slug)) return { ok: false, error: "unknown domain" };

  const repo_url = cap(body.repo_url, 200);
  if (!GITHUB_REPO.test(repo_url)) return { ok: false, error: "repo_url must be a https://github.com/owner/repo URL" };

  const name = cap(body.name, 100);
  if (!name) return { ok: false, error: "name is required" };

  const category = body.category ? cap(body.category, 40) : null;
  if (category && !CATEGORIES.includes(category as any)) return { ok: false, error: "unknown category" };

  const demo_url = body.demo_url ? cap(body.demo_url, 200) : null;
  if (demo_url && !/^https?:\/\//i.test(demo_url)) return { ok: false, error: "demo_url must be http(s)" };

  return { ok: true, value: { slug, repo_url, name, description: cap(body.description, 400) || null, category, demo_url } };
}

/** Simple per-IP daily cap so the queue can't be flooded. */
async function rateLimited(kv: Kv, ip: string, day: string, limit = 20): Promise<boolean> {
  const n = await kv.incr(`submitcount:${ip}:${day}`, 60 * 60 * 26);
  return n > limit;
}

export async function handleSubmit(
  req: Request,
  db: Db,
  kv: Kv,
  nowIso: string,
  analytics: Analytics = noopAnalytics,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const v = validateSubmission(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const day = nowIso.slice(0, 10);
  if (await rateLimited(kv, clientIp(req), day)) return json({ error: "rate limit — try again tomorrow" }, 429);

  const id = await db.insertSubmission({ ...v.value, created_at: nowIso });

  // Mirror the stored record into PostHog, attached to the submitter's person
  // when the form forwarded their browser distinct_id.
  analytics.capture("project_submission_recorded", cap(body.distinct_id, 200) || `submission:${id}`, {
    submission_id: id,
    slug: v.value.slug,
    repo_url: v.value.repo_url,
    name: v.value.name,
    description: v.value.description,
    category: v.value.category,
    demo_url: v.value.demo_url,
    submission_status: "pending",
  });

  return json({ ok: true, id, status: "pending" }, 201);
}
