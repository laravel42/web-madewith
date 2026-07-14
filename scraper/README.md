# MadeWithWhat data scraper

The scraper discovers GitHub repositories and YouTube tutorials, stores normalized records in PostgreSQL, and publishes build-time JSON for the Astro site.

PostgreSQL is authoritative for repository and video metadata. Generated files under `src/data/` are publishing artifacts.

## Setup

From the repository root:

```bash
python3 -m venv scraper/.venv
scraper/.venv/bin/pip install -r scraper/requirements.txt
cp .env.example .env
```

Required `.env` entries:

```dotenv
GITHUB_TOKEN=
DATABASE_URL=
YOUTUBE_API_KEY=
```

- `GITHUB_TOKEN`: strongly recommended; GitHub Search rises from 10 to 30 requests/minute and core API access rises to 5,000 requests/hour.
- `DATABASE_URL`: PostgreSQL used by discovery, loaders, publishing, status tracking, and transcript status.
- `YOUTUBE_API_KEY`: required only for YouTube Data API discovery.

Never put real credential values in documentation or logs.

## GitHub discovery

```bash
pnpm scrape                          # all domains
pnpm scrape -- -a domains=laravel   # one catalog slug
pnpm scrape:status                  # inspect PostgreSQL search-run state
pnpm scrape:publish                 # publish all project JSON
pnpm scrape:publish -- laravel      # publish one slug
```

Spider arguments:

| Argument | Default | Description |
| --- | --- | --- |
| `domains` | all | Comma-separated catalog slugs |
| `keep` | 1000 | Maximum published projects per domain |
| `clean` | 0 | `1` removes existing `spawn:*` search runs before discovery |

Scrapy AutoThrottle and download delay control request pacing.

### GitHub’s 1,000-result ceiling

GitHub Search returns no more than the first 1,000 results for one query. Authentication raises rate limits but does not remove this ceiling. A request beyond result 1,000 returns HTTP 422. Use bounded star ranges or another non-overlapping partition strategy for deeper coverage.

`src/config/domain-catalog.json` is authoritative for each technology’s query, minimum stars, exclusions, and optional categorization rules. Do not substitute the catalog slug for `scrape.query`; for example, `next` intentionally queries `topic:nextjs`.

A topic is only a discovery hint. Final categorization occurs during publishing in `madewith_scraper/normalize.py`. Laravel’s catalog rules keep Laravel applications/projects, Laravel packages/plugins, and Laravel-specific tools; generic projects that merely advertise a Laravel integration are excluded.

Run the Laravel labeled-case test after categorization changes:

```bash
scraper/.venv/bin/python scraper/tests/test_categorize_laravel.py
```

## PostgreSQL writes

`madewith_scraper/db.py` updates the scraper-owned repository fields and related rows in one transaction:

- `repositories`
- `repository_topics`
- `repository_languages`
- `repository_technologies`
- `repository_metrics`
- `repository_star_snapshots`
- `github_search_runs`
- `technologies`

`metadata.raw` preserves the original GitHub API result used by `load_repos_for_slug()` and `publish.py`. Do not remove or reshape that contract without updating the publisher.

Metrics snapshots use an upsert on `(repository_id, captured_at)` so rapid idempotent replay does not violate the unique constraint. Daily star snapshots upsert one record per repository/day.

If a technology row is missing, repository ingestion safely skips the orphan unless the caller creates the technology first. `ensure_technology()` also repairs the existing plain-default `technologies_id_seq`; the sequence is not formally attached as `SERIAL`/`IDENTITY`, so `pg_get_serial_sequence()` cannot be relied on.

## CSV replay/import

These adapters import CSV produced by an external GitHub search exporter. They are auxiliary replay tools; the Scrapy/PostgreSQL flow above is the primary pipeline.

One file:

```bash
scraper/.venv/bin/python scraper/load_csv_to_pg.py \
  /path/to/github_laravel.csv laravel \
  --ensure-tech --min-stars 50
```

Every `github_*.csv` in a directory:

```bash
scraper/.venv/bin/python scraper/load_all_csv_to_pg.py \
  /path/to/csv-directory --ensure-tech
```

The all-file loader applies each catalog entry’s `scrape.minStars` unless `--min-stars` overrides it. Archived repositories are skipped unless `--include-archived` is supplied. Replays are idempotent: existing repositories are updated and technology links are refreshed rather than duplicated.

## Publishing project JSON

```bash
pnpm scrape:publish
node scripts/pull-data.mjs
```

`publish.py` loads PostgreSQL records by technology, applies categorization/noise filtering and ranking, and writes `src/data/<slug>.json`.

`node scripts/pull-data.mjs` is the build-time hydration command. With `DATABASE_URL`, it runs both:

