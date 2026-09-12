# MadeWithWhat data scraper

The scraper discovers GitHub repositories, stores normalized records in PostgreSQL, and publishes build-time JSON for the Astro site.

PostgreSQL is authoritative for repository metadata. Generated files under `src/data/` are publishing artifacts.

> YouTube tutorial discovery, transcripts, and video publishing have moved to a standalone project at [`../youtube`](../workers/videos/README.md).

## Setup

From the repository root:

```bash
python3 -m venv workers/.venv
workers/.venv/bin/pip install -r workers/requirements.txt
cp .env.example .env
```

Required `.env` entries:

```dotenv
GITHUB_TOKEN=
DATABASE_URL=
```

- `GITHUB_TOKEN`: strongly recommended; GitHub Search rises from 10 to 30 requests/minute and core API access rises to 5,000 requests/hour.
- `DATABASE_URL`: PostgreSQL used by discovery, loaders, publishing, and status tracking.

Never put real credential values in documentation or logs.

## GitHub discovery

```bash
pnpm projects:scrape                          # all domains
pnpm projects:scrape -- -a domains=laravel   # one catalog slug
pnpm projects:status                  # inspect PostgreSQL search-run state
pnpm projects:publish                 # publish all project JSON
pnpm projects:publish -- laravel      # publish one slug
```

Spider arguments:

| Argument | Default | Description |
| --- | --- | --- |
| `domains` | all | Comma-separated catalog slugs |
| `clean` | 0 | `1` removes existing `spawn:*` search runs before discovery |
| `page_size` | 25 | Repositories requested per GraphQL page (capped at 100) |
| `max_pages` | 40 | Pages per shard; `page_size x max_pages` is the shard's result budget, capped at GitHub's 1,000-result ceiling |
| `refresh_days` | 7 | Re-queue completed shards older than N days so default-branch tip dates stay current; `0` keeps shards done forever until `clean=1` |

Scrapy AutoThrottle and download delay control request pacing.

### 502 Bad Gateway means the page is too big

GitHub's search backend times out on large pages of the discovery query and
nginx answers with an HTML `502 Bad Gateway` rather than a GraphQL error. The
page size is the lever: `first: 100` times out reliably, `first: 25` does not.
The spider halves the page size (down to 10) and re-requests the same cursor
whenever a page 502s or GraphQL reports a timeout, so a slow shard costs extra
requests instead of returning nothing. Because the budget is counted in results
rather than pages, shrinking the page does not shrink coverage.

Raising `page_size` past the default invites those timeouts; lower it further if
a domain still fails.

### GitHub’s 1,000-result ceiling

GitHub Search returns no more than the first 1,000 results for one query. Authentication raises rate limits but does not remove this ceiling. A request beyond result 1,000 returns HTTP 422. Use bounded star ranges or another non-overlapping partition strategy for deeper coverage.

`src/config/domain-catalog.json` is authoritative for each technology’s query, minimum stars, exclusions, and optional categorization rules. Do not substitute the catalog slug for `scrape.query`; for example, `next` intentionally queries `topic:nextjs`.

A topic is only a discovery hint. Final categorization occurs during publishing in `madewith_workers/projects/normalize.py`. Laravel’s catalog rules keep Laravel applications/projects, Laravel packages/plugins, and Laravel-specific tools; generic projects that merely advertise a Laravel integration are excluded.

Run the Laravel labeled-case test after categorization changes:

```bash
workers/.venv/bin/python workers/projects/tests/test_categorize_laravel.py
```

## PostgreSQL writes

`madewith_workers/projects/db.py` updates the scraper-owned repository fields and related rows in one transaction:

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

## Publishing project JSON

```bash
pnpm projects:publish
node workers/utils/pull-data.mjs
```

`publish.py` loads PostgreSQL records by technology, applies categorization/noise filtering and ranking, and writes `src/data/<slug>.json`.

`node workers/utils/pull-data.mjs` is the build-time hydration command. With `DATABASE_URL`, it runs both:

1. `workers/projects/publish.py` → `src/data/*.json`
2. `workers/videos/publish_videos.py` → `src/data/videos/*.json` (see [`../youtube`](../workers/videos/README.md))

If PostgreSQL publishing fails, committed JSON is kept. If PostgreSQL is unset, the script can fetch legacy datasets from `MADEWITH_DATA_BASE_URL`; otherwise it uses committed files.

## Legacy JSON migration

Use this only to replay older committed project snapshots into PostgreSQL:

```bash
pnpm projects:publish
```

## Validation

```bash
workers/.venv/bin/python workers/projects/tests/test_categorize_laravel.py
node workers/utils/pull-data.mjs
pnpm run build
```

`pnpm run build` is the canonical full check because its `prebuild` republishes project/video JSON, hydrates editorial content, and then generates all Astro pages.
