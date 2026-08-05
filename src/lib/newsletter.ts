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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Newsletter signup, captured straight from the browser to PostHog — no
 * backend hop. The `newsletter_subscriptions` data warehouse view in PostHog
 * is built from this event, so it doubles as the subscriber store. The event
 * lands on the visitor's existing PostHog person; `$set` makes that person
 * searchable by email.
 */
export async function subscribeNewsletter(input: NewsletterSubscribeInput): Promise<NewsletterSubscribeResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");

  const slug = input.slug?.trim().toLowerCase() ?? "";
  const scope: NewsletterScope = slug ? "domain" : (input.scope ?? "network");

  const posthog = (globalThis as { posthog?: { capture?: (event: string, properties?: Record<string, unknown>) => unknown } }).posthog;
  if (typeof posthog?.capture !== "function") {
    // No PostHog snippet on the page (missing token or blocked before the stub
    // ran) — fail visibly rather than pretending the signup was stored.
    throw new Error("Subscriptions are unavailable right now — please try again later.");
  }

  posthog.capture("newsletter_subscription_recorded", {
    email,
    scope,
    slug: slug || null,
    subscription_status: "subscribed",
    $set: { email },
  });

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
