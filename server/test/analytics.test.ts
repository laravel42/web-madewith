/** Server-side PostHog mirroring for newsletter signups and project submissions. */
import test from "node:test";
import assert from "node:assert/strict";
import { handleNewsletter } from "../src/newsletter.ts";
import { handleSubmit } from "../src/submit.ts";
import type { Analytics } from "../src/posthog.ts";
import type { Db } from "../src/db.ts";
import type { Kv } from "../src/types.ts";

const kv: Kv = {
  get: async () => null,
  getJson: async () => null,
  put: async () => {},
  incr: async () => 1,
};

interface Captured {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
}

function recorder(): { calls: Captured[]; analytics: Analytics } {
  const calls: Captured[] = [];
  return {
    calls,
    analytics: {
      capture: (event, distinctId, properties) => void calls.push({ event, distinctId, properties }),
      shutdown: async () => {},
    },
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const newsletterDb = { upsertNewsletterSubscriber: async () => "subscribed" as const } as unknown as Db;
const submitDb = { insertSubmission: async () => 42 } as unknown as Db;

test("handleNewsletter mirrors the subscriber to PostHog keyed by email", async () => {
  const { calls, analytics } = recorder();
  const res = await handleNewsletter(post({ email: "A@B.co", slug: "react" }), newsletterDb, kv, "2026-08-04T00:00:00Z", analytics);
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, "newsletter_subscription_recorded");
  assert.equal(calls[0].distinctId, "a@b.co");
  assert.equal(calls[0].properties?.slug, "react");
  assert.equal(calls[0].properties?.scope, "domain");
  assert.equal(calls[0].properties?.subscription_status, "subscribed");
  assert.deepEqual(calls[0].properties?.$set, { email: "a@b.co" });
});

test("handleNewsletter prefers the forwarded browser distinct_id", async () => {
  const { calls, analytics } = recorder();
  await handleNewsletter(post({ email: "a@b.co", distinct_id: "browser-123" }), newsletterDb, kv, "2026-08-04T00:00:00Z", analytics);
  assert.equal(calls[0].distinctId, "browser-123");
  assert.equal(calls[0].properties?.email, "a@b.co");
});

test("handleNewsletter does not capture on validation failure", async () => {
  const { calls, analytics } = recorder();
  const res = await handleNewsletter(post({ email: "nope" }), newsletterDb, kv, "2026-08-04T00:00:00Z", analytics);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("handleSubmit mirrors the stored submission to PostHog", async () => {
  const { calls, analytics } = recorder();
  const res = await handleSubmit(
    post({ slug: "react", repo_url: "https://github.com/foo/bar", name: "Foo", distinct_id: "browser-123" }),
    submitDb,
    kv,
    "2026-08-04T00:00:00Z",
    analytics,
  );
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, "project_submission_recorded");
  assert.equal(calls[0].distinctId, "browser-123");
  assert.equal(calls[0].properties?.submission_id, 42);
  assert.equal(calls[0].properties?.repo_url, "https://github.com/foo/bar");
  assert.equal(calls[0].properties?.submission_status, "pending");
});

test("handleSubmit falls back to a submission-scoped distinct id", async () => {
  const { calls, analytics } = recorder();
  await handleSubmit(post({ slug: "react", repo_url: "https://github.com/foo/bar", name: "Foo" }), submitDb, kv, "2026-08-04T00:00:00Z", analytics);
  assert.equal(calls[0].distinctId, "submission:42");
});
