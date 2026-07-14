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
# Fill in DATABASE_URL, GITHUB_TOKEN, and optionally YOUTUBE_API_KEY.

pnpm dev                    # http://localhost:4321
pnpm run build              # canonical full validation → dist/
```

> `pnpm run build` is the canonical end-to-end check. Its `prebuild` runs `scripts/pull-data.mjs` and `scripts/hydrate-blog.mjs` before Astro compiles the static site.

## Current data flow

```text
GitHub API ── Scrapy discovery ──▶ PostgreSQL
                                      │
YouTube Data API ── discovery ────────┤
YouTube transcript endpoint ──────────┤
                                      ▼
                           scripts/pull-data.mjs
                            ├─ scraper/publish.py
                            └─ scraper/publish_videos.py
                                      │
                         src/data/*.json
                         src/data/videos/*.json
                         src/data/transcripts/*.json
                                      │
                          Astro static build → dist/
```

PostgreSQL is the primary repository store when `DATABASE_URL` is configured. `scripts/pull-data.mjs` publishes projects and video catalogs from PostgreSQL. If PostgreSQL is unavailable, it can use the optional Cloudflare Worker/R2 source configured by `MADEWITH_DATA_BASE_URL`; otherwise committed JSON remains in place.

Editorial content is separate. `scripts/hydrate-blog.mjs` copies `factory/output/articles/**` and `factory/output/assets/**` when present. If factory output is absent, it intentionally keeps committed `src/content/blog` and exits successfully.

## GitHub repository pipeline

Configure `.env`:

```dotenv
GITHUB_TOKEN=
DATABASE_URL=
```

Run discovery and publishing from the repository root:

```bash
pnpm scrape                          # all catalog domains
pnpm scrape -- -a domains=laravel   # one domain
pnpm scrape:status                  # inspect shard progress
pnpm scrape:publish                 # PostgreSQL → src/data/*.json
```

The Scrapy pipeline writes repository metadata, topics, languages, technology links, metric snapshots, and daily star snapshots to the existing PostgreSQL schema. Raw GitHub search-result metadata is preserved so the publisher can reconstruct the generated JSON shape.

GitHub Search exposes at most **1,000 results per individual query**. Authentication improves the request limit but does not remove that cap. Broad discovery therefore needs bounded queries such as star ranges; increasing a single query past 1,000 returns HTTP 422.

GitHub topics are candidate-discovery signals, not final proof of membership. Technology-specific categorization belongs in `src/config/domain-catalog.json` and `scraper/madewith_scraper/normalize.py`. Laravel currently has a dedicated classifier that keeps Laravel projects, packages/plugins, and Laravel-specific tools while rejecting generic integrations and content-only repositories.

CSV imports are auxiliary replay tools, not the primary scraper:

```bash
scraper/.venv/bin/python scraper/load_csv_to_pg.py \
  /path/to/github_laravel.csv laravel --ensure-tech --min-stars 50

scraper/.venv/bin/python scraper/load_all_csv_to_pg.py \
  /path/to/csv-directory --ensure-tech
```

See [`scraper/README.md`](scraper/README.md) for schema behavior, idempotency, tests, and operational details.

## YouTube videos and transcripts

Discover and publish curated English tutorial videos:

```bash
pnpm scrape:youtube -- -a domains=laravel
pnpm scrape:youtube:publish -- laravel
```

Video metadata is stored in `youtube_videos` and published to `src/data/videos/<slug>.json`. `/video/` and `/video/<generated-slug>/` render the catalog and individual video pages.

Fetch raw caption segments for discovered videos, then structure them with AI:

```bash
scraper/.venv/bin/python scraper/transcribe_youtube.py --slug laravel --limit 20
scraper/.venv/bin/python scraper/transcribe_youtube.py --limit 1200 --sleep 1
scraper/.venv/bin/python scraper/enrich_transcripts.py --limit 100
```

Raw captions are cached locally at `scraper/data/transcripts/<youtube-video-id>.json`. `enrich_transcripts.py` sends timestamped captions to the configured OpenAI model and publishes schema-v2 files at `src/data/transcripts/<youtube-video-id>.json`. Each published file contains AI-generated chapters (`title`, `description`, `startTime`, `endTime`), a Markdown `summary`, and a literal, AI-formatted Markdown `transcription`. `src/lib/transcripts.ts` includes those files at build time.

`youtube-transcript-api` uses YouTube’s transcript endpoint rather than the official Data API and may return `IpBlocked` or `RequestBlocked` during bulk runs. Those are transient failures and must remain retryable; they do not mean the video lacks captions. Use a cooldown, a slower `--sleep`, or a supported rotating proxy. Permanent no-caption cases are recorded as `unavailable`.

The first full 1,121-video batch on 2026-07-13 fetched 40 transcripts before YouTube blocked the host IP; together with the smoke test, 43 transcript JSON files were produced. Treat this as an observed run result, not expected coverage.

## Generated data and pages

```text
src/
  config/
    domain-catalog.json         technology list, scrape queries, thresholds, categorization
    domains.ts                  theme/domain presentation config
  data/
    <slug>.json                 generated project catalogs
    videos/<slug>.json          generated video catalogs
    transcripts/<video-id>.json AI chapters, summary, and Markdown transcription
  lib/
    catalog.ts                  build-time project loading/ranking helpers
    videos.ts                   build-time video catalog loader
    transcripts.ts              transcript loader
    video-view.ts               video card/detail view model
  pages/
    [domain]/                   domain catalog routes
    video/                      video index, detail pages, RSS
    blog/                       editorial index, detail pages, RSS
scraper/
  madewith_scraper/             Scrapy spiders, PostgreSQL persistence, normalization
  publish.py                    PostgreSQL → project JSON
  publish_videos.py             PostgreSQL → video JSON
  transcribe_youtube.py         raw caption fetcher and status tracker
  enrich_transcripts.py         raw captions → AI-structured transcript JSON
scripts/
  pull-data.mjs                 build-time project/video hydration
  hydrate-blog.mjs              optional factory-output hydration
worker/                         optional Cloudflare Worker/R2/admin backend
factory/                        editorial content generator
```

Generated JSON can change substantially after a scrape or publish run. Review source-code changes separately from generated data before committing.

## Adding a technology

1. Add the technology to `src/config/domain-catalog.json` with its slug, display name, domain, group, GitHub query, minimum stars, and exclusions.
2. Add or reuse presentation settings in `src/config/domains.ts`.
3. Add technology-specific categorization when a topic or name is ambiguous.
4. Run discovery for the slug, publish JSON, and build:

```bash
pnpm scrape -- -a domains=<slug>
pnpm scrape:publish -- <slug>
pnpm run build
```

## Validation

```bash
scraper/.venv/bin/python scraper/tests/test_categorize_laravel.py
node scripts/pull-data.mjs
node scripts/hydrate-blog.mjs
pnpm run build
```

- `node scripts/pull-data.mjs` validates PostgreSQL → project/video JSON hydration.
- `node scripts/hydrate-blog.mjs` validates editorial hydration; “factory/output/articles not found” is a successful fallback to committed blog content.
- `pnpm run build` validates the complete hydration and Astro generation pipeline.

## Optional Cloudflare backend

The Cloudflare Worker remains an optional scheduled/R2/admin path. It can scrape to R2, retain snapshots, serve `/data/<slug>.json`, and trigger a Pages deploy. When `DATABASE_URL` exists, local/build-time hydration prefers PostgreSQL instead.

See [`worker/README.md`](worker/README.md), [`docs/data-pipeline.md`](docs/data-pipeline.md), and [`docs/admin.md`](docs/admin.md).

## Security

- Never commit `.env` or print credential values.
- Keep `GITHUB_TOKEN`, `DATABASE_URL`, `YOUTUBE_API_KEY`, Cloudflare secrets, and proxy credentials out of generated logs and documentation.
- The repository scraper uses GitHub APIs; it does not clone or execute discovered repositories.
