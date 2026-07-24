import { publicApiBase } from "./public-api";

export type NewsletterScope = "network" | "domain";

export interface NewsletterSubscribeInput {
  email: string;
  scope?: NewsletterScope;
  slug?: string;
}

export interface NewsletterSubscribeResult {
  ok: true;
  status: "subscribed" | "already_subscribed" | "reactivated";
}

/** @deprecated Prefer publicApiBase from ./public-api */
export function newsletterApiBase(): string {
  return publicApiBase();
}

export async function subscribeNewsletter(input: NewsletterSubscribeInput): Promise<NewsletterSubscribeResult> {
  const email = input.email.trim();
  if (!email) throw new Error("Enter your email address.");

  const body: Record<string, string> = { email };
  if (input.slug) {
    body.slug = input.slug;
    body.scope = "domain";
  } else {
    body.scope = input.scope ?? "network";
  }

  const res = await fetch(`${publicApiBase()}/newsletter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
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

/** Status copy for inline banners after a successful subscribe. */
export function newsletterSuccessMessage(status: NewsletterSubscribeResult["status"]): string {
  if (status === "already_subscribed") return "You're already on the list.";
  if (status === "reactivated") return "Welcome back — you're subscribed again.";
  return "You're subscribed. Thanks!";
}
