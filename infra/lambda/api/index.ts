/**
 * Newsletter + submit API — Hono app on API Gateway HTTP API (Lambda proxy
 * integration v2.0 payload). Same route contract as server/src/newsletter.ts
 * and server/src/submit.ts, backed by DynamoDB instead of Postgres/Redis so
 * the whole thing runs with no VPC and no long-lived connections.
 */
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { validateNewsletter } from "./newsletter";
import { validateSubmission } from "./submit";
import { upsertNewsletterSubscriber, insertSubmission } from "./dynamo";
import { isRateLimited } from "../shared/rate-limit";
import { createAnalytics } from "../shared/posthog";

const NEWSLETTER_TABLE = process.env.NEWSLETTER_TABLE!;
const SUBMISSIONS_TABLE = process.env.SUBMISSIONS_TABLE!;
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE!;

const analytics = createAnalytics(process.env.POSTHOG_PROJECT_TOKEN, process.env.POSTHOG_HOST);

type Bindings = { event: APIGatewayProxyEventV2 };
const app = new Hono<{ Bindings: Bindings }>();

const cap = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function clientIp(c: { env: Bindings }): string {
  return c.env.event.requestContext.http.sourceIp || "anon";
}

app.post("/api/newsletter", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const validated = validateNewsletter(body);
  if (!validated.ok) return c.json({ error: validated.error }, 400);

  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  if (await isRateLimited(RATE_LIMIT_TABLE, "newsletter", clientIp(c), day, 10)) {
    return c.json({ error: "rate limit — try again tomorrow" }, 429);
  }

  const status = await upsertNewsletterSubscriber(NEWSLETTER_TABLE, { ...validated.value, created_at: now });

  const { email, scope, slug } = validated.value;
  analytics.capture("newsletter_subscription_recorded", cap((body as any).distinct_id, 200) || email, {
    email,
    scope,
    slug: slug || null,
    subscription_status: status,
    $set: { email },
  });
  await analytics.flush();

  return c.json({ ok: true, status }, status === "subscribed" ? 201 : 200);
});

app.post("/api/submit", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const validated = validateSubmission(body);
  if (!validated.ok) return c.json({ error: validated.error }, 400);

  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  if (await isRateLimited(RATE_LIMIT_TABLE, "submit", clientIp(c), day, 20)) {
    return c.json({ error: "rate limit — try again tomorrow" }, 429);
  }

  const id = await insertSubmission(SUBMISSIONS_TABLE, { ...validated.value, created_at: now });

  analytics.capture("project_submission_recorded", cap(body.distinct_id, 200) || `submission:${id}`, {
    submission_id: id,
    slug: validated.value.slug,
    repo_url: validated.value.repo_url,
    name: validated.value.name,
    description: validated.value.description,
    category: validated.value.category,
    demo_url: validated.value.demo_url,
    submission_status: "pending",
  });
  await analytics.flush();

  return c.json({ ok: true, id, status: "pending" }, 201);
});

export const handler = handle(app);
