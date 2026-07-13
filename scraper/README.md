# MadeWith GitHub scraper (Scrapy)

Discovers repos via GitHub GraphQL, stores them in the **madewith** Postgres schema, and publishes `src/data/<slug>.json`.

## Setup

```bash
cd scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set in repo root `.env`:

```
GITHUB_TOKEN=ghp_...
DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/madewith
```

## Run

From repo root:

```bash
pnpm scrape:setup                    # once: venv + pip install
pnpm scrape                          # all domains
pnpm scrape -- -a domains=laravel    # one domain
pnpm scrape:publish                  # write src/data/*.json from DB
pnpm scrape:status                   # shard progress in Postgres
```

Options (Scrapy spider args):

| Arg | Default | Description |
|-----|---------|-------------|
| `domains` | all | Comma-separated catalog slugs |
| `keep` | 1000 | Max projects per domain in publish |
| `clean` | 0 | `1` deletes `spawn:*` search runs first |

Built-in [Scrapy](https://github.com/scrapy/scrapy) throttling (`AUTOTHROTTLE`, `DOWNLOAD_DELAY`) replaces the old Node rate-limit hacks.

## Tables used

- `github_search_runs` — shard progress (`spawn:laravel:2000-4999`)
- `repositories`, `repository_topics`, `repository_languages`, `repository_technologies`
- `technologies` — publish metadata in `metadata.scrape`

## YouTube tech videos

English tutorial discovery via YouTube Data API v3 with quality gates (min views/subs/duration, HD, engagement ratio, spam title filters) **and tech-relevance filtering** (shared rules in `src/config/video-relevance.json` — blocks dance/gaming/chemistry false positives and requires stack-specific signals for ambiguous names like Phoenix, Haystack, Gin).

```bash
pnpm scrape:youtube -- -a domains=laravel
pnpm scrape:youtube:publish -- laravel
```

YouTube spider args:

| Arg | Default | Description |
|-----|---------|-------------|
| `domains` | all | Comma-separated catalog slugs |
| `clean` | 0 | `1` clears `youtube_search_runs` and re-scrapes all |
| `refresh_days` | 14 | Skip domains scraped within N days (`0` = no cooldown) |

Set `YOUTUBE_API_KEY` in `.env`. Output: `src/data/videos/<slug>.json`.

Quality gate env vars: `YOUTUBE_MIN_VIEWS`, `YOUTUBE_MIN_CHANNEL_SUBS`, `YOUTUBE_MIN_DURATION_SEC`, etc. (see `.env.example`).

Tables: `youtube_videos`, `youtube_search_runs` (auto-migrated on first run).

## Import committed JSON → Postgres

If `src/data/*.json` has richer snapshots than the DB, import them without duplicates (matched by `full_name`):

```bash
pnpm scrape:migrate-json -- --from-git HEAD    # committed snapshots
pnpm scrape:migrate-json -- laravel            # one domain from disk
pnpm scrape:publish
```
