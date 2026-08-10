# MadeWithWhat data scraper

The scraper discovers GitHub repositories, stores normalized records in PostgreSQL, and publishes build-time JSON for the Astro site.

PostgreSQL is authoritative for repository metadata. Generated files under `src/data/` are publishing artifacts.

> YouTube tutorial discovery, transcripts, and video publishing have moved to a standalone project at [`../youtube`](../youtube/README.md).

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
```

- `GITHUB_TOKEN`: strongly recommended; GitHub Search rises from 10 to 30 requests/minute and core API access rises to 5,000 requests/hour.
- `DATABASE_URL`: PostgreSQL used by discovery, loaders, publishing, and status tracking.

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
| `clean` | 0 | `1` removes existing `spawn:*` search runs before discovery |
| `page_size` | 25 | Repositories requested per GraphQL page (capped at 100) |
| `max_pages` | 40 | Pages per shard; `page_size x max_pages` is the shard's result budget, capped at GitHub's 1,000-result ceiling |

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
2. `youtube/publish_videos.py` → `src/data/videos/*.json` (see [`../youtube`](../youtube/README.md))

If PostgreSQL publishing fails, committed JSON is kept. If PostgreSQL is unset, the script can fetch legacy datasets from `MADEWITH_DATA_BASE_URL`; otherwise it uses committed files.

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
