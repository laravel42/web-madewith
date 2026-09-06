# MadeWithWhat Main Editorial Engine

This version generates mixed editorial content for the **MadeWithWhat main index**, rather than creating many variations for one repository.

## What a 50-article batch contains

The default plan rotates through:

1. Technology comparisons
2. Ecosystem guides
3. Release/news analyses
4. Security alerts and dependency-security briefings
5. Combined stack guides
6. Architecture analyses
7. Repository spotlights
8. Adoption-signal analyses
9. Migration guides
10. Performance engineering checklists

Across 50 articles, each format appears five times and technologies are distributed across Frameworks, Frontend, Backend, CMS, Commerce, CRM/ERP, and AI/LLM.

## Dates

The default first publication date is six calendar months before execution.

Articles are grouped as follows:

```text
Articles 01–05 → first date
Articles 06–10 → first date + 1 day
Articles 11–15 → first date + 2 days
...
Articles 46–50 → first date + 9 days
```

Override it with:

```bash
python content_factory.py --start-date 2026-01-12
```

Or let the engine resume where the last batch stopped — it continues from the
newest published date, filling that date's remaining slots before rolling over:

```bash
python content_factory.py --start-date auto
```

## Install

```bash
python3 -m venv workers/.venv
workers/.venv/bin/pip install -r workers/requirements.txt
```

The script loads environment variables in this order:

1. `../.env`
2. `./.env`
3. dotenv's normal fallback search

## LLM provider

The factory routes through **OpenRouter** whenever `OPENROUTER_API_KEY` is set,
defaulting to `anthropic/claude-sonnet-4.5` (long-form editorial quality). With
only `OPENAI_API_KEY` it uses OpenAI directly (legacy behavior, default
`gpt-5-mini`). Keys are matched to the endpoint, so both can coexist in `.env`.

Overrides (env):

| Variable | Purpose | Default |
| --- | --- | --- |
| `FACTORY_MODEL` | Model for this tool only | `anthropic/claude-sonnet-4.5` (OpenRouter) / `gpt-5-mini` (OpenAI) |
| `FACTORY_BASE_URL` | Any OpenAI-compatible endpoint | OpenRouter when its key is set |
| `FACTORY_MAX_TOKENS` | Output cap per article (chat path) | `32000` |
| `FACTORY_MAX_RETRIES` | Attempts per LLM call before giving up | `5` |
| `FACTORY_MIN_BODY_CHARS` | Reject-and-retry threshold for stub bodies | `6000` |
| `FACTORY_CONCURRENCY` | Default for `--concurrency` | `1` |

`GITHUB_TOKEN` is also required (repository facts), and an LLM key —
`OPENROUTER_API_KEY` or `OPENAI_API_KEY` — must be present unless `--dry-run`.

## Preview the editorial schedule

This requires no API calls:

```bash
python content_factory.py --count 50 --dry-run
```

## Generate a batch

`--count` (default 10) is the number of **valid** articles the batch must
produce. Articles that fail validation or are rejected as near-duplicates are
replaced with fresh technology pairings until the target is met, capped at
`--max-attempts` generation attempts (default 3× `--count`). Pass `--fail-fast`
to abort on the first failure instead.

```bash
python content_factory.py \
  --count 50 \
  --seed 42
```

### Generate in parallel

`--concurrency` overlaps the LLM calls only. Validation, duplicate detection,
and every write stay on the main thread, and each slot keeps the pairing the
seed assigned it, so publication dates stay a gapless five-per-day run. Each
candidate is still scored against everything already accepted, so two
in-flight near-duplicates cannot both land. What can differ from a serial run
is which attempt finishes first, and therefore which of a colliding pair wins:

```bash
python content_factory.py --count 50 --concurrency 4
```

## Generate a smaller test batch

```bash
python content_factory.py \
  --count 5 \
  --start-date 2026-01-12
```

## Output structure

```text
output/
├── articles/
│   └── YYYY/MM/DD/
│       └── article-slug.md
├── assets/
│   └── YYYY/MM/DD/
│       ├── article-cover.jpg
│       └── article-data.jpg
└── batch-index.json
```

## Hydrate the Astro site

After generating articles, sync factory output into the site content tree:

```bash
pnpm blog:hydrate
```

This copies:

- `workers/posts/output/articles/**` → `src/content/blog/**`
- `workers/posts/output/assets/**` → `public/assets/**`

`blog:hydrate` runs automatically before `pnpm dev` and `pnpm run build`. If `workers/posts/output/articles` is absent, the command exits successfully and keeps committed `src/content/blog` content.

## Housekeeping

Cover and data images are written only once an article is accepted, so failed
and rejected attempts no longer leave files behind. To clear orphans from
earlier batches:

```bash
python content_factory.py --prune-assets --dry-run   # list them
python content_factory.py --prune-assets             # delete them
```

## Tests

No API keys or network access needed — GitHub and the LLM are stubbed:

```bash
pnpm blog:test          # or: python tests/run.py
python tests/run.py finalize --verbose
```

## What the engine guarantees about the body

The model writes the article; finalisation then repairs the defects that
recur regardless of prompt wording, and `validate_article` fails anything still
broken (one repair round trip, then the pairing is retried):

- bare section labels (`Executive answer` on its own line) become real `##`
  headings, so they get an anchor and a table-of-contents entry
- the table of contents is discarded and rebuilt last, from the headings that
  actually shipped, using the same anchor ids as `src/lib/blog-markdown.ts`
- asset paths are copied verbatim into the prompt and repaired on the way out
  (`//assets/…`, `./assets/…`, unsubstituted placeholder tokens)
- a missing cover or data image is injected rather than silently dropped
- leaked SEO / Open Graph / JSON-LD sections are stripped from the body — they
  belong in the front matter, which is generated separately
- duplicate FAQ blocks collapse to one `## FAQ`, which also becomes the
  `FAQPage` JSON-LD alongside `TechArticle`

Each article contains:

- YAML front matter
- SEO title and description
- canonical URL
- primary and secondary keyphrases
- technology tags
- Open Graph metadata
- `TechArticle` JSON-LD
- table of contents
- executive answer
- two or more data tables
- Markdown callout blocks
- Mermaid architecture/process diagram
- locally generated cover image
- locally generated evidence graphic
- decision/action checklist
- evidence and limitations section
- linked source list
- FAQ section

## Important publication rule

The script produces **draft-ready files**, but news and security content should pass a final editorial review before public release. Backdating a document does not make its claims historically accurate; the article should state when the underlying GitHub data was retrieved.

## Duplicate protection

At startup the engine seeds its dedup corpus from articles that already exist
on disk — the committed site content (`../src/content/blog`, override with
`SITE_BLOG_DIR`) and prior factory output (`output/articles`) — so a fresh
checkout or a deleted `content_factory.sqlite3` cannot regenerate
already-published articles or reuse their slugs.

The engine rejects:

- exact normalized-content duplicates
- duplicate normalized titles
- duplicate slugs
- articles exceeding the configured seven-word-shingle similarity threshold

Default threshold:

```bash
--max-similarity 0.16
```

## Continue a historical archive

Use the next unused publication date explicitly:

```bash
python content_factory.py \
  --count 50 \
  --start-date 2026-01-22 \
  --seed 43
```

Change the seed for each batch so the technology pairings and editorial plan vary.
