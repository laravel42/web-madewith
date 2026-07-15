# Data pipeline

This document describes the current production-oriented data flow and the optional Cloudflare path. PostgreSQL is the primary local/build-time source whenever `DATABASE_URL` is configured.

## Authoritative flow

```text
src/config/domain-catalog.json
          │
          ├── GitHub Scrapy spider ──────────────┐
          ├── YouTube Data API spider ───────────┤
          └── transcript worker ─────────────────┤
                                                 ▼
                                            PostgreSQL
                             repositories + related tables
                             youtube_videos + run/status tables
                                                 │
                                  scripts/pull-data.mjs
                                  ├── publish.py
                                  └── publish_videos.py
                                                 │
                           src/data/<slug>.json
                           src/data/videos/<slug>.json
                           src/data/transcripts/<video-id>.json
                                                 │
                                  Astro static build → dist/
```

`src/config/domain-catalog.json` is the authoritative technology catalog. A technology’s slug is not necessarily its GitHub query (`next` uses `topic:nextjs`), so discovery tools must execute `scrape.query` rather than constructing `topic:<slug>`.

## Data-source priority during build

`scripts/pull-data.mjs` uses this order:

1. **PostgreSQL** when `SCRAPE_DATABASE_URL` or `DATABASE_URL` is set. It runs project and video publishing scripts.
2. **Cloudflare Worker/R2** when `MADEWITH_DATA_BASE_URL` is set and PostgreSQL is not.
3. **Committed JSON** when neither source is configured or publishing/fetching fails.

Raw captions and published transcript JSON are produced separately. `youtube/transcribe_youtube.py` fetches captions, and `youtube/enrich_transcripts.py` generates the published schema consumed by Astro. `pull-data.mjs` does not run either step.

Editorial hydration is also separate. `scripts/hydrate-blog.mjs` copies factory output when available and otherwise keeps committed blog content. The message `factory/output/articles not found — using committed src/content/blog` is a successful fallback, not a failed catalog publish.

## GitHub discovery and ingestion

The primary repository path is the Scrapy GitHub spider plus `madewith_scraper/db.py`.

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

Laravel’s classifier defines membership as one of:

- a Laravel application/project
- a Laravel package or plugin
- a Laravel-specific tool

Generic projects that merely offer Laravel integration and content-only repositories are excluded. Labeled cases live in `scraper/tests/test_categorize_laravel.py`.

### CSV replay

`load_csv_to_pg.py` and `load_all_csv_to_pg.py` are adapters for external `github_*.csv` exports. They use the same idempotent database upsert path. They are not replacements for the primary Scrapy discovery pipeline.

## YouTube discovery

The YouTube spider uses YouTube Data API v3 for search and metadata. It applies:

- minimum views, subscribers, duration, HD, and engagement gates
- English-language targeting
- title/content spam rules
- technology relevance rules from `src/config/video-relevance.json`

Metadata is persisted in `youtube_videos` and published to `src/data/videos/<slug>.json`.

Ambiguous names need strong relevance rules. Examples include Astro, Fiber, Gin, Ghost, Haystack, Medusa, Monica, Phoenix, and Rocket; without stack-specific signals, ordinary gaming, chemistry, music, craft, or celebrity videos can leak into discovery.

## YouTube transcripts

`transcribe_youtube.py` selects `pending` rows from `youtube_videos`, fetches caption segments into the ignored local cache `youtube/data/transcripts/<video-id>.json`, and updates transcript status metadata.

```text
pending ── success ───────▶ fetched
   │
   ├── permanent no captions/unplayable ─▶ unavailable
   └── IP block/network/unknown error ────▶ failed ── reset to pending for retry
```

`enrich_transcripts.py` reads that raw cache and uses `OPENAI_API_KEY` plus `OPENAI_MODEL` to publish `src/data/transcripts/<video-id>.json`:

```json
{
  "schemaVersion": 2,
  "videoId": "DKnn8TlJ4MA",
  "language": "en",
  "source": "auto",
  "chapters": [
    {
      "title": "Installing Laravel Herd",
      "description": "Set up the local PHP and Node environment.",
      "startTime": 203,
      "endTime": 445
    }
  ],
  "summary": "## Summary\n\nThe most relevant concepts…",
  "transcription": "## Introduction\n\nLiteral, punctuated speech…"
}
```

The AI may repair punctuation, headings, paragraphs, and obvious caption mistakes, but the `transcription` must preserve the speech rather than summarize it. `src/lib/transcripts.ts` loads schema-v2 files with `import.meta.glob`; the video detail route renders chapters, summary, and structured transcription Markdown.

`youtube-transcript-api` does not use the official YouTube Data API quota. YouTube may block the host IP during bulk access. `IpBlocked`, `RequestBlocked`, and similar failures are retryable and must not be recorded as permanent no-caption results. Use slower pacing, a cooldown, or a supported rotating proxy.

Observed 2026-07-13 run: 1,121 selected videos, 3,429 seconds, 40 fetched, 583 reported unavailable, and 498 failed after blocking. After fixing transient-error classification and adding the three-video smoke test, 43 transcript artifacts were verified. This is an operational record, not an expected success rate.

## Canonical commands

```bash
# GitHub discovery and PostgreSQL writes
pnpm scrape
pnpm scrape -- -a domains=laravel

# YouTube discovery
pnpm scrape:youtube -- -a domains=laravel

# Transcript fetch
scraper/.venv/bin/python scraper/transcribe_youtube.py --slug laravel --limit 20

# Raw captions → published AI structure
scraper/.venv/bin/python scraper/enrich_transcripts.py --limit 100

# PostgreSQL → generated JSON
node scripts/pull-data.mjs

# Optional factory → committed blog tree
node scripts/hydrate-blog.mjs

# Full hydration + Astro generation
pnpm run build
```

## Canonical validation

`pnpm run build` is the end-to-end validation command. `prebuild` performs project/video publishing and editorial hydration before Astro runs. A passing build verifies the live PostgreSQL-to-JSON-to-static-site path when database credentials are configured.

Also run the Laravel classifier test after changes to `normalize.py` or `domain-catalog.json`:

```bash
scraper/.venv/bin/python scraper/tests/test_categorize_laravel.py
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

- Expand strict categorization beyond Laravel for ambiguous technologies.
- Add a durable proxy or OAuth-backed caption strategy for large transcript batches.
- Formally attach or migrate `technologies_id_seq` at the schema level; runtime repair currently protects inserts.
- Add manifest verification (`package.json`, `composer.json`, etc.) for higher-confidence repository classification.
- Add isolated screenshot capture and homepage validation if real screenshots/user-submitted URLs become part of publishing.
