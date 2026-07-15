# MadeWithWhat YouTube scraper

Discovers English YouTube tutorials per technology via the official YouTube Data
API v3, applies quality and relevance gates, fetches transcripts, and publishes
build-time JSON for the Astro site. Extracted from `../scraper` as a standalone
Scrapy project (package `madewith_youtube`).

PostgreSQL is authoritative for video and transcript metadata. Generated files
under `src/data/` are publishing artifacts. The domain catalog is shared with
the rest of the project at `src/config/domain-catalog.json`; relevance rules
live in `src/config/video-relevance.json`.

## Setup

From the repository root:

```bash
python3 -m venv youtube/.venv
youtube/.venv/bin/pip install -r youtube/requirements.txt
cp .env.example .env   # if not already present
```

Required `.env` entries (read from the repository-root `.env`):

```dotenv
DATABASE_URL=
YOUTUBE_API_KEY=
OPENAI_API_KEY=      # only for transcript enrichment
```

- `DATABASE_URL`: PostgreSQL used by discovery, publishing, and transcript status.
- `YOUTUBE_API_KEY`: required for YouTube Data API discovery.
- `OPENAI_API_KEY`: required only by `enrich_transcripts.py`. `OPENAI_MODEL` defaults to `gpt-5-mini`.

Never put real credential values in documentation or logs.

## Discovery

Discovery uses the YouTube Data API v3, then applies quality and relevance gates.

```bash
pnpm scrape:youtube -- -a domains=laravel
pnpm scrape:youtube -- -a domains=laravel -a refresh_days=0
# or directly:
cd youtube && .venv/bin/scrapy crawl youtube -a domains=laravel
```

Spider arguments:

| Argument | Default | Description |
| --- | --- | --- |
| `domains` | all | Comma-separated catalog slugs |
| `clean` | 0 | `1` clears YouTube search-run state |
| `refresh_days` | 14 | Skip recently searched domains; `0` disables cooldown |
| `max_results` | 40 | Candidates requested per domain (capped at 50) |

Relevance rules live in `src/config/video-relevance.json` and matter most for
ambiguous terms such as Astro, Fiber, Gin, Ghost, Haystack, Medusa, Monica,
Phoenix, and Rocket.

Tables written: `youtube_videos`, `youtube_search_runs`.

## Publishing video JSON

```bash
pnpm scrape:youtube:publish            # all domains
pnpm scrape:youtube:publish -- laravel # one slug
```

`publish_videos.py` loads videos by technology, applies the relevance gate and
ranking, and writes `src/data/videos/<slug>.json`. It is also invoked at build
time by `scripts/pull-data.mjs`.

## Transcripts

`transcribe_youtube.py` reads pending videos from PostgreSQL and writes raw
caption files to the local cache `youtube/data/transcripts/<videoId>.json`
(Git-ignored):

```bash
youtube/.venv/bin/python youtube/transcribe_youtube.py --slug laravel --limit 20
youtube/.venv/bin/python youtube/transcribe_youtube.py --limit 1200 --sleep 1
```

| Argument | Default | Description |
| --- | --- | --- |
| `--slug` | all | Restrict work to one catalog slug |
| `--limit` | 100 | Maximum pending videos selected |
| `--lang` | `en` | Preferred transcript language |
| `--sleep` | `0.5` | Delay between requests; increase for bulk runs |
| `--force` | off | Replace an existing transcript file |
| `--out` | `youtube/data/transcripts` | Raw-caption output directory |

Convert raw captions to the published v2 schema (requires `OPENAI_API_KEY`):

```bash
youtube/.venv/bin/python youtube/enrich_transcripts.py --video-id DKnn8TlJ4MA
youtube/.venv/bin/python youtube/enrich_transcripts.py --limit 100
```

Published output at `src/data/transcripts/<video-id>.json` contains
`chapters[]`, `summary`, `transcription`, and provenance fields
(`schemaVersion`, `videoId`, `language`, `source`). Existing schema-v2 outputs
are skipped unless `--force` is supplied.

Transcript status columns on `youtube_videos`:

- `pending`: eligible for the next run
- `fetched`: JSON written successfully
- `unavailable`: permanent no-caption/unplayable condition
- `failed`: transient block/network/unknown failure; reset to `pending` before retrying

Bulk fetching is not the official YouTube Data API. `youtube-transcript-api` can
trigger `IpBlocked` or `RequestBlocked`; these are transient and must not be
treated as evidence that captions are absent. Stop the run, allow a cooldown,
increase `--sleep`, or configure a proxy before retrying.

**Proxy** (recommended for bulk runs — YouTube IP-blocks datacenter ranges).
`transcribe_youtube.py` reads proxy settings from the environment:

| Variable(s) | Proxy |
| --- | --- |
| `WEBSHARE_PROXY_USERNAME` + `WEBSHARE_PROXY_PASSWORD` | Webshare residential (most reliable) |
| `YT_PROXY_HTTP` / `YT_PROXY_HTTPS` (or `YT_PROXY_URL` for both) | Any generic HTTP/S proxy |

```sql
-- reset retryable failures
UPDATE youtube_videos SET transcript_status = 'pending'
WHERE transcript_status = 'failed';
```

## Cleaning up non-relevant videos

`cleanup_videos.py` re-applies the relevance gate to every stored video and
removes ones that no longer pass — useful after tightening
`src/config/video-relevance.json`. By default it targets only **explicit
off-topic rejects** (a video that matched a reject pattern, or whose slug left
the catalog); the lower-confidence `missing_*` failures (no positive tech
signal, which can be false positives) need `--aggressive`.

```bash
youtube/.venv/bin/python youtube/cleanup_videos.py                 # dry run — report only
youtube/.venv/bin/python youtube/cleanup_videos.py --slug phoenix  # scope to one slug
youtube/.venv/bin/python youtube/cleanup_videos.py --apply         # delete explicit off-topic rejects
youtube/.venv/bin/python youtube/cleanup_videos.py --aggressive --apply   # also delete missing-signal failures
```

## Tests

```bash
cd youtube && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```
