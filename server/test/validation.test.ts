import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../src/submit.ts";
import { validateNewsletter } from "../src/newsletter.ts";

test("validateSubmission rejects a non-GitHub repo_url", () => {
  const r = validateSubmission({ slug: "react", repo_url: "https://gitlab.com/foo/bar", name: "Foo" });
  assert.equal(r.ok, false);
});

test("validateSubmission rejects an unknown domain", () => {
  const r = validateSubmission({ slug: "not-a-domain", repo_url: "https://github.com/foo/bar", name: "Foo" });
  assert.equal(r.ok, false);
});

test("validateSubmission accepts a valid payload", () => {
  const r = validateSubmission({ slug: "react", repo_url: "https://github.com/foo/bar", name: "Foo", description: "x" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.slug, "react");
});

test("validateNewsletter requires a valid email", () => {
  assert.equal(validateNewsletter({ email: "nope" }).ok, false);
  assert.equal(validateNewsletter({ email: "a@b.co" }).ok, true);
});

test("validateNewsletter maps a slug to domain scope", () => {
  const r = validateNewsletter({ email: "a@b.co", slug: "react" });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.scope, "domain"); assert.equal(r.value.slug, "react"); }
});
