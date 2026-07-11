# MadeWith… scraper — Cloudflare Worker

Scrapes GitHub on a **Cron Trigger** and refreshes the catalog data, replacing
scheduled GitHub Actions (which bill by the minute). A full 6-domain refresh is
a handful of GraphQL requests, so it runs comfortably on the Workers free tier.

## What it does

- **`scheduled()`** (cron, daily): scrape every domain → write datasets to **R2**
  → append metric **snapshots** → POST the **Pages deploy hook** so the static
  site rebuilds with fresh data.
- **`fetch()`**:
  - `GET /health` — liveness + domain list
  - `GET /data/<slug>.json` — current dataset (the site's build hydrates from this)
  - `POST /refresh[?slug=nuxt]` — manual run, gated by `REFRESH_SECRET`

## Insights applied (from the reference pipeline)

- **Partitioned discovery** by star range (`>=1000`, `100..999`, `20..99`) so each
  search stays under GitHub's 1,000-result ceiling; largest partition first, stop
  once enough candidates exist.
- **Dedupe by GitHub database id** — the stable external identifier.
- **ETag conditional requests** (KV-backed) — the ecosystem count returns a free
  `304` on most runs and burns no quota.
- **Explicit status handling**: 401 stop, 403/429 inspect rate-limit headers +
  secondary-limit backoff, 404 unavailable, 422 bad query, 5xx exponential retry.
- **Quality scoring + penalties** to rank candidates (log-damped stars + recency
  + completeness; penalties for stale/undocumented) before keeping the top N.
- **Append-only snapshots** in R2 (`snapshots/<slug>/<iso>.json`) — metrics are
  never overwritten.
- **Security**: token/secret via `wrangler secret` (never logged); GitHub API
  only — no HTML scraping, no cloning, no executing repo code.

## One-time setup

```bash
cd worker
npm install

wrangler r2 bucket create madewith-data
wrangler kv namespace create STATE          # paste the id into wrangler.jsonc
wrangler secret put GITHUB_TOKEN             # read-only PAT (public repos)
wrangler secret put REFRESH_SECRET           # gates POST /refresh
wrangler secret put PAGES_DEPLOY_HOOK        # Cloudflare Pages → deploy hook URL

wrangler deploy
```

Then point the site build at the Worker by setting `MADEWITH_DATA_BASE_URL` in the
Cloudflare Pages project to the Worker's URL (e.g.
`https://madewith-scraper.<account>.workers.dev`). The build's `pull-data` step
reads `/data/<slug>.json` from there, falling back to the committed seed data.

## Admin API

Beyond scraping, the Worker also serves the admin backend (see `../docs/admin.md`):

- `POST /submit` — public project submission (validated, per-IP daily cap) → D1 `pending`.
- `/admin/api/*` — Cloudflare Access-gated: overview stats, submission moderation
  (approve/reject), per-entry overrides (hide/feature/edit), and refresh/republish.
  Requires the `DB` (D1) binding and `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`.

Publishing merges **raw scrape + approved entries + overrides** into
`data/<slug>.json` (`src/merge.ts`); raw scrape is kept in R2 so republish needs no
GitHub calls.

## Develop & test

```bash
npm run typecheck
npm test          # unit tests: discovery/dedupe/noise/scoring + ETag 304 (mocked GitHub)
npm run dev       # local Worker; POST http://localhost:8787/refresh?slug=nuxt
```

## Cost model

Workers cron + a few GraphQL calls per day sit inside the free tier. R2 stores a
few KB of JSON per domain plus small daily snapshots. No per-minute CI billing.
