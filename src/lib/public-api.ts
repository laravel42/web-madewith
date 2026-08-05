/**
 * Base URL for public POST /api/newsletter and /api/submit (the /api prefix
 * avoids colliding with the static /newsletter and /submit pages).
 * Prefer same-origin (Astro/nginx proxies to the Node app). PUBLIC_API_BASE
 * overrides when the browser must hit an absolute host.
 */
export function publicApiBase(): string {
  const base = import.meta.env.PUBLIC_API_BASE;
  return typeof base === "string" && base.trim() ? base.replace(/\/$/, "") : "";
}

/**
 * Browser PostHog distinct_id (set by PostHog.astro), forwarded with form
 * POSTs so the server-side capture lands on the same person.
 */
export function posthogDistinctId(): string | undefined {
  try {
    const id = (globalThis as { posthog?: { get_distinct_id?: () => string } }).posthog?.get_distinct_id?.();
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

export interface ProjectSubmitInput {
  slug: string;
  repoUrl: string;
  name: string;
  description?: string;
  category?: string;
  demoUrl?: string;
}

export interface ProjectSubmitResult {
  ok: true;
  id: number;
  status: "pending";
}

export async function submitProject(input: ProjectSubmitInput): Promise<ProjectSubmitResult> {
  const slug = input.slug.trim();
  const repoUrl = input.repoUrl.trim();
  const name = input.name.trim();
  if (!slug) throw new Error("Missing technology.");
  if (!repoUrl) throw new Error("Enter a GitHub repository URL.");
  if (!name) throw new Error("Enter a project name.");

  const body: Record<string, string> = {
    slug,
    repo_url: repoUrl,
    name,
  };
  const description = input.description?.trim();
  const category = input.category?.trim();
  const demoUrl = input.demoUrl?.trim();
  if (description) body.description = description;
  if (category) body.category = category;
  if (demoUrl) body.demo_url = demoUrl;
  const distinctId = posthogDistinctId();
  if (distinctId) body.distinct_id = distinctId;

  const res = await fetch(`${publicApiBase()}/api/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; id?: number; status?: string };
  if (!res.ok) throw new Error(data.error || `Submission failed (${res.status})`);

  return {
    ok: true,
    id: typeof data.id === "number" ? data.id : 0,
    status: "pending",
  };
}
