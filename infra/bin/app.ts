#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ApiStack } from "../lib/api-stack";

// Load the repo-root .env at synth/deploy time (mirrors server/src/load-env.ts) —
// these become plaintext Lambda environment variables in the deployed stack,
// same trust model as the existing server/ app. Move OPENAI_API_KEY to Secrets
// Manager if that stops being acceptable.
//
// Overrides — but only for this explicit allowlist, never AWS_*. This
// machine's shell carries a stale OPENAI_API_KEY/OPENAI_BASE_URL pointing at
// OpenRouter (leftover from routing some other tool through it); a
// non-overriding loader silently bakes that wrong key into the deployed
// Lambda, exactly the bug workers/posts/content_factory.py and
// workers/videos/*.py had. But overriding AWS_ACCESS_KEY_ID/AWS_SECRET_
// ACCESS_KEY/etc. here would hijack the CDK CLI's own AWS calls (bootstrap
// checks, asset publishing) away from whatever credentials `cdk deploy` is
// actually running as, onto the narrow .env IAM user instead — which lacks
// the permissions CDK needs (no cloudformation:DescribeStacks, for one).
const OVERRIDE_ALLOWLIST = new Set([
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "CHAT_MODEL",
  "PUBLIC_POSTHOG_PROJECT_TOKEN", "PUBLIC_POSTHOG_HOST", "SITE_URL",
  "CHAT_ORIGIN_SECRET",
]);

function loadRootEnv(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (key in process.env && !OVERRIDE_ALLOWLIST.has(key)) continue;
      process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    /* no .env — rely on the process environment (e.g. CI secrets) */
  }
}
loadRootEnv();

const app = new App();
new ApiStack(app, "MadeWithApiStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  siteOrigin: process.env.SITE_URL || "https://madewithwhat.net",
  posthogProjectToken: process.env.PUBLIC_POSTHOG_PROJECT_TOKEN,
  posthogHost: process.env.PUBLIC_POSTHOG_HOST,
  openaiApiKey: process.env.OPENAI_API_KEY,
  chatModel: process.env.CHAT_MODEL,
  chatOriginSecret: (() => {
    const secret = process.env.CHAT_ORIGIN_SECRET;
    if (!secret) throw new Error("CHAT_ORIGIN_SECRET is required in .env — shared secret between CloudFront and the chat Lambda");
    return secret;
  })(),
});
