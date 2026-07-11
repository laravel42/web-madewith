import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../src/submit.ts";
import { verifyAccess } from "../src/access.ts";

const base = { slug: "nuxt", repo_url: "https://github.com/acme/widget", name: "Widget", description: "A thing", category: "UI Kits", demo_url: "https://demo.dev" };

test("accepts a valid submission and trims/normalises", () => {
  const r = validateSubmission({ ...base, slug: "NUXT", name: "  Widget  " });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.slug, "nuxt"); assert.equal(r.value.name, "Widget"); }
});

test("rejects unknown domain", () => {
  assert.equal(validateSubmission({ ...base, slug: "svelte" }).ok, false);
});

test("rejects non-GitHub or malformed repo_url", () => {
  assert.equal(validateSubmission({ ...base, repo_url: "https://gitlab.com/a/b" }).ok, false);
  assert.equal(validateSubmission({ ...base, repo_url: "not-a-url" }).ok, false);
  assert.equal(validateSubmission({ ...base, repo_url: "https://github.com/only-owner" }).ok, false);
});

test("requires a name", () => {
  assert.equal(validateSubmission({ ...base, name: "   " }).ok, false);
});

test("rejects unknown category and bad demo URL", () => {
  assert.equal(validateSubmission({ ...base, category: "Games" }).ok, false);
  assert.equal(validateSubmission({ ...base, demo_url: "ftp://x" }).ok, false);
});

test("caps overly long fields", () => {
  const r = validateSubmission({ ...base, description: "x".repeat(1000) });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.description!.length, 400);
});

// --- Access gate: deny paths that need no crypto ---
const kv = { get: async () => null, put: async () => {} } as any;

test("verifyAccess denies when Access is not configured", async () => {
  const req = new Request("https://x/admin/api/me", { headers: { "cf-access-jwt-assertion": "a.b.c" } });
  assert.equal(await verifyAccess(req, { STATE: kv }), null);
});

test("verifyAccess denies a missing or malformed token", async () => {
  const env = { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud", STATE: kv };
  assert.equal(await verifyAccess(new Request("https://x/admin"), env), null);
  assert.equal(await verifyAccess(new Request("https://x/admin", { headers: { "cf-access-jwt-assertion": "garbage" } }), env), null);
});
