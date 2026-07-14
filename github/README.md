# MadeWithWhat GitHub Discovery

Production-oriented Python library tailored to the supplied PostgreSQL schema.

## What it does

- **`discover`** searches GitHub across *all* enabled technologies (no per-technology argument), enriches each unique repository once, and qualifies it at runtime against every technology — assigning it to the domain(s) it belongs to and classifying it in a single pass.
- **`qualify`** re-runs that same cross-technology assignment over already-scraped repositories with no GitHub calls, so it is cheap to re-run whenever rules or technologies change.
- Records every query and partition in `github_search_runs`.
- Avoids repeatedly enriching the same repository using `github_repository_id` plus `enriched_at` freshness.
- Upserts complete repository metadata, topics, languages, manifests, metric snapshots (`repository_metrics`), and daily star snapshots (`repository_star_snapshots`).
- Qualifies a repository from auto-derived signals (dependency, config file, topic, keyword) plus any hand-authored `technology_rules`, persisting auditable evidence/confidence.
- Separately classifies project type and business domain with deterministic confidence.
- Uses bounded pagination, rate-limit awareness, retries, and idempotent database writes.

## Install

Requires **Python 3.11+** (declared in `pyproject.toml`; the build backend is
[hatchling](https://hatch.pypa.io/)). Editable installs need a modern `pip`
(PEP 660), so upgrade `pip` inside the fresh venv before installing — the `pip`
bundled with older interpreters (e.g. macOS system Python) will fail with
`Directory cannot be installed in editable mode`.

```bash
python3.11 -m venv .venv          # must be 3.11+; the macOS system python (3.9) won't work
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .                  # add ".[dev]" for tests/lint, ".[llm]" for the OpenAI fallback
cp .env.example .env              # then fill in DATABASE_URL and GITHUB_TOKEN
```

## Configure

Settings are read from environment variables (or `.env`); see `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `GITHUB_TOKEN` | — | GitHub PAT for the search/enrichment API (required) |
| `GITHUB_API_VERSION` | `2022-11-28` | GitHub REST API version header |
| `REQUEST_TIMEOUT_SECONDS` | `30` | Per-request HTTP timeout |
| `REFRESH_AFTER_DAYS` | `14` | Skip repos enriched within this many days |
| `CLASSIFIER_LLM_ENABLED` | `false` | Enable the LLM classifier fallback |
| `OPENAI_API_KEY` | — | Required when `CLASSIFIER_LLM_ENABLED=true` (install `.[llm]`) |
| `CLASSIFIER_MODEL` | `gpt-4.1-mini` | Model used for the LLM fallback |

## Run

Discover repositories across **all** enabled technologies and qualify each one
at runtime. There is no per-technology argument: the search plan is the union of
every technology's own search config, each unique repo is enriched exactly once,
and it is scored against every technology — so a repo is assigned to all the
domains it belongs to (and classified) in a single pass.

```bash
madewith-github discover --window-days 30 --max-pages 10
madewith-github discover --max-repos 200        # bound a run for testing
```

| Option | Default | Purpose |
| --- | --- | --- |
| `--window-days` | `30` | Size of each `pushed:` search window |
| `--max-pages` | `10` | Max result pages per query (GitHub caps search at 1,000 results) |
| `--max-repos` | — | Stop after processing this many unique repositories |

### Re-qualify already-scraped repositories

`discover` already qualifies at runtime, so you only need `qualify` to **re-run
the assignment** over repositories already in the database — for example after
editing `technology_rules` or adding a technology. It scores every stored
repository against **all** enabled technologies and writes a
`repository_technologies` row for each qualifying match, with **no** GitHub
calls, so it is cheap to re-run:

```bash
madewith-github qualify                 # assign every stored repo
madewith-github qualify --dry-run       # score and report without writing
madewith-github qualify --limit 50      # only the 50 most-starred repos
```

As a side effect (except under `--dry-run`) it also backfills
`repository_metrics` and `repository_star_snapshots` for every stored
repository from the columns already on `repositories`, so those tables stay
populated even for repos enriched before metric capture was wired in.

### Monitor progress

While `discover` (or `qualify`) runs, tail the repo-per-domain counts live:

```bash
python scripts/tail_domains.py                 # verified assignments, 2s refresh
python scripts/tail_domains.py --interval 1    # faster refresh
python scripts/tail_domains.py --status all    # count every assignment, not just verified
python scripts/tail_domains.py --top 25        # only the 25 biggest domains
```

It reads `DATABASE_URL` from the environment or `github/.env`, redraws a ranked
table of assignments per technology plus totals (repos / assigned / no-domain),
and exits on `Ctrl-C`.

## Develop

```bash
pip install -e ".[dev]"
pytest
```

## Preventing repeated work

There are three layers:

1. GitHub's immutable numeric repository ID is unique in `repositories`, and every repo is de-duplicated **within a run** — a repo surfaced by several technologies' queries is enriched only once.
2. Fresh repositories (`enriched_at` within `REFRESH_AFTER_DAYS`) are skipped before expensive enrichment calls.
3. Each discovery is recorded in `github_search_runs` (with a null `technology_id`, since one run spans the whole catalog) so a scheduler can rotate `pushed:` windows instead of always querying page one.

For exhaustive catalogs, schedule non-overlapping `pushed:` windows (for example 30 days each) and split any query returning near GitHub's 1,000-result search ceiling into narrower date or star ranges.

## How qualification works

A repository is scored against a technology by combining **auto-derived
signals** with any hand-authored `technology_rules`, on a single **0–100**
confidence scale. Signals and their weights:

| Signal | Points | Strong? | Source |
| --- | --- | --- | --- |
| `dependency` | 70 | yes | exact package name in a manifest — from `technologies.metadata.dependencies`, a `dependency` rule, or the slug itself (`react` → the `react` package, `laravel` → `laravel/*`) |
| `dependency_prefix` | 70 | yes | scoped-package family, e.g. `@nuxt/` |
| `config_file` | 68 | yes | a framework config file is present, e.g. `next.config.js` |
| `manifest_value` | 58 | yes | any other manifest selector rule matched |
| `runtime_signal` | 40 | no | code-level hint in the README/manifests |
| `topic` | 30 | no | the repo self-declares a matching topic |
| `text` | 14 | no | the technology name/keyword appears in the text |

A repository is assigned to a technology when the summed confidence clears the
technology's `quality_threshold` (default 65) **and** at least one *strong*
signal is present — so a single real dependency (70) qualifies, while a bare
topic (30) does not. Because the strongest signals are auto-derived from each
technology's own slug/name/topics/metadata, technologies **without** any
`technology_rules` still qualify repositories out of the box; rules refine and
extend that baseline.

Supported `rule_type` values: `dependency`, `runtime_dependency`,
`dependency_prefix`, `config_file`, `file_exists`, `path_exists`,
`manifest_value`, `script`, `topic`, `runtime_signal`, `readme_regex`,
`content_regex`, `keyword`.

Technologies whose `metadata.requires_runtime_verification` is `true` (e.g.
Node) require at least two corroborating signals before being assigned, since a
lone signal matches too loosely.

For a `dependency` rule, put the **package name** in `expected_value` (the
engine matches it against the manifest's dependency keys); for a `config_file`
rule, put the filename in `manifest_path` (or `expected_value`). The
`confidence`/`weight`/`strong_evidence` columns are retained for compatibility
and ordering but no longer set the score — points come from the signal table
above. Example Next.js rules:

```sql
INSERT INTO technology_rules
(technology_id,rule_type,manifest_path,selector,expected_value,confidence,weight,strong_evidence,active,metadata,created_at,updated_at)
VALUES
(:tech,'dependency','package.json',NULL,'next',1,1,true,true,'{}',now(),now()),
(:tech,'config_file','next.config.js',NULL,'next.config.js',1,1,true,true,'{}',now(),now()),
(:tech,'content_regex','README.md',NULL,'\\bNext\\.js\\b',1,1,false,true,'{}',now(),now());
```

## Important production extension

The deterministic classifier is intentionally conservative. Enable an LLM only as a fallback for ambiguous records, never as the sole source of truth. Persist the prompt hash and structured output in the existing `llm_input_hash` and `llm_output` fields.
