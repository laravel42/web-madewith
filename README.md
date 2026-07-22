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

> `pnpm run build` is the canonical end-to-end check. Its `prebuild` runs `scripts/pull-data.mjs` (with the cross-domain scrub and `addedAt` stamping) and `scripts/hydrate-blog.mjs` before Astro compiles the static site.

### One-command operations

`./pipeline.sh` aggregates the day-to-day flows; every step is idempotent, so each command resumes where the last run stopped:

```bash
./pipeline.sh status     # DB queue counts + local coverage
./pipeline.sh videos     # transcribe → enrich → rewrite descriptions → publish video JSON
./pipeline.sh projects   # publish project catalogs (scrub + addedAt included)
./pipeline.sh build      # full site build
./pipeline.sh ship       # videos + build + commit src/data + push
```

## Current data flow

```text
GitHub API ── Scrapy discovery ──▶ PostgreSQL
                                      │
YouTube Data API ── discovery ────────┤
YouTube transcript endpoint ──────────┤
                                      ▼
                           scripts/pull-data.mjs
                            ├─ scraper/publish.py
                            └─ youtube/publish_videos.py
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

GitHub topics are candidate-discovery signals, not final proof of membership. Category assignment uses the shared weighted-signal engine (`shared/classify-signals.json`, consumed by both the Worker and the publish pipeline, golden-tested on both sides); domain membership is guarded by the `github/` qualification engine (shared-vendor dependency rules, topic-breadth limits) plus the post-publish `scripts/scrub-cross-domain.mjs` pass. Laravel additionally has a dedicated per-tech classifier that keeps Laravel projects, packages/plugins, and Laravel-specific tools while rejecting generic integrations and content-only repositories.

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

Fetch raw caption segments for discovered videos, then structure them with AI (or run everything via `./pipeline.sh videos`):

```bash
youtube/transcribe_rotate.sh ~/vpn-wg 100 1 2       # bulk fetch with VPN location rotation
youtube/.venv/bin/python youtube/transcribe_youtube.py --slug laravel --limit 20
youtube/.venv/bin/python youtube/enrich_transcripts.py --limit 200 --workers 8 --max-output-tokens 32000
youtube/.venv/bin/python youtube/rewrite_descriptions.py   # clean descriptions for non-enriched videos
```

Raw captions are cached locally at `youtube/data/transcripts/<youtube-video-id>.json`. `enrich_transcripts.py` sends timestamped captions to the configured model (OpenRouter → `google/gemini-2.5-pro` by default; see `youtube/README.md` for providers and overrides) and publishes schema-v3 files at `src/data/transcripts/<youtube-video-id>.json`: AI-generated chapters, an SEO description, a Markdown `summary`, and a literal Markdown `transcription`. `src/lib/transcripts.ts` includes those files at build time. Published video descriptions resolve best-source-first: enriched `seoDescription` → LLM rewrite (`src/data/video-descriptions.json`) → sanitized raw text.

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
  madewith_scraper/             Scrapy spiders, PostgreSQL persistence, classify engine
  publish.py / publish.sh       PostgreSQL → project JSON (+ scrub + addedAt guards)
youtube/
  madewith_youtube/             YouTube discovery spider, relevance gate, DB access
  transcribe_youtube.py         raw caption fetcher (workers, fail-fast on blocks)
  transcribe_rotate.sh          VPN location rotation for bulk caption fetching
  enrich_transcripts.py         raw captions → AI chapters/summary/transcription (v3)
  rewrite_descriptions.py       LLM description rewrites for non-enriched videos
  publish_videos.py             PostgreSQL → video JSON (description preference chain)
  cleanup_videos.py             retroactive relevance-gate purge
github/                         repository qualification engine (membership rules)
shared/                         classifier signal table + JS engine (single source of truth)
scripts/
  pull-data.mjs                 build-time project/video hydration (+ guards)
  scrub-cross-domain.mjs        evict cross-domain contamination from published JSON
  stamp-added-at.mjs            preserve/assign per-project addedAt (RSS recency)
  hydrate-blog.mjs              optional factory-output hydration
pipeline.sh                     one-command drivers (status/videos/projects/build/ship)
worker/                         optional Cloudflare Worker/R2/admin backend
factory/                        editorial content generator (OpenRouter, Sonnet 4.5)
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
