/** Public newsletter signup — validation mirrors server/src/newsletter.ts exactly. */
import { DOMAIN_SLUGS } from "./domains";
import type { NewsletterInput } from "./dynamo";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cap = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function validateNewsletter(body: unknown): { ok: true; value: Omit<NewsletterInput, "created_at"> } | { ok: false; error: string } {
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
