export type NewsletterScope = "network" | "domain";

export interface NewsletterSubscribeInput {
  email: string;
  scope?: NewsletterScope;
  slug?: string;
}

export interface NewsletterSubscribeResult {
  ok: true;
  status: "subscribed" | "already_subscribed" | "reactivated" | "preview";
}

function apiBase(): string | undefined {
  const base = import.meta.env.PUBLIC_API_BASE;
  return typeof base === "string" && base.trim() ? base.replace(/\/$/, "") : undefined;
}

export async function subscribeNewsletter(input: NewsletterSubscribeInput): Promise<NewsletterSubscribeResult> {
  const email = input.email.trim();
  const base = apiBase();
  if (!base) return { ok: true, status: "preview" };

  const body: Record<string, string> = { email };
  if (input.slug) {
    body.slug = input.slug;
    body.scope = "domain";
  } else {
    body.scope = input.scope ?? "network";
  }

  const res = await fetch(`${base}/newsletter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; status?: string };
  if (!res.ok) throw new Error(data.error || `Subscription failed (${res.status})`);

  const status = data.status;
  if (status === "already_subscribed" || status === "reactivated" || status === "subscribed") {
    return { ok: true, status };
  }
  return { ok: true, status: "subscribed" };
}

export function isDefaultSubscribeHref(href: string): boolean {
  const normalized = href.replace(/\/+$/, "") || "/";
  return normalized === "/newsletter";
}
