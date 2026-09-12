# MadeWithWhat public API — Lambda + API Gateway + DynamoDB

Replaces the never-actually-deployed `server/` Node app for three public
routes: newsletter signup, project submission, and the AI chat widget. The
site is a static S3+CloudFront build with no origin server, so these ran into
CloudFront's own 404 page instead of reaching anything (see the "no server
running" incident — nothing here ever persisted a subscriber or submission).

## What this deploys

| Route | Compute | Why |
|---|---|---|
| `POST /api/newsletter` | API Gateway HTTP API → Lambda (`lambda/api`) | Simple request/response, DynamoDB `NewsletterSubscribers` table |
| `POST /api/submit` | Same Lambda, same HTTP API | Same reasons, DynamoDB `Submissions` table |
| `POST /api/chat` | Lambda Function URL, response streaming (`lambda/chat`) | Server-Sent Events — API Gateway buffers responses, so it can't carry SSE; a Function URL can |

All three keep same-origin `/api/*` calls from the static site (no
`PUBLIC_API_BASE`, no CORS) by adding two behaviors to the **existing**
CloudFront distribution rather than standing up a separate API domain.

Storage is DynamoDB (on-demand), not the Postgres tables `server/` used —
there was no real production data to migrate, since the server was never
live. Per-IP daily rate limiting (mirrors `server/src/kv.ts`'s Redis
`incr`+`expire`) is a DynamoDB item with a TTL attribute instead.

## Deploy

Prerequisites: AWS credentials in the shell (or `AWS_PROFILE`), and
`cdk bootstrap` once per account/region if this account has never used CDK.

```bash
pnpm install                    # installs infra/'s deps too (pnpm workspace)
pnpm run infra:diff             # review the change set
pnpm run infra:deploy           # creates the tables, both Lambdas, the HTTP API
pnpm run infra:wire-cloudfront -- --dry-run   # preview the CloudFront change
pnpm run infra:wire-cloudfront -- --apply     # add the /api/chat and /api/* behaviors
```

`infra:wire-cloudfront` reads the HTTP API and chat Function URL domains
straight from `MadeWithApiStack`'s CloudFormation outputs, so it must run
after `infra:deploy`, not before. It's idempotent — re-running it just
confirms the config already matches.

CloudFront propagation takes a few minutes. Then:

```bash
curl -X POST https://madewithwhat.net/api/newsletter \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","scope":"network"}'
```

## Config

`bin/app.ts` loads the repo-root `.env` at synth/deploy time (same file
`server/` and the `workers/` pipelines read):

- `PUBLIC_POSTHOG_PROJECT_TOKEN` / `PUBLIC_POSTHOG_HOST` — server-side capture, same as today.
- `OPENAI_API_KEY` / `CHAT_MODEL` — the chat Lambda. Same OpenAI-direct hardening as `workers/posts/content_factory.py` (see that file's comments) doesn't apply here since there's no ambient `OPENAI_BASE_URL` risk in a Lambda's clean environment, but the key still needs to be the real OpenAI one, not an OpenRouter key.
- `SITE_URL` — where the chat Lambda fetches `llms.txt`/RSS context from.
- `AWS_CLOUDFRONT_DISTRIBUTION_ID` — required; scopes the chat Function URL's invoke permission to this one distribution (not any CloudFront distribution in any account).

These land as plaintext Lambda environment variables (same trust model as
`server/`'s `process.env` today). If `OPENAI_API_KEY` needs tighter handling
later, move it to Secrets Manager and swap the `environment` value for a
`fromSecretsManager` reference in `lib/api-stack.ts`.

## Known gaps / deliberately out of scope

- No admin UI wired to the new DynamoDB tables yet — `server/`'s `/admin`
  moderation flow still expects Postgres. Approving/rejecting submissions
  needs either a small script against the `Submissions` table or a follow-up
  admin update.
- `server/` itself is untouched — this doesn't delete or replace it, it just
  gives the three public routes somewhere to actually run.
