# Data pipeline

This document describes the current production-oriented data flow and the optional Cloudflare path. PostgreSQL is the primary local/build-time source whenever `DATABASE_URL` is configured.

## Authoritative flow

```text
src/config/domain-catalog.json
          │
          ├── GitHub Scrapy spider ──────────────┐
          ├── YouTube Data API spider ───────────┤
          └── transcript fetcher (rotating VPN) ─┤
                                                 ▼
                                            PostgreSQL
                             repositories + related tables
                             youtube_videos + run/status tables
                                                 │
                                  workers/utils/pull-data.mjs
                                  ├── publish.py            → scrub-cross-domain.mjs
                                  │                          → stamp-added-at.mjs
                                  └── publish_videos.py     (description preference chain)
                                                 │
                           src/data/<slug>.json              (projects, with addedAt)
                           src/data/videos/<slug>.json       (curated videos)
                           src/data/tranworkers/utils/<id>.json    (enriched, schema v3)
                           src/data/video-descriptions.json  (LLM description rewrites)
                                                 │
                                  Astro static build → dist/
                                  (pages, RSS by addedAt, llms.txt + llms-full.txt)
```

Two guards run after every project publish (both `pnpm projects:publish` and the
build-time `pull-data.mjs` path): `workers/utils/scrub-cross-domain.mjs` evicts
multi-tech tools from domains they merely integrate with, and
`workers/utils/stamp-added-at.mjs` preserves/assigns each project's `addedAt`
(when it first entered the catalog — git history is the memory). RSS project
feeds sort by `addedAt` and carry real `pubDate`s; each domain also serves a
curated `llms.txt` (top 30) and an exhaustive `llms-full.txt` (all projects,
grouped by category) for AI crawlers.

`pnpm pipeline` at the repo root aggregates all of the below into single
commands (`status`, `videos`, `projects`, `build`, `all`, `ship`); every step
is idempotent, so each command resumes where the last run stopped.

`src/config/domain-catalog.json` is the authoritative technology catalog. A technology’s slug is not necessarily its GitHub query (`next` uses `topic:nextjs`), so discovery tools must execute `scrape.query` rather than constructing `topic:<slug>`.

## Data-source priority during build

`workers/utils/pull-data.mjs` uses this order:

1. **PostgreSQL** when `SCRAPE_DATABASE_URL` or `DATABASE_URL` is set. It runs project and video publishing scripts.
2. **Cloudflare Worker/R2** when `MADEWITH_DATA_BASE_URL` is set and PostgreSQL is not.
3. **Committed JSON** when neither source is configured or publishing/fetching fails.

Raw captions and published transcript JSON are produced separately. `workers/videos/transcribe_youtube.py` fetches captions, and `workers/videos/enrich_transcripts.py` generates the published schema consumed by Astro. `pull-data.mjs` does not run either step.

Editorial hydration is also separate. `workers/utils/hydrate-blog.mjs` copies factory output when available and otherwise keeps committed blog content. The message `workers/posts/output/articles not found — using committed src/content/blog` is a successful fallback, not a failed catalog publish.

## GitHub discovery and ingestion

The primary repository path is the Scrapy GitHub spider plus `madewith_workers/projects/db.py`.

### Search limits

- GitHub Search exposes no more than 1,000 results for one query.
- Authentication improves request quotas but does not remove the 1,000-result ceiling.
- Paging beyond 1,000 produces HTTP 422.
- Deeper discovery requires non-overlapping query partitions, typically star ranges.

### Schema writes

A repository upsert refreshes scraper-owned columns and related tables transactionally:

- repository identity and metadata
- topics
- language bytes/percentages
- technology association
- metric snapshots
- daily star snapshots

The complete GitHub search-result dictionary is retained under `repositories.metadata.raw`. Publishing depends on this contract.

Missing technologies are not allowed to produce orphan repository rows. Call `ensure_technology()` before importing a new slug.

The existing `technologies.id` default references `technologies_id_seq`, but the column is not formally attached as `SERIAL`/`IDENTITY`. `pg_get_serial_sequence()` can return `NULL`; runtime sequence repair therefore addresses `technologies_id_seq` by name.

### Classification

GitHub topics are discovery signals, not final membership decisions. `publish.py` calls normalization and catalog-driven categorization before writing JSON.

Category assignment uses the shared weighted-signal engine defined once in `shared/classify-signals.json` and consumed by both `shared/classify.mjs` (Worker) and `workers/projects/madewith_workers/projects/classify_engine.py` (publish pipeline) — a signal-table change fixes both; an algorithm change must be mirrored and is guarded by twin golden-fixture suites (`worker/test/classify.test.ts`, `workers/projects/tests/test_classify_engine.py`) held to ≥95% on the same 72 hand-labeled repos.

