/** Public newsletter signup: validate, rate-limit, persist to Postgres. */
import { Db } from "./db";
import { DOMAIN_SLUGS } from "./domains";
import type { Kv } from "./types";
import { json, clientIp } from "./util";

export type NewsletterScope = "network" | "domain";

export interface NewsletterInput {
  email: string;
  scope: NewsletterScope;
  slug: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cap = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function validateNewsletter(body: unknown): { ok: true; value: NewsletterInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid body" };

  const email = cap((body as any).email, 254).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "invalid email" };

  const rawSlug = cap((body as any).slug, 40).toLowerCase();
  const rawScope = cap((body as any).scope, 20).toLowerCase();

  if (rawSlug) {
    if (!DOMAIN_SLUGS.includes(rawSlug)) return { ok: false, error: "unknown domain" };
    return { ok: true, value: { email, scope: "domain", slug: rawSlug } };
  }

  if (rawScope && rawScope !== "network" && rawScope !== "domain") {
    return { ok: false, error: "invalid scope" };
  }

  return { ok: true, value: { email, scope: "network", slug: "" } };
}

async function rateLimited(kv: Kv, ip: string, day: string, limit = 10): Promise<boolean> {
  const n = await kv.incr(`newslettercount:${ip}:${day}`, 60 * 60 * 26);
  return n > limit;
}

export async function handleNewsletter(req: Request, db: Db, kv: Kv, nowIso: string): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const validated = validateNewsletter(body);
  if (!validated.ok) return json({ error: validated.error }, 400);

  const day = nowIso.slice(0, 10);
  if (await rateLimited(kv, clientIp(req), day)) return json({ error: "rate limit — try again tomorrow" }, 429);

  const status = await db.upsertNewsletterSubscriber({ ...validated.value, created_at: nowIso });
  const code = status === "subscribed" ? 201 : 200;
  return json({ ok: true, status }, code);
}
