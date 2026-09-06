# MadeWithWhat — multi-domain open-source technology catalogs

MadeWithWhat is a static, SEO-first network of “Made with [technology]” catalogs. One Astro application serves every configured domain, while PostgreSQL stores repository and YouTube metadata and generated JSON snapshots hydrate the static site.

The catalog currently covers **69 technologies** across frameworks, frontend, backend, CMS/CRM, commerce, and AI/LLM. The authoritative list is [`src/config/domain-catalog.json`](src/config/domain-catalog.json).

## Quick start

Requirements:

- Node.js with **pnpm 11**
- Python 3.11+
- PostgreSQL
- GitHub token for authenticated discovery
- YouTube Data API key for video discovery

```bash
pnpm install

cd scraper
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

cp .env.example .env
# Fill in DATABASE_URL, GITHUB_TOKEN, YOUTUBE_API_KEY, and OPENROUTER_API_KEY
# (LLM enrichment/descriptions; OPENAI_API_KEY works as the OpenAI-direct alternative).

pnpm dev                    # http://localhost:4321
pnpm run build              # canonical full validation → dist/
```

> `pnpm run build` is the canonical end-to-end check. Its `prebuild` runs `workers/utils/pull-data.mjs` (with the cross-domain scrub and `addedAt` stamping) and `workers/utils/hydrate-blog.mjs` before Astro compiles the static site.

### One-command operations

`pnpm pipeline` aggregates the day-to-day flows; every step is idempotent, so each command resumes where the last run stopped:

```bash
pnpm pipeline status     # DB queue counts + local coverage
pnpm pipeline videos     # transcribe → enrich → rewrite descriptions → publish video JSON
pnpm pipeline projects   # publish project catalogs (scrub + addedAt included)
pnpm pipeline build      # full site build
pnpm pipeline ship       # videos + build + commit src/data + push
```

## Current data flow

```text
GitHub API ── Scrapy discovery ──▶ PostgreSQL
                                      │
YouTube Data API ── discovery ────────┤
YouTube transcript endpoint ──────────┤
                                      ▼
                           workers/utils/pull-data.mjs
                            ├─ workers/projects/publish.py
                            └─ workers/videos/publish_videos.py
                                      │
                         src/data/*.json
                         src/data/videos/*.json
                         src/data/tranworkers/utils/*.json
                                      │
                          Astro static build → dist/
```

PostgreSQL is the primary repository store when `DATABASE_URL` is configured. `workers/utils/pull-data.mjs` publishes projects and video catalogs from PostgreSQL. If PostgreSQL is unavailable, it can use the optional Cloudflare Worker/R2 source configured by `MADEWITH_DATA_BASE_URL`; otherwise committed JSON remains in place.

Editorial content is separate. `workers/utils/hydrate-blog.mjs` copies `workers/posts/output/articles/**` and `workers/posts/output/assets/**` when present. If factory output is absent, it intentionally keeps committed `src/content/blog` and exits successfully.

## GitHub repository pipeline

Configure `.env`:

```dotenv
GITHUB_TOKEN=
DATABASE_URL=
```

Run discovery and publishing from the repository root:

```bash
pnpm projects:scrape                          # all catalog domains
pnpm projects:scrape -- -a domains=laravel   # one domain
pnpm projects:status                  # inspect shard progress
pnpm projects:publish                 # PostgreSQL → src/data/*.json
```

The Scrapy pipeline writes repository metadata, topics, languages, technology links, metric snapshots, and daily star snapshots to the existing PostgreSQL schema. Raw GitHub search-result metadata is preserved so the publisher can reconstruct the generated JSON shape.

GitHub Search exposes at most **1,000 results per individual query**. Authentication improves the request limit but does not remove that cap. Broad discovery therefore needs bounded queries such as star ranges; increasing a single query past 1,000 returns HTTP 422.