Domain membership (does this repo belong to this technology at all?) is guarded in three layers: the `github/` qualification engine (shared-vendor dependency rules, topic-breadth limits), the Worker scrape guard, and the offline `scrub-cross-domain.mjs` pass after publish.

Laravel’s per-tech membership classifier defines membership as one of:

- a Laravel application/project
- a Laravel package or plugin
- a Laravel-specific tool

Generic projects that merely offer Laravel integration and content-only repositories are excluded. Labeled cases live in `workers/projects/tests/test_categorize_laravel.py`.

### CSV replay

`load_csv_to_pg.py` and `load_all_csv_to_pg.py` are adapters for external `github_*.csv` exports. They use the same idempotent database upsert path. They are not replacements for the primary Scrapy discovery pipeline.

## YouTube discovery

The YouTube spider uses YouTube Data API v3 for search and metadata. It applies:

- minimum views, subscribers, duration, HD, and engagement gates
- English-language targeting
- title/content spam rules
- technology relevance rules from `src/config/video-relevance.json`

Metadata is persisted in `youtube_videos` and published to `src/data/videos/<slug>.json`.

Ambiguous names need strong relevance rules (`strictSlugs` in `src/config/video-relevance.json` — 25 slugs as of this writing, including Express vs HitFilm/Adobe Express, Alpine vs Alpine Linux, Django vs the movie, React vs reaction videos, Rails vs model railways, Twill vs the fabric). Without stack-specific reject/require patterns, ordinary gaming, film, music, craft, or physics videos leak into discovery. The gate is shared by the discovery spider, `cleanup_videos.py` (retroactive DB purge — dry-run by default, `--apply` to delete), and `publish_videos.py`.

## YouTube transcripts

`workers/videos/transcribe_youtube.py` selects `pending` rows from `youtube_videos`, fetches caption segments into the ignored local cache `workers/videos/data/tranworkers/utils/<video-id>.json`, and updates transcript status metadata. `--workers N` fetches concurrently (per-worker API sessions; default 1 — blocks are per-IP and rate-triggered, so keep it 1–3 from a single IP).

```text
pending ── success ──────────────────────▶ fetched
   │
   ├── permanent no captions/unplayable ─▶ unavailable
   ├── IP block / network error ─────────▶ stays pending (auto-retried next run)
   └── other errors ─────────────────────▶ failed (reset manually to retry)
```

