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

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The script loads environment variables in this order:

1. `../.env`
2. `./.env`
3. dotenv's normal fallback search

## Preview the editorial schedule

This requires no API calls:

```bash
python content_factory.py --count 50 --dry-run
```

## Generate one complete 50-article batch

```bash
python content_factory.py \
  --count 50 \
  --seed 42 \
  --continue-on-error
```

## Generate a smaller test batch

```bash
python content_factory.py \
  --count 5 \
  --start-date 2026-01-12 \
  --continue-on-error
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
npm run hydrate-blog
```

This copies:

- `factory/output/articles/**` → `src/content/blog/**`
- `factory/output/assets/**` → `public/assets/**`

`hydrate-blog` runs automatically before `npm run dev` and `npm run build`.

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
  --seed 43 \
  --continue-on-error
```

Change the seed for each batch so the technology pairings and editorial plan vary.
