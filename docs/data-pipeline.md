# Data pipeline — design notes

The reference bundle described a full production pipeline (Laravel API + n8n +
PostgreSQL + Redis + R2 + a Playwright screenshot service). This project keeps a
**static, SEO-first site** and moves scheduled scraping to a **Cloudflare Worker**
(cheaper than GitHub Actions). Below is what was adopted from that reference and
what was intentionally deferred.

## Adopted into the Worker (`worker/`)

| Reference insight | Where it lives |
| --- | --- |
| Discovery partitioned by star range (`>=1000` / `100..999` / `20..99`) to stay under the 1,000-result search cap | `scrape.ts` · `STAR_PARTITIONS` |
| Dedupe / resume by **GitHub database id** (stable external identifier) | `scrape.ts` (`byId` map, `githubId`) |
| Explicit status handling: 401 stop · 403/429 inspect `x-ratelimit-*` + secondary-limit backoff · 404 unavailable · 422 bad query · 5xx retry | `github.ts` |
| **ETag conditional requests** → free `304`s, no quota | `github.ts` + KV (`storage.ts`) |
| Weighted **quality score + penalties** for ranking (not stars alone) | `score.ts` |
| Deterministic, rule-based **classification** into 6 categories | `classify.ts` |
| **Append-only** metric snapshots (never overwrite) | `storage.ts` (`snapshots/<slug>/<iso>.json`) |
| Security: secrets never logged; **GitHub API only** — no HTML scraping, no cloning, no executing repo code | throughout; secrets via `wrangler secret` |

## Deferred (out of scope for a static catalog)

- **Manifest verification** (workflow 03): fetching `package.json`/`composer.json`
  via the contents API and matching `technology_rules` at confidence ≥ 0.85. The
  `github.ts` client already supports the ETag-cached contents calls this needs —
  it's a clean follow-up if topic-based discovery proves too loose.
- **Screenshot capture** (workflow 07) via an isolated Playwright service + R2,
  with the SSRF controls in `security.md`. The card/detail screenshots are
  currently CSS mockups; wiring real WebP captures is additive.
- **Editorial review + publication** (workflows 08–09): `review_pending` state,
  signed approve links, RSS. This catalog auto-publishes the top-N by score.
- **Homepage validation** (workflow 06) with the SSRF deny-list — relevant once
  demo links are user-submitted rather than taken from the repo's `homepage`.

## Refresh cadence

The reference tiers refresh (published 6-hourly, high-scoring/review daily, others
weekly). Here the Worker runs one **daily** cron for all domains — cheap enough
that tiering isn't needed at this catalog size. Bump `triggers.crons` in
`worker/wrangler.jsonc` to change it.
