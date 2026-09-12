/** Public project submission — validation mirrors server/src/submit.ts exactly. */
import { DOMAIN_SLUGS } from "./domains";
import { CATEGORIES } from "./categories";
import type { SubmitInput } from "./dynamo";

const GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i;
const cap = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export function validateSubmission(body: any): { ok: true; value: Omit<SubmitInput, "created_at"> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid body" };
  const slug = cap(body.slug, 40).toLowerCase();
  if (!DOMAIN_SLUGS.includes(slug)) return { ok: false, error: "unknown domain" };

  const repo_url = cap(body.repo_url, 200);
  if (!GITHUB_REPO.test(repo_url)) return { ok: false, error: "repo_url must be a https://github.com/owner/repo URL" };

  const name = cap(body.name, 100);
  if (!name) return { ok: false, error: "name is required" };

  const category = body.category ? cap(body.category, 40) : null;
  if (category && !CATEGORIES.includes(category)) return { ok: false, error: "unknown category" };

  const demo_url = body.demo_url ? cap(body.demo_url, 200) : null;
  if (demo_url && !/^https?:\/\//i.test(demo_url)) return { ok: false, error: "demo_url must be http(s)" };

  return { ok: true, value: { slug, repo_url, name, description: cap(body.description, 400) || null, category, demo_url } };
}
