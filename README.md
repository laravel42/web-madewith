# MadeWith… — a replicable multi-domain showcase catalog

A network of "Made with [Tech]" showcase sites — one catalog engine, themed per
domain, fed by **real GitHub data**. Each site is a daily-updatable gallery of
the best open-source projects for a technology, ranked by stars, built for SEO
and traffic. Cloning a site to a new domain is a **one-config-entry** change.

Built with [Astro](https://astro.build) (static output, zero client JS except a
tiny catalog-filter script). Implemented from the Claude Design handoff in
[`chats/`](./chats) and [`project/`](./project).

## The six sites

| Domain | Slug | Accent | Identity |
| --- | --- | --- | --- |
| madewithnuxt.com | `nuxt` | green | Sora display, aurora-glow hero + floating browser mockup, rounded cards |
| madewithnode.com | `node` | green | terminal: JetBrains Mono, dark, `$` prompt, `#tag` filters, `~/author/repo` cards |
| madewithnext.com | `next` | black | editorial masthead, oversized Bricolage headline, ranked borderless grid |
| madewithionic.com | `ionic` | blue | Poppins, iOS phone mockup hero, pill controls, extra-rounded cards |
| madewithstatamic.com | `statamic` | violet | Instrument Serif, dark-violet luxe hero band |
| madewithtwill.com | `twill` | coral | Newsreader serif, cream paper, masthead rule |

Every site has the same four screens: **home gallery** (search + sort + tag
filter), **project detail**, **category browse**, and **submit**.

Locally the whole network builds under one site so it's browsable at once:
`/` is the network index, and each domain lives at `/<slug>/…`. In production
each entry maps to its own domain.

## Quick start

```bash
npm install
npm run scrape      # pull fresh data from GitHub into src/data/*.json
npm run dev         # http://localhost:4321
npm run build       # static site → dist/
```

`npm run scrape` works without credentials, but a token is strongly recommended.

If a domain fails mid-scrape (rate limit, network), it keeps the last-good
`src/data/<slug>.json` — or falls back to the committed snapshots in
`scripts/seed/` — so `npm run build` never breaks.

### Beating GitHub's rate limits

The scraper is built to stay well under GitHub's limits, three ways:

1. **Authenticate.** A token lifts you from 60 → 5,000 requests/hr (and search
   10 → 30/min). Just set it:
   ```bash
   cp .env.example .env   # add GITHUB_TOKEN, then:
   GITHUB_TOKEN=xxxx npm run scrape
   ```
2. **GraphQL (automatic with a token).** One request returns a domain's repos
   *and* their real language breakdowns, so the whole 6-site network refreshes
   in **~6 requests** (vs ~78 REST calls). Anonymous falls back to REST search
   and synthesises languages from the primary language.
3. **Self-healing throttle + ETag cache.** The client honours
   `x-ratelimit-remaining`/`reset` (pre-emptive wait), backs off on
   secondary-limit `403/429`, and sends `If-None-Match` so unchanged endpoints
   return a **free `304`** that costs no quota (`scripts/.cache/etags.json`).

### Scheduled refresh (the traffic hook)

`.github/workflows/refresh-data.yml` runs the scraper **daily** (and on demand),
commits any changed `src/data/*.json`, and re-builds. It uses the Actions
built-in `GITHUB_TOKEN`, which enables the GraphQL path automatically — no
secret to configure, and a full refresh (~6 requests) never nears the limit.

## Architecture

```
src/
  config/
    domains.ts        ← the whole per-domain theme model (colour, fonts, hero, chrome, SEO)
    categories.ts     ← the six shared catalog categories
  data/*.json         ← scraped GitHub data, one file per domain (generated)
  lib/catalog.ts      ← load + rank + filter/relate helpers (build-time)
  layouts/CatalogLayout.astro   ← <head>, SEO/OG, fonts, global themed CSS (CSS vars per domain)
  components/
    Header / Footer               ← 3 chrome variants (minimal · editorial · terminal)
    Hero.astro + heroes/*         ← one bespoke hero per domain
    ProjectGrid / ProjectCard     ← 3 card systems; client filter/sort script lives here
    CategoryBrowse / ProjectDetail / SubmitForm
    TagRow.astro
  pages/
    index.astro                   ← network landing
    [domain]/index.astro          ← home
    [domain]/categories.astro
    [domain]/submit.astro
    [domain]/project/[slug].astro
scripts/
  scrape.mjs          ← GitHub scraper (search → classify → normalise → write)
  seed/*.json         ← committed fallback snapshots
```

The **home gallery is interactive without a framework**: SSR renders every card
sorted by stars, and one small script (`ProjectGrid.astro`) wires the hero's
search box, sort toggle and tag pills to show/hide/reorder cards via `data-*`
hooks. Category cards deep-link to `/<slug>/?tag=Category`, which the script
reads on load. This keeps every project URL crawlable for SEO.

## Adding a new domain (the replication workflow)

1. Add one entry to `DOMAINS` in `src/config/domains.ts` (name, accent, fonts,
   hero id, chrome, SEO copy). Reuse an existing `heroId`/`variant` or add a
   bespoke hero in `src/components/heroes/`.
2. Add the domain's GitHub query to `DOMAINS` in `scripts/scrape.mjs`.
3. `npm run scrape && npm run build`.

Colour, logo letter, shape language and data are all config — the engine is shared.

## Deploy (Cloudflare Pages)

The site is fully static, so Cloudflare Pages just serves `./dist` — no SSR
adapter or Worker runtime. Config lives in `wrangler.jsonc`
(project `madewith-catalog`) and `public/_headers` sets edge caching.

**Option A — from your machine (one-off):**

```bash
npx wrangler login          # opens Cloudflare auth in your browser
npm run deploy              # astro build && wrangler pages deploy
```

**Option B — CI on every push (recommended).** `.github/workflows/deploy.yml`
builds and deploys on push to `main`. Add two repository secrets first:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | a token with the **Cloudflare Pages → Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |

The deploy workflow also re-scrapes fresh GitHub data before building, so each
deploy ships the latest galleries.

**Custom domains.** In the Pages project, map each production domain
(`madewithnuxt.com`, `madewithnode.com`, …) and, if you want each to serve only
its own site at the root, add a redirect/route from `/` to `/<slug>/`. Update
`site` in `astro.config.mjs` to the canonical host so `sitemap`/canonical tags
match.

## SEO

Per-domain `<title>`, meta description, canonical, Open Graph + Twitter tags,
per-domain SVG favicons, `sitemap-index.xml` (via `@astrojs/sitemap`) and
`robots.txt`. Data is designed to refresh on a schedule (re-run `scrape` in CI)
so the galleries stay fresh — the traffic hook from the original brief.

## Data & attribution

All project data (names, stars, owners, avatars, descriptions, demo links,
topics, languages, licenses) is fetched live from the public GitHub API. The
long-form "about" copy on detail pages is composed from that real metadata.
`scrapedAt` is stamped into each dataset.
