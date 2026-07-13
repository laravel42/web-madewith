import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewsletter } from "../src/newsletter.ts";

test("accepts a network subscription and normalizes email", () => {
  const result = validateNewsletter({ email: "  You@Example.com  ", scope: "network" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.email, "you@example.com");
    assert.equal(result.value.scope, "network");
    assert.equal(result.value.slug, "");
  }
});

test("accepts a domain subscription with slug", () => {
  const result = validateNewsletter({ email: "dev@example.com", slug: "nuxt" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.scope, "domain");
    assert.equal(result.value.slug, "nuxt");
  }
});

test("defaults to network when scope is omitted", () => {
  const result = validateNewsletter({ email: "dev@example.com" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.scope, "network");
});

test("rejects invalid email", () => {
  assert.equal(validateNewsletter({ email: "not-an-email" }).ok, false);
  assert.equal(validateNewsletter({ email: "" }).ok, false);
});

test("rejects unknown domain slug", () => {
  assert.equal(validateNewsletter({ email: "dev@example.com", slug: "not-a-domain" }).ok, false);
});

test("rejects invalid scope", () => {
  assert.equal(validateNewsletter({ email: "dev@example.com", scope: "weekly" }).ok, false);
});

test("slug takes precedence over scope for domain subscriptions", () => {
  const result = validateNewsletter({ email: "dev@example.com", slug: "laravel", scope: "network" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.scope, "domain");
    assert.equal(result.value.slug, "laravel");
  }
});