GitHub topics are candidate-discovery signals, not final proof of membership. Category assignment uses the shared weighted-signal engine (`shared/classify-signals.json`, consumed by both the Worker and the publish pipeline, golden-tested on both sides); domain membership is guarded by the `github/` qualification engine (shared-vendor dependency rules, topic-breadth limits) plus the post-publish `workers/utils/scrub-cross-domain.mjs` pass. Laravel additionally has a dedicated per-tech classifier that keeps Laravel projects, packages/plugins, and Laravel-specific tools while rejecting generic integrations and content-only repositories.

CSV imports are auxiliary replay tools, not the primary scraper:

```bash
  /path/to/github_laravel.csv laravel --ensure-tech --min-stars 50

  /path/to/csv-directory --ensure-tech
```

See [`workers/projects/README.md`](workers/projects/README.md) for schema behavior, idempotency, tests, and operational details.

## YouTube videos and transcripts

Discover and publish curated English tutorial videos:

```bash
pnpm youtube:scrape -- -a domains=laravel
pnpm youtube:publish -- laravel
```

Video metadata is stored in `youtube_videos` and published to `src/data/videos/<slug>.json`. `/video/` and `/video/<generated-slug>/` render the catalog and individual video pages.

Fetch raw caption segments for discovered videos, then structure them with AI (or run everything via `pnpm pipeline videos`):

```bash
workers/videos/transcribe_rotate.py ~/vpn-wg 100 1 2       # bulk fetch with VPN location rotation
workers/.venv/bin/python workers/videos/transcribe_youtube.py --slug laravel --limit 20
workers/.venv/bin/python workers/videos/enrich_transcripts.py --limit 200 --workers 8 --max-output-tokens 32000
workers/.venv/bin/python workers/videos/rewrite_descriptions.py   # clean descriptions for non-enriched videos
```

Raw captions are cached locally at `workers/videos/data/tranworkers/utils/<youtube-video-id>.json`. `enrich_transcripts.py` sends timestamped captions to the configured model (OpenRouter → `google/gemini-2.5-pro` by default; see `workers/videos/README.md` for providers and overrides) and publishes schema-v3 files at `src/data/tranworkers/utils/<youtube-video-id>.json`: AI-generated chapters, an SEO description, a Markdown `summary`, and a literal Markdown `transcription`. `src/lib/transcripts.ts` includes those files at build time. Published video descriptions resolve best-source-first: enriched `seoDescription` → LLM rewrite (`src/data/video-descriptions.json`) → sanitized raw text.

`youtube-transcript-api` uses YouTube’s anonymous transcript endpoint rather than the official Data API; blocking is purely IP-based. The fetcher fails fast after consecutive block errors (exit 75, blocked videos stay `pending`), and `transcribe_rotate.sh` rotates through WireGuard location configs until the queue drains. Permanent no-caption cases are recorded as `unavailable`.

## Generated data and pages

```text
src/
  config/
    domain-catalog.json         technology list, scrape queries, thresholds, categorization
    domains.ts                  theme/domain presentation config
  data/
    <slug>.json                 generated project catalogs
    videos/<slug>.json          generated video catalogs
    tranworkers/utils/<video-id>.json AI chapters, summary, and Markdown transcription
  lib/
    catalog.ts                  build-time project loading/ranking helpers
    videos.ts                   build-time video catalog loader
    transcripts.ts              transcript loader
    video-view.ts               video card/detail view model
  pages/
    [domain]/                   domain catalog routes
    video/                      video index, detail pages, RSS
    blog/                       editorial index, detail pages, RSS
workers/projects/
  madewith_workers/projects/             Scrapy spiders, PostgreSQL persistence, classify engine
  publish.py / publish.sh       PostgreSQL → project JSON (+ scrub + addedAt guards)
workers/videos/
  madewith_workers/videos/             YouTube discovery spider, relevance gate, DB access
  transcribe_youtube.py         raw caption fetcher (workers, fail-fast on blocks)
  transcribe_rotate.sh          VPN location rotation for bulk caption fetching
  enrich_transcripts.py         raw captions → AI chapters/summary/transcription (v3)
  rewrite_descriptions.py       LLM description rewrites for non-enriched videos
  publish_videos.py             PostgreSQL → video JSON (description preference chain)
  cleanup_videos.py             retroactive relevance-gate purge
github/                         repository qualification engine (membership rules)
shared/                         classifier signal table + JS engine (single source of truth)
workers/utils/
  pull-data.mjs                 build-time project/video hydration (+ guards)
  scrub-cross-domain.mjs        evict cross-domain contamination from published JSON
  stamp-added-at.mjs            preserve/assign per-project addedAt (RSS recency)
  hydrate-blog.mjs              optional factory-output hydration
workers/pipeline.py                     one-command drivers (status/videos/projects/build/ship)
worker/                         optional Cloudflare Worker/R2/admin backend
workers/posts/                        editorial content generator (OpenRouter, Sonnet 4.5)
```

