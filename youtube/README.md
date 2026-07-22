# MadeWithWhat YouTube scraper

Discovers English YouTube tutorials per technology via the official YouTube Data
API v3, applies quality and relevance gates, fetches transcripts, and publishes
build-time JSON for the Astro site. Extracted from `../scraper` as a standalone
Scrapy project (package `madewith_youtube`).

PostgreSQL is authoritative for video and transcript metadata. Generated files
under `src/data/` are publishing artifacts. The domain catalog is shared with
the rest of the project at `src/config/domain-catalog.json`; relevance rules
live in `src/config/video-relevance.json`.

The repo-root `./pipeline.sh videos` aggregates the whole flow (transcribe →
enrich → rewrite descriptions → publish); the commands below are the
individual steps.

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
OPENROUTER_API_KEY=  # only for transcript enrichment (or OPENAI_API_KEY)
```

- `DATABASE_URL`: PostgreSQL used by discovery, publishing, and transcript status.
- `YOUTUBE_API_KEY`: required for YouTube Data API discovery.
- Enrichment (`enrich_transcripts.py`) needs one model backend:
  - `OPENROUTER_API_KEY`: routes through OpenRouter; the model defaults to `google/gemini-2.5-pro`
    (best quality; set `ENRICH_MODEL=google/gemini-2.5-flash` for ~10x cheaper bulk runs).
    Model precedence: `--model` > `ENRICH_MODEL` > `OPENAI_MODEL` (legacy, shared) > default.
  - `OPENAI_API_KEY`: uses OpenAI directly; `OPENAI_MODEL` defaults to `gpt-5-mini`.
  - `OPENAI_BASE_URL` (or `--base-url`): any other OpenAI-compatible server, e.g.
    `http://localhost:11434/v1` for Ollama (no key needed; `--model` required).

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

Relevance rules live in `src/config/video-relevance.json`; 25 ambiguous slugs
have strict reject/require rules (`strictSlugs`), e.g. Express vs
HitFilm/Adobe Express, Alpine vs Alpine Linux, Django vs the movie, React vs
reaction videos, Rails vs model railways, Twill vs the fabric.

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
youtube/.venv/bin/python youtube/transcribe_youtube.py --limit 500 --sleep 1 --workers 2
youtube/transcribe_rotate.sh ~/vpn-wg 100 1 2     # bulk fetch with VPN location rotation
```

| Argument | Default | Description |
| --- | --- | --- |
| `--slug` | all | Restrict work to one catalog slug |
| `--limit` | 100 | Maximum pending videos selected |
| `--lang` | `en` | Preferred transcript language |
| `--sleep` | `0.5` | Per-worker delay between requests; increase for bulk runs |
| `--workers` | 1 | Concurrent fetchers. Blocks are per-IP and rate-triggered — keep 1–3 from a single IP; high counts only behind a rotating proxy |
| `--force` | off | Replace an existing transcript file |
| `--out` | `youtube/data/transcripts` | Raw-caption output directory |

Transcript status columns on `youtube_videos`:

- `pending`: eligible for the next run (IP-block/network errors leave a video here, so re-runs resume automatically)
- `fetched`: JSON written successfully
- `unavailable`: permanent no-caption/unplayable condition
- `failed`: non-transient errors only; reset to `pending` to retry

Bulk fetching is not the official YouTube Data API — the caption endpoint is
anonymous and YouTube's defense is purely **IP-based** (the API key is
irrelevant to blocks). After 3 consecutive block errors (10 with a proxy) the
run aborts with **exit 75** rather than grinding a burned IP through the
queue.

**VPN rotation** — `transcribe_rotate.sh <conf-dir> [chunk] [sleep] [workers]`
drives the fetcher through manual WireGuard configs (e.g. SurfShark: dashboard
→ VPN → Manual setup → WireGuard, one `.conf` per location). It brings up a
location, runs chunks until the queue empties or the location gets blocked
(exit 75), then rotates. Requires `brew install wireguard-tools bash` on macOS
(`wg-quick` needs bash 4+); `sudo` is used only for `wg-quick`, and the VPN
app must be disconnected while it runs.

**Rotating proxy** (alternative to VPN rotation):

| Variable(s) | Proxy |
| --- | --- |
| `WEBSHARE_PROXY_USERNAME` + `WEBSHARE_PROXY_PASSWORD` | Webshare residential (most reliable) |
| `YT_PROXY_HTTP` / `YT_PROXY_HTTPS` (or `YT_PROXY_URL` for both) | Any generic HTTP/S proxy |

## Enrichment

Convert raw captions to the published **schema v3** (chapters + `seoDescription`
+ summary + literal transcription; see `.env` notes above for provider/model):

```bash
youtube/.venv/bin/python youtube/enrich_transcripts.py --video-id DKnn8TlJ4MA --force
youtube/.venv/bin/python youtube/enrich_transcripts.py --limit 200 --workers 8 --max-output-tokens 32000
```

Runs are parallel (`--workers`, default 4) with buffered per-video log blocks,
per-call token usage (reasoning vs visible split), and a throughput-based ETA.
`--limit` counts only videos that still need work, so repeated runs always make
progress. If a long video's cleaned transcript can't fit in one response, the
run retries in structure-only mode and rebuilds the literal transcription from
the raw captions per chapter window. Existing v3 outputs are skipped unless
`--force`.

## Description rewrites

`rewrite_descriptions.py` covers videos **without** an enriched transcript: it
rewrites the raw YouTube description (sponsor plugs, links, timestamps) into
one neutral editorial paragraph via the LLM, accumulating idempotently in
`src/data/video-descriptions.json` (OpenRouter default model
`google/gemini-2.5-flash`; override with `DESC_MODEL` or `--model`).

```bash
youtube/.venv/bin/python youtube/rewrite_descriptions.py --dry-run   # preview queue
youtube/.venv/bin/python youtube/rewrite_descriptions.py             # rewrite
```

At publish time each video's display description resolves best-source-first:
**enriched `seoDescription` → LLM rewrite → sanitized raw text** (URL/promo/
timestamp lines stripped). The relevance gate still judges the raw
description.

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