After 3 consecutive block errors (10 with a proxy configured) the run aborts with **exit 75** instead of grinding a burned IP through the queue. `workers/videos/transcribe_rotate.py <wireguard-conf-dir> [chunk] [sleep] [workers]` drives the fetcher through manual WireGuard configs (e.g. SurfShark's per-location downloads): it brings up a location, runs chunks until the queue empties or exit 75, then rotates to the next config — the queue is DB-driven and idempotent, so rotation loses nothing. On macOS it runs `wg-quick` through Homebrew's bash (the system bash 3.2 is too old); `sudo` is used only for `wg-quick`.

`youtube-transcript-api` does not use the official YouTube Data API quota and the API key is irrelevant to blocks — YouTube's defense on the caption endpoint is purely IP-based. Alternatives to VPN rotation: `WEBSHARE_PROXY_USERNAME`/`WEBSHARE_PROXY_PASSWORD` or `YT_PROXY_URL` env vars configure a rotating proxy directly in the fetcher.

`workers/videos/enrich_transcripts.py` reads the raw cache and publishes `src/data/tranworkers/utils/<video-id>.json` (schema v3): chapters (title, description, start/end, slug), `seoDescription`, `summary` (Markdown key concepts), and `transcription` (literal speech as Markdown, one `##` section per chapter). Provider/model resolution:

- `OPENROUTER_API_KEY` → OpenRouter, default `google/gemini-2.5-pro` (best long-document chapter/timestamp accuracy; `google/gemini-2.5-flash` is ~10× cheaper)
- `OPENAI_API_KEY` → OpenAI direct, default `gpt-5-mini` (reasoning effort `low` + constrained JSON are set automatically)
- `OPENAI_BASE_URL`/`--base-url` → any OpenAI-compatible server (Ollama/LM Studio/vLLM; `--model` required)
- Precedence: `--model` > `ENRICH_MODEL` > `OPENAI_MODEL` (legacy, shared) > backend default. Keys are matched to the endpoint, so `OPENAI_API_KEY` and `OPENROUTER_API_KEY` can coexist in `.env`.

Runs are parallel (`--workers`, default 4), verbose (per-call token usage incl. reasoning split, per-video timing, ETA), and idempotent — `--limit` counts only videos that still need work. When a long video's cleaned transcript can't fit in one response, the run automatically retries in structure-only mode and rebuilds the literal transcription from the raw captions per chapter window. The AI may repair punctuation and caption mistakes, but `transcription` must preserve the speech rather than summarize it.

`workers/videos/rewrite_descriptions.py` covers videos that have no enriched transcript: it rewrites the raw YouTube description (sponsor plugs, links, chapter indexes) into one neutral editorial paragraph, accumulating idempotently in `src/data/video-descriptions.json` (default model on OpenRouter: `google/gemini-2.5-flash`; override `DESC_MODEL`). At publish time, `publish_videos.py` picks each video's display description best-source-first: **enriched `seoDescription` → LLM rewrite → sanitized raw text** (URLs, timestamps, hashtags, promo lines stripped). The relevance gate still judges the *raw* description, since tech mentions often live in the link lines the sanitizer removes.

## Canonical commands

`pnpm pipeline` is the aggregated entry point; the underlying commands remain available for surgical runs.

```bash
# Aggregated (each is idempotent and resumable)
pnpm pipeline status     # DB queue counts + local coverage
pnpm pipeline videos     # transcribe → enrich → rewrite descriptions → publish video JSON
pnpm pipeline projects   # publish project catalogs (scrub + addedAt included)
pnpm pipeline build      # full site build (prebuild hydrates from Postgres)
pnpm pipeline ship       # videos + build + commit src/data + push

# Individual steps
pnpm projects:scrape -- -a domains=laravel                 # GitHub discovery → PostgreSQL
pnpm youtube:scrape -- -a domains=laravel         # YouTube discovery → PostgreSQL
workers/videos/transcribe_rotate.py ~/vpn-wg 100 1 2     # caption fetch with VPN rotation
workers/.venv/bin/python workers/videos/transcribe_youtube.py --limit 100 --workers 2
workers/.venv/bin/python workers/videos/enrich_transcripts.py --limit 200 --workers 8 --max-output-tokens 32000
workers/.venv/bin/python workers/videos/rewrite_descriptions.py
workers/.venv/bin/python workers/videos/publish_videos.py
workers/.venv/bin/python workers/videos/cleanup_videos.py            # dry-run gate re-check (--apply to delete)
pnpm projects:publish                            # projects publish + scrub + addedAt
node workers/utils/pull-data.mjs                         # PostgreSQL → generated JSON (same guards)
node workers/utils/hydrate-blog.mjs                      # optional factory → committed blog tree
pnpm run build                                     # full hydration + Astro generation
```

## Canonical validation

`pnpm run build` is the end-to-end validation command. `prebuild` performs project/video publishing and editorial hydration before Astro runs. A passing build verifies the live PostgreSQL-to-JSON-to-static-site path when database credentials are configured.

Also run the Laravel classifier test after changes to `normalize.py` or `domain-catalog.json`:

```bash
workers/.venv/bin/python workers/projects/tests/test_categorize_laravel.py
```

## Optional Cloudflare Worker/R2 path

The Worker remains useful for scheduled scraping, R2 snapshots, deploy hooks, submissions, and admin moderation. It is an alternate/legacy source for build hydration rather than the primary PostgreSQL path when `DATABASE_URL` is present.

Worker capabilities include:

- star-range partitioned GitHub discovery
- GitHub-ID deduplication
- ETag/KV conditional requests
- explicit HTTP status/backoff behavior
- R2 datasets and append-only snapshots
- Pages deploy-hook invocation
- D1-backed submissions and overrides

See [`../worker/README.md`](../worker/README.md) and [`admin.md`](admin.md).

## Deferred or incomplete work

- Requalify the database with the fixed detection engine (`cd github && .venv/bin/madewith-github qualify`) so the offline scrub becomes redundant.
- Expand strict per-tech membership categorization beyond Laravel.
- Formally attach or migrate `technologies_id_seq` at the schema level; runtime repair currently protects inserts.
- Add isolated screenshot capture and homepage validation if real screenshots/user-submitted URLs become part of publishing.

Done since this list was written: caption fetching at scale (VPN rotation + fail-fast + rotating-proxy support), manifest-based membership verification (`github/` qualification engine reads composer/package dependencies), and category classification accuracy (shared golden-tested engine).
