/**
 * One-off backfill: replay existing Postgres newsletter_subscribers and
 * submissions rows into PostHog as the same *_recorded events the live server
 * now captures, keeping each row's original created_at as the event timestamp.
 * Feeds the newsletter_subscriptions / project_submissions warehouse views.
 *
 * Dry-run by default (prints what it would send). Pass --send to capture.
 * Run ONCE per environment, on the box holding that environment's DATABASE_URL:
 *   pnpm --dir server backfill:posthog          # dry run
 *   pnpm --dir server backfill:posthog --send   # actually send
 */
import "../src/load-env";
import { Pool } from "pg";
import { PostHog } from "posthog-node";

const send = process.argv.includes("--send");

const token = process.env.POSTHOG_PROJECT_TOKEN || process.env.PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST || process.env.PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
if (!token) {
  console.error("No PostHog token configured (POSTHOG_PROJECT_TOKEN / PUBLIC_POSTHOG_PROJECT_TOKEN)");
  process.exit(1);
}
const databaseUrl = process.env.SCRAPE_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = send ? new PostHog(token, { host }) : null;
const mode = send ? "SEND" : "DRY RUN";

const subscribers = await pool.query(
  `SELECT email, scope, slug, status, created_at FROM newsletter_subscribers ORDER BY created_at`,
);
for (const r of subscribers.rows) {
  console.log(`[${mode}] newsletter_subscription_recorded ${r.email} scope=${r.scope} slug=${r.slug || "-"} status=${r.status} at=${r.created_at}`);
  client?.capture({
    event: "newsletter_subscription_recorded",
    distinctId: r.email,
    timestamp: new Date(r.created_at),
    properties: {
      email: r.email,
      scope: r.scope,
      slug: r.slug || null,
      // DB status is active/unsubscribed; live events use the action status.
      subscription_status: r.status === "active" ? "subscribed" : "unsubscribed",
      backfilled: true,
      $set: { email: r.email },
    },
  });
}

const submissions = await pool.query(
  `SELECT id, slug, repo_url, name, description, category, demo_url, status, created_at FROM submissions ORDER BY id`,
);
for (const r of submissions.rows) {
  console.log(`[${mode}] project_submission_recorded #${r.id} ${r.repo_url} status=${r.status} at=${r.created_at}`);
  client?.capture({
    event: "project_submission_recorded",
    distinctId: `submission:${r.id}`,
    timestamp: new Date(r.created_at),
    properties: {
      submission_id: Number(r.id),
      slug: r.slug,
      repo_url: r.repo_url,
      name: r.name,
      description: r.description,
      category: r.category,
      demo_url: r.demo_url,
      // Backfilled rows carry the current moderation status, not "pending".
      submission_status: r.status,
      backfilled: true,
    },
  });
}

console.log(`${subscribers.rows.length} subscribers, ${submissions.rows.length} submissions ${send ? "sent to PostHog" : "would be sent (re-run with --send)"}`);
await client?.shutdown();
await pool.end();