1. `scraper/publish.py` → `src/data/*.json`
2. `scraper/publish_videos.py` → `src/data/videos/*.json`

If PostgreSQL publishing fails, committed JSON is kept. If PostgreSQL is unset, the script can fetch legacy datasets from `MADEWITH_DATA_BASE_URL`; otherwise it uses committed files.

## YouTube tutorial discovery

YouTube discovery uses the official YouTube Data API v3, then applies quality and relevance gates.

```bash
pnpm scrape:youtube -- -a domains=laravel
pnpm scrape:youtube -- -a domains=laravel -a refresh_days=0
pnpm scrape:youtube:publish -- laravel
```

Spider arguments:

| Argument | Default | Description |
| --- | --- | --- |
| `domains` | all | Comma-separated catalog slugs |
| `clean` | 0 | `1` clears YouTube search-run state |
| `refresh_days` | 14 | Skip recently searched domains; `0` disables cooldown |

Quality thresholds are configured by the `YOUTUBE_*` variables in `.env.example`. Relevance rules live in `src/config/video-relevance.json` and are especially important for ambiguous terms such as Astro, Fiber, Gin, Ghost, Haystack, Medusa, Monica, Phoenix, and Rocket.

Tables:

- `youtube_videos`
- `youtube_search_runs`

Published output: `src/data/videos/<slug>.json`.

## YouTube transcripts

`transcribe_youtube.py` reads pending videos from PostgreSQL and writes raw caption files to a local cache:

```bash
scraper/.venv/bin/python scraper/transcribe_youtube.py --slug laravel --limit 20
scraper/.venv/bin/python scraper/transcribe_youtube.py --limit 1200 --sleep 1
```

Arguments:

| Argument | Default | Description |
| --- | --- | --- |
| `--slug` | all | Restrict work to one catalog slug |
| `--limit` | 100 | Maximum pending videos selected |
| `--lang` | `en` | Preferred transcript language |
| `--sleep` | `0.5` | Delay between requests; increase for bulk runs |
| `--force` | off | Replace an existing transcript file |
| `--out` | `scraper/data/transcripts` | Raw-caption output directory |

The raw shape preserves timestamped source data for deterministic reprocessing:

```json
{
  "videoId": "DKnn8TlJ4MA",
  "language": "en",
  "source": "auto",
  "segments": [{ "start": 0.399, "text": "…" }],
  "text": "…"
}
```

Raw cache files are ignored by Git. Convert them to the published schema with:

```bash
scraper/.venv/bin/python scraper/enrich_transcripts.py --video-id DKnn8TlJ4MA
scraper/.venv/bin/python scraper/enrich_transcripts.py --limit 100
```

`OPENAI_API_KEY` is required. `OPENAI_MODEL` defaults to `gpt-5-mini`. Existing schema-v2 outputs are skipped unless `--force` is supplied.

Published output at `src/data/transcripts/<video-id>.json` contains:

- `chapters[]`: meaningful AI-generated `title` and `description`, plus numeric `startTime` and `endTime` seconds
- `summary`: Markdown résumé of the video's most relevant concepts
- `transcription`: literal speech-to-text content, AI-formatted into readable Markdown without summarizing or inventing content
- provenance fields: `schemaVersion`, `videoId`, `language`, and `source`

Status columns on `youtube_videos`:

- `pending`: eligible for the next run
- `fetched`: JSON written successfully
- `unavailable`: permanent no-caption/unplayable condition
- `failed`: transient block/network/unknown failure; reset to `pending` before retrying

Bulk fetching is not the official YouTube Data API. `youtube-transcript-api` can trigger `IpBlocked` or `RequestBlocked`. These are transient and must not be treated as evidence that captions are absent. Stop the run, allow a cooldown, increase `--sleep`, or configure a supported rotating proxy before retrying.

Reset retryable failures:

```sql
UPDATE youtube_videos
SET transcript_status = 'pending'
WHERE transcript_status = 'failed';
```

The observed 2026-07-13 full batch processed 1,121 videos in 3,429 seconds and reported 40 fetched, 583 unavailable, and 498 failed after the host IP was blocked. The statuses were subsequently corrected so ambiguous non-fetched records could be retried. Together with the three-video smoke test, 43 transcript JSON files were verified.

## Legacy JSON migration

Use this only to replay older committed project snapshots into PostgreSQL:

```bash
pnpm scrape:migrate-json -- --from-git HEAD
pnpm scrape:migrate-json -- laravel
pnpm scrape:publish
```

## Validation

```bash
scraper/.venv/bin/python scraper/tests/test_categorize_laravel.py
node scripts/pull-data.mjs
pnpm run build
```

`pnpm run build` is the canonical full check because its `prebuild` republishes project/video JSON, hydrates editorial content, and then generates all Astro pages.
