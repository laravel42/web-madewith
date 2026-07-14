# MadeWithWhat Cloudflare Worker

The Worker is the optional scheduled/R2/admin backend. The main local and build-time data path prefers PostgreSQL whenever `DATABASE_URL` is configured; `scripts/pull-data.mjs` uses the Worker only when PostgreSQL is unset and `MADEWITH_DATA_BASE_URL` is present.

## What it does

- `scheduled()` runs the configured catalog on a cron trigger, writes datasets to R2, appends metric snapshots, and invokes the Pages deploy hook.
- `GET /health` returns liveness and the domain list.
- `GET /data/<slug>.json` serves the current project dataset.
- `POST /refresh[?slug=nuxt]` starts a manual refresh and requires `REFRESH_SECRET`.
- `POST /submit` accepts validated public project submissions into D1.
- `/admin/api/*` provides Access-gated moderation, overrides, run status, refresh, and republish operations.

Publishing merges raw scrape data, approved entries, and overrides into `data/<slug>.json`; raw datasets remain in R2 so republishing does not require GitHub calls.

## Discovery behavior

- Partitioned GitHub Search by star range keeps each query below GitHub’s 1,000-result ceiling.
- Repositories are deduplicated by stable GitHub database ID.
- KV-backed ETags allow unchanged requests to return quota-free `304` responses.
- HTTP handling distinguishes authentication failures, rate/secondary limits, unavailable resources, malformed queries, and retryable server failures.
- Quality scoring applies completeness/recency signals and penalties before retaining the top projects.
- R2 snapshots are append-only.
- Secrets are never logged; repository code is never cloned or executed.

The Worker is not currently responsible for YouTube video discovery or transcript fetching. Those run through the Python scraper and PostgreSQL pipeline documented in [`../scraper/README.md`](../scraper/README.md).

## One-time setup

```bash
cd worker
pnpm install

pnpm exec wrangler r2 bucket create madewith-data
pnpm exec wrangler kv namespace create STATE
pnpm exec wrangler d1 create madewith-admin
pnpm exec wrangler d1 migrations apply madewith-admin

pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put REFRESH_SECRET
pnpm exec wrangler secret put PAGES_DEPLOY_HOOK
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN
pnpm exec wrangler secret put ACCESS_AUD

pnpm exec wrangler deploy
```

Copy generated binding IDs into `worker/wrangler.jsonc` as required.

To hydrate a Pages build from R2 instead of PostgreSQL, set `MADEWITH_DATA_BASE_URL` to the deployed Worker URL. The build requests `/data/<slug>.json` and falls back to committed JSON when a remote dataset is unavailable.

## Admin API

See [`../docs/admin.md`](../docs/admin.md) for the full architecture and Access setup.

Required bindings/secrets include D1 `DB`, R2 storage, KV state, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD`. In production, never enable `ADMIN_DEV_BYPASS`.

## Develop and test

```bash
cd worker
pnpm install
pnpm run typecheck
pnpm test
pnpm run dev
```

Local refresh example:

```bash
curl -X POST 'http://localhost:8787/refresh?slug=nuxt' \
  -H 'authorization: Bearer <REFRESH_SECRET>'
```

## Cost notes

Actual cost depends on the current catalog size, query partitions, cron frequency, R2 history, and Pages builds. The original six-domain assumptions no longer apply to the 69-entry catalog; verify Cloudflare usage before relying on free-tier estimates.