Generated JSON can change substantially after a scrape or publish run. Review source-code changes separately from generated data before committing.

## Adding a technology

1. Add the technology to `src/config/domain-catalog.json` with its slug, display name, domain, group, GitHub query, minimum stars, and exclusions.
2. Add or reuse presentation settings in `src/config/domains.ts`.
3. Add technology-specific categorization when a topic or name is ambiguous.
4. Run discovery for the slug, publish JSON, and build:

```bash
pnpm projects:scrape -- -a domains=<slug>
pnpm projects:publish -- <slug>
pnpm run build
```

## Validation

```bash
workers/.venv/bin/python workers/projects/tests/test_categorize_laravel.py
node workers/utils/pull-data.mjs
node workers/utils/hydrate-blog.mjs
pnpm run build
```

- `node workers/utils/pull-data.mjs` validates PostgreSQL → project/video JSON hydration.
- `node workers/utils/hydrate-blog.mjs` validates editorial hydration; “workers/posts/output/articles not found” is a successful fallback to committed blog content.
- `pnpm run build` validates the complete hydration and Astro generation pipeline.

## Optional Cloudflare backend

The Cloudflare Worker remains an optional scheduled/R2/admin path. It can scrape to R2, retain snapshots, serve `/data/<slug>.json`, and trigger a Pages deploy. When `DATABASE_URL` exists, local/build-time hydration prefers PostgreSQL instead.

See [`worker/README.md`](worker/README.md), [`docs/data-pipeline.md`](docs/data-pipeline.md), and [`docs/admin.md`](docs/admin.md).

## Security

- Never commit `.env` or print credential values.
- Keep `GITHUB_TOKEN`, `DATABASE_URL`, `YOUTUBE_API_KEY`, Cloudflare secrets, and proxy credentials out of generated logs and documentation.
- The repository scraper uses GitHub APIs; it does not clone or execute discovered repositories.

## Deploy to S3 + CDN invalidation

```bash
pnpm build
pnpm deploy:s3 --dry-run    # plan only: what uploads, what gets purged
pnpm deploy:s3                 # upload changed files, purge their URLs
pnpm deploy:s3 --delete     # also remove remote keys no longer in dist/
```

Uploads only files whose content differs (one bucket LIST plus a local
size/ETag compare), then invalidates exactly the URLs those files serve —
deletions included, so a removed page stops being served from the edge.

Whichever CDN is configured runs, and both may run at once, which is what a
Cloudflare-to-CloudFront migration needs: the old edge keeps serving until DNS
flips. Above `CF_PURGE_MAX_URLS` changed URLs it invalidates everything
instead — on CloudFront that collapses to a single `/*` path, and on Cloudflare
it beats batches of 100 against the per-plan rate limit.

`S3_PREFIX` picks the folder inside the bucket and is stripped when building
purge URLs. `--no-purge` uploads without touching the cache;
`--purge-everything` forces a full-zone purge.

Configuration lives in `.env` (see `.env.example`): `AWS_BUCKET`, `S3_PREFIX`,
the AWS credentials, `SITE_URL`, then `AWS_CLOUDFRONT_DISTRIBUTION_ID` and/or
`CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN`.

The IAM identity needs `s3:ListBucket` on the bucket, `s3:PutObject` (and
`s3:DeleteObject` for `--delete`) on its contents, and
`cloudfront:CreateInvalidation`. A Cloudflare token needs only the zone-scoped
**Cache Purge** permission. `--no-purge` uploads without touching any CDN.
