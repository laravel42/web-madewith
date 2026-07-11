# Admin dashboard

A protected `/admin` dashboard for running the catalog: submission moderation,
per-entry editorial control, manual refresh, and run stats.

## Architecture

```
Browser ── /admin (UI, static) ─────────────┐   (one Cloudflare Access app on /admin/*)
        ── /admin/api/* (Pages Function) ────┤ forwards Cf-Access-Jwt-Assertion
                                             ▼
                              Worker /admin/api/* ── verifies Access JWT ── D1 + R2
```

- **`/admin`** — static Astro page (`src/pages/admin/index.astro`), `noindex`.
- **`/admin/api/*`** — a same-origin Pages Function (`functions/admin/api/[[path]].ts`)
  that forwards to the Worker, passing the Access JWT. Same origin ⇒ no CORS or
  cross-site-cookie issues; one Access application covers everything under `/admin/*`.
- **Worker `/admin/api/*`** (`worker/src/admin.ts`) — verifies the Access JWT
  (`worker/src/access.ts`) on every call, then reads/writes **D1** and re-publishes
  datasets to **R2**.

## What it does (full flow)

- **Overview** — pending-submission count, per-domain published/ecosystem counts,
  last full-run time; **Refresh** (re-scrape) and **Republish** (re-apply overrides,
  no scrape) per domain or all.
- **Submissions** — the public submit form writes `pending` rows to D1. Approve →
  the Worker fetches that repo from GitHub, stores it as a manual entry, and
  republishes the domain (deploy hook fires). Reject → recorded with the moderator's
  identity.
- **Entries** — per domain, **Hide** / **Feature** any entry (featured pin to the
  top). Overrides are applied at publish time and survive re-scrapes.

Data model: `submissions`, `approved_entries`, `entry_overrides` in D1
(`worker/migrations/0001_admin.sql`). Publishing merges **raw scrape + approved +
overrides** → the `data/<slug>.json` the site renders (`worker/src/merge.ts`); the
raw scrape is kept in R2 so republish never needs GitHub.

## Setup

1. **D1** (see `worker/README.md` / `wrangler.jsonc`):
   ```bash
   cd worker
   wrangler d1 create madewith-admin          # paste id into wrangler.jsonc
   wrangler d1 migrations apply madewith-admin
   wrangler deploy
   ```

2. **Cloudflare Access** — add a self-hosted Access application covering
   `your-site.com/admin/*` (the Pages routes). Note its **AUD tag** and your team
   domain, and set on the **Worker**:
   ```bash
   # in wrangler.jsonc vars, or:
   wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. yourteam.cloudflareaccess.com
   wrangler secret put ACCESS_AUD           # the Access application AUD tag
   ```
   The Worker rejects any `/admin/api/*` request without a valid JWT for that AUD,
   so it's safe even though it's publicly reachable.

3. **Pages env** — set `ADMIN_WORKER_URL` to the Worker's URL so the proxy can
   reach it. Set `PUBLIC_API_BASE` to the same URL so the public submit form posts
   to `…/submit`.

## Public submissions

`POST /submit` on the Worker validates input (`worker/src/submit.ts`), applies a
per-IP daily cap, and inserts a `pending` row — no auth (it's public), but nothing
is published until a moderator approves it.
