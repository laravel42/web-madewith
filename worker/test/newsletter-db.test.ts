import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db.ts";

function createDb() {
  const rows = new Map<string, { status: string }>();
  const key = (email: string, scope: string, slug: string) => `${email}|${scope}|${slug}`;

  const d1 = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (query.includes("SELECT status FROM newsletter_subscribers")) {
                const [email, scope, slug] = args as string[];
                const row = rows.get(key(email, scope, slug));
                return row ? ({ status: row.status } as T) : null;
              }
              return null;
            },
            async run() {
              if (query.includes("INSERT INTO newsletter_subscribers")) {
                const [email, scope, slug, , createdAt] = args as string[];
                rows.set(key(email, scope, slug), { status: "active" });
                return { meta: { last_row_id: rows.size } };
              }
              if (query.includes("UPDATE newsletter_subscribers")) {
                const [createdAt, email, scope, slug] = args as string[];
                rows.set(key(email, scope, slug), { status: "active" });
                return { meta: {} };
              }
              return { meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db: new Db(d1), rows, key };
}

test("upsertNewsletterSubscriber inserts a new subscriber", async () => {
  const { db } = createDb();
  const status = await db.upsertNewsletterSubscriber({
    email: "you@example.com",
    scope: "network",
    slug: "",
    created_at: "2026-07-13T00:00:00.000Z",
  });
  assert.equal(status, "subscribed");
});

test("upsertNewsletterSubscriber is idempotent for active subscribers", async () => {
  const { db, rows, key } = createDb();
  rows.set(key("you@example.com", "network", ""), { status: "active" });
  const status = await db.upsertNewsletterSubscriber({
    email: "you@example.com",
    scope: "network",
    slug: "",
    created_at: "2026-07-13T00:00:00.000Z",
  });
  assert.equal(status, "already_subscribed");
});

test("upsertNewsletterSubscriber reactivates unsubscribed subscribers", async () => {
  const { db, rows, key } = createDb();
  rows.set(key("you@example.com", "domain", "nuxt"), { status: "unsubscribed" });
  const status = await db.upsertNewsletterSubscriber({
    email: "you@example.com",
    scope: "domain",
    slug: "nuxt",
    created_at: "2026-07-13T00:00:00.000Z",
  });
  assert.equal(status, "reactivated");
});
