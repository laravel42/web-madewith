var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/github.ts
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
var GitHubAuthError = class extends Error {
  static {
    __name(this, "GitHubAuthError");
  }
};
var GitHubQueryError = class extends Error {
  static {
    __name(this, "GitHubQueryError");
  }
};
var GitHubUnavailable = class extends Error {
  static {
    __name(this, "GitHubUnavailable");
  }
};
var GitHub = class {
  static {
    __name(this, "GitHub");
  }
  token;
  etags;
  log;
  maxAttempts;
  /** Rolling view of the primary rate-limit bucket for pre-emptive throttling. */
  lastRemaining = Infinity;
  lastReset = 0;
  constructor(opts) {
    this.token = opts.token;
    this.etags = opts.etags;
    this.log = opts.log ?? (() => {
    });
    this.maxAttempts = opts.maxAttempts ?? 5;
  }
  headers(extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": "madewith-scraper",
      Authorization: `Bearer ${this.token}`,
      ...extra
    };
  }
  /** Pre-emptively pause when the bucket is nearly empty. */
  async throttleIfLow() {
    if (this.lastRemaining <= 1 && this.lastReset) {
      const waitMs = Math.max(0, this.lastReset * 1e3 - Date.now()) + 1e3;
      if (waitMs > 0 && waitMs < 12e4) {
        this.log(`rate bucket empty; waiting ${Math.ceil(waitMs / 1e3)}s`);
        await sleep(waitMs);
      }
    }
  }
  track(res) {
    const rem = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(rem)) this.lastRemaining = rem;
    if (Number.isFinite(reset)) this.lastReset = reset;
  }
  /** REST GET with ETag conditional requests. `cacheKey` enables 304 caching. */
  async rest(url, cacheKey) {
    for (let attempt = 0; ; attempt++) {
      await this.throttleIfLow();
      const cached = cacheKey && this.etags ? await this.etags.get(cacheKey) : null;
      const res = await fetch(url, {
        headers: this.headers(cached ? { "If-None-Match": cached.etag } : {})
      });
      this.track(res);
      if (res.status === 304 && cached) return { data: JSON.parse(cached.body), notModified: true };
      if (res.status === 401) throw new GitHubAuthError("GitHub 401 \u2014 check the token");
      if (res.status === 404) throw new GitHubUnavailable(url);
      if (res.status === 422) throw new GitHubQueryError(`invalid query: ${url}`);
      const isRateLimit = res.status === 429 || res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"));
      if ((isRateLimit || res.status >= 500) && attempt < this.maxAttempts) {
        await this.backoff(res, attempt);
        continue;
      }
      if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
      const body = await res.text();
      const etag = res.headers.get("etag");
      if (cacheKey && etag && this.etags) await this.etags.put(cacheKey, { etag, body });
      return { data: JSON.parse(body), notModified: false };
    }
  }
  /** GraphQL POST — one request can fetch repos + languages together. */
  async graphql(query, variables) {
    for (let attempt = 0; ; attempt++) {
      await this.throttleIfLow();
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables })
      });
      this.track(res);
      if (res.status === 401) throw new GitHubAuthError("GitHub 401 \u2014 check the token");
      const isRateLimit = res.status === 429 || res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"));
      if ((isRateLimit || res.status >= 500) && attempt < this.maxAttempts) {
        await this.backoff(res, attempt);
        continue;
      }
      if (!res.ok) throw new Error(`GitHub GraphQL ${res.status} ${res.statusText}`);
      const json3 = await res.json();
      if (json3.errors?.length) {
        if (json3.errors.some((e) => e.type === "RATE_LIMITED") && attempt < this.maxAttempts) {
          await this.backoff(res, attempt);
          continue;
        }
        throw new Error(`GraphQL: ${json3.errors.map((e) => e.message).join("; ")}`);
      }
      return json3.data;
    }
  }
  /** 403/429/5xx backoff: Retry-After → reset-wait → exponential. */
  async backoff(res, attempt) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    let waitMs;
    if (Number.isFinite(retryAfter)) waitMs = retryAfter * 1e3 + 500;
    else if (remaining === 0 && this.lastReset) waitMs = Math.max(0, this.lastReset * 1e3 - Date.now()) + 1e3;
    else waitMs = Math.min(3e4, 1e3 * 2 ** attempt);
    this.log(`${res.status}; backing off ${Math.ceil(waitMs / 1e3)}s (attempt ${attempt + 1})`);
    await sleep(Math.max(1e3, waitMs));
  }
};

// ../src/config/domain-catalog.json
var domain_catalog_default = [
  { slug: "nuxt", techName: "Nuxt", domain: "madewithnuxt.com", group: "frameworks", bespoke: true, scrape: { query: "topic:nuxt", minStars: 40, exclude: ["nuxt/nuxt", "nuxt/framework"] } },
  { slug: "node", techName: "Node", domain: "madewithnode.com", group: "backend", bespoke: true, scrape: { query: "topic:nodejs", minStars: 500, exclude: ["nodejs/node"] } },
  { slug: "next", techName: "Next.js", domain: "madewithnext.com", group: "frameworks", bespoke: true, scrape: { query: "topic:nextjs", minStars: 200, exclude: ["vercel/next.js"] } },
  { slug: "ionic", techName: "Ionic", domain: "madewithionic.com", group: "frontend", bespoke: true, scrape: { query: "topic:ionic", minStars: 20, exclude: ["ionic-team/ionic-framework", "ionic-team/ionic"] } },
  { slug: "statamic", techName: "Statamic", domain: "madewithstatamic.com", group: "cms", bespoke: true, scrape: { query: "topic:statamic", minStars: 3, exclude: ["statamic/cms", "statamic/statamic"] } },
  { slug: "twill", techName: "Twill", domain: "madewithtwill.com", group: "cms", bespoke: true, scrape: { query: "twill laravel cms", minStars: 0, exclude: ["area17/twill"] } },
  { slug: "react", techName: "React", domain: "madewithreact.com", group: "frontend", bespoke: false, scrape: { query: "topic:react", minStars: 100, exclude: ["facebook/react"] } },
  { slug: "vue", techName: "Vue.js", domain: "madewithvue.com", group: "frontend", bespoke: false, scrape: { query: "topic:vue", minStars: 50, exclude: ["vuejs/core", "vuejs/vue"] } },
  { slug: "angular", techName: "Angular", domain: "madewithangular.com", group: "frontend", bespoke: false, scrape: { query: "topic:angular", minStars: 50, exclude: ["angular/angular"] } },
  { slug: "svelte", techName: "Svelte", domain: "madewithsvelte.com", group: "frontend", bespoke: false, scrape: { query: "topic:svelte", minStars: 30, exclude: ["sveltejs/svelte"] } },
  { slug: "jquery", techName: "jQuery", domain: "madewithjquery.com", group: "frontend", bespoke: false, scrape: { query: "topic:jquery", minStars: 20, exclude: ["jquery/jquery"] } },
  { slug: "alpine", techName: "Alpine.js", domain: "madewithalpine.com", group: "frontend", bespoke: false, scrape: { query: "topic:alpinejs", minStars: 10, exclude: ["alpinejs/alpine"] } },
  { slug: "solidjs", techName: "SolidJS", domain: "madewithsolidjs.com", group: "frontend", bespoke: false, scrape: { query: "topic:solidjs", minStars: 20, exclude: ["solidjs/solid"] } },
  { slug: "astro", techName: "Astro", domain: "madewithastro.com", group: "frameworks", bespoke: false, scrape: { query: "topic:astro", minStars: 30, exclude: ["withastro/astro"] } },
  { slug: "sveltekit", techName: "SvelteKit", domain: "madewithsveltekit.com", group: "frameworks", bespoke: false, scrape: { query: "topic:sveltekit", minStars: 20, exclude: ["sveltejs/kit"] } },
  { slug: "laravel", techName: "Laravel", domain: "madewithlaravel.com", group: "frameworks", bespoke: false, scrape: { query: "topic:laravel", minStars: 50, exclude: ["laravel/laravel"] } },
  { slug: "symfony", techName: "Symfony", domain: "madewithsymfony.com", group: "frameworks", bespoke: false, scrape: { query: "topic:symfony", minStars: 20, exclude: ["symfony/symfony"] } },
  { slug: "django", techName: "Django", domain: "madewithdjango.com", group: "frameworks", bespoke: false, scrape: { query: "topic:django", minStars: 50, exclude: ["django/django"] } },
  { slug: "rails", techName: "Ruby on Rails", domain: "madewithrails.com", group: "frameworks", bespoke: false, scrape: { query: "topic:ruby-on-rails", minStars: 30, exclude: ["rails/rails"] } },
  { slug: "spring-boot", techName: "Spring Boot", domain: "madewithspringboot.com", group: "frameworks", bespoke: false, scrape: { query: "topic:spring-boot", minStars: 30, exclude: ["spring-projects/spring-boot"] } },
  { slug: "aspnet-core", techName: "ASP.NET Core", domain: "madewithaspnetcore.com", group: "frameworks", bespoke: false, scrape: { query: "topic:aspnet-core", minStars: 20, exclude: ["dotnet/aspnetcore"] } },
  { slug: "express", techName: "Express", domain: "madewithexpress.com", group: "backend", bespoke: false, scrape: { query: "topic:express", minStars: 50, exclude: ["expressjs/express"] } },
  { slug: "nestjs", techName: "NestJS", domain: "madewithnestjs.com", group: "backend", bespoke: false, scrape: { query: "topic:nestjs", minStars: 30, exclude: ["nestjs/nest"] } },
  { slug: "fastapi", techName: "FastAPI", domain: "madewithfastapi.com", group: "backend", bespoke: false, scrape: { query: "topic:fastapi", minStars: 30, exclude: ["tiangolo/fastapi"] } },
  { slug: "flask", techName: "Flask", domain: "madewithflask.com", group: "backend", bespoke: false, scrape: { query: "topic:flask", minStars: 30, exclude: ["pallets/flask"] } },
  { slug: "gin", techName: "Gin", domain: "madewithgin.com", group: "backend", bespoke: false, scrape: { query: "topic:gin", minStars: 20, exclude: ["gin-gonic/gin"] } },
  { slug: "fiber", techName: "Fiber", domain: "madewithfiber.com", group: "backend", bespoke: false, scrape: { query: "topic:fiber", minStars: 10, exclude: ["gofiber/fiber"] } },
  { slug: "python", techName: "Python", domain: "madewithpython.com", group: "backend", bespoke: false, scrape: { query: "topic:python", minStars: 100, exclude: ["python/cpython"] } },
  { slug: "wordpress", techName: "WordPress", domain: "madewithwordpress.com", group: "cms", bespoke: false, scrape: { query: "topic:wordpress", minStars: 20, exclude: ["WordPress/WordPress"] } },
  { slug: "drupal", techName: "Drupal", domain: "madewithdrupal.com", group: "cms", bespoke: false, scrape: { query: "topic:drupal", minStars: 10, exclude: ["drupal/drupal"] } },
  { slug: "joomla", techName: "Joomla", domain: "madewithjoomla.com", group: "cms", bespoke: false, scrape: { query: "topic:joomla", minStars: 5, exclude: ["joomla/joomla-cms"] } },
  { slug: "octobercms", techName: "OctoberCMS", domain: "madewithoctobercms.com", group: "cms", bespoke: false, scrape: { query: "topic:octobercms", minStars: 5, exclude: ["octobercms/october"] } },
  { slug: "strapi", techName: "Strapi", domain: "madewithstrapi.com", group: "cms", bespoke: false, scrape: { query: "topic:strapi", minStars: 20, exclude: ["strapi/strapi"] } },
  { slug: "directus", techName: "Directus", domain: "madewithdirectus.com", group: "cms", bespoke: false, scrape: { query: "topic:directus", minStars: 10, exclude: ["directus/directus"] } },
  { slug: "payload", techName: "Payload CMS", domain: "madewithpayload.com", group: "cms", bespoke: false, scrape: { query: "topic:payloadcms", minStars: 10, exclude: ["payloadcms/payload"] } },
  { slug: "magento", techName: "Magento", domain: "madewithmagento.com", group: "commerce", bespoke: false, scrape: { query: "topic:magento", minStars: 10, exclude: ["magento/magento2"] } },
  { slug: "prestashop", techName: "PrestaShop", domain: "madewithprestashop.com", group: "commerce", bespoke: false, scrape: { query: "topic:prestashop", minStars: 5, exclude: ["PrestaShop/PrestaShop"] } },
  { slug: "woocommerce", techName: "WooCommerce", domain: "madewithwoocommerce.com", group: "commerce", bespoke: false, scrape: { query: "topic:woocommerce", minStars: 10, exclude: ["woocommerce/woocommerce"] } },
  { slug: "bagisto", techName: "Bagisto", domain: "madewithbagisto.com", group: "commerce", bespoke: false, scrape: { query: "bagisto", minStars: 5, exclude: ["bagisto/bagisto"] } },
  { slug: "shopify", techName: "Shopify", domain: "madewithshopify.com", group: "commerce", bespoke: false, scrape: { query: "topic:shopify", minStars: 20, exclude: ["Shopify/liquid", "Shopify/dawn"] } }
];

// src/domains.ts
var STAR_PARTITIONS = [
  [1e3, null],
  [100, 999],
  [20, 99]
];
var DEFAULT_KEEP = 100;
var DOMAINS = domain_catalog_default.map((d) => ({
  slug: d.slug,
  techName: d.techName,
  match: d.scrape.query,
  exclude: d.scrape.exclude,
  keep: DEFAULT_KEEP
}));
var DOMAIN_SLUGS = DOMAINS.map((d) => d.slug);
var getDomain = /* @__PURE__ */ __name((slug) => DOMAINS.find((d) => d.slug === slug), "getDomain");

// src/db.ts
var Db = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  static {
    __name(this, "Db");
  }
  // ---- submissions ----
  async insertSubmission(s) {
    const r = await this.d1.prepare(`INSERT INTO submissions (slug, repo_url, name, description, category, demo_url, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`).bind(s.slug, s.repo_url, s.name, s.description, s.category, s.demo_url, s.created_at).run();
    return r.meta.last_row_id;
  }
  async listSubmissions(status) {
    const q = status ? this.d1.prepare(`SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT 500`).bind(status) : this.d1.prepare(`SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500`);
    return (await q.all()).results ?? [];
  }
  async getSubmission(id) {
    return await this.d1.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(id).first() ?? null;
  }
  async decideSubmission(id, status, by, note, at) {
    await this.d1.prepare(`UPDATE submissions SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?`).bind(status, by, note, at, id).run();
  }
  async countPending() {
    const r = await this.d1.prepare(`SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'`).first();
    return r?.n ?? 0;
  }
  // ---- approved entries ----
  async upsertApproved(slug, project, at) {
    await this.d1.prepare(`INSERT INTO approved_entries (slug, github_id, data, created_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(slug, github_id) DO UPDATE SET data = excluded.data`).bind(slug, project.githubId, JSON.stringify(project), at).run();
  }
  async approvedFor(slug) {
    const rows = (await this.d1.prepare(`SELECT data FROM approved_entries WHERE slug = ?`).bind(slug).all()).results ?? [];
    return rows.map((r) => JSON.parse(r.data));
  }
  // ---- overrides ----
  async overridesFor(slug) {
    const rows = (await this.d1.prepare(`SELECT * FROM entry_overrides WHERE slug = ?`).bind(slug).all()).results ?? [];
    return rows.map(rowToOverride);
  }
  async upsertOverride(o) {
    await this.d1.prepare(`INSERT INTO entry_overrides (slug, github_id, hidden, featured, name, description, category, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug, github_id) DO UPDATE SET
                  hidden=excluded.hidden, featured=excluded.featured, name=excluded.name,
                  description=excluded.description, category=excluded.category,
                  updated_at=excluded.updated_at, updated_by=excluded.updated_by`).bind(o.slug, o.github_id, o.hidden ? 1 : 0, o.featured ? 1 : 0, o.name, o.description, o.category, o.updated_at, o.updated_by).run();
  }
  // ---- domain page settings ----
  async getDomainSettings(slug) {
    const row = await this.d1.prepare(`SELECT data FROM domain_settings WHERE slug = ?`).bind(slug).first();
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }
  async upsertDomainSettings(slug, data, by, at) {
    await this.d1.prepare(`INSERT INTO domain_settings (slug, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(slug, JSON.stringify(data), at, by).run();
  }
  async listDomainSettings() {
    const rows = (await this.d1.prepare(`SELECT slug, data FROM domain_settings`).all()).results ?? [];
    return rows.map((r) => ({ slug: r.slug, data: JSON.parse(r.data) }));
  }
};
function rowToOverride(r) {
  return {
    slug: r.slug,
    github_id: r.github_id,
    hidden: !!r.hidden,
    featured: !!r.featured,
    name: r.name ?? null,
    description: r.description ?? null,
    category: r.category ?? null,
    updated_at: r.updated_at ?? null,
    updated_by: r.updated_by ?? null
  };
}
__name(rowToOverride, "rowToOverride");

// ../src/config/categories.json
var categories_default = {
  categories: [
    {
      label: "E-commerce",
      blurb: "Storefronts, carts & checkout flows.",
      color: "#db2777",
      bg: "#fdf2f8",
      keywords: ["ecommerce", "e-commerce", "commerce", "shop", "store", "cart", "checkout", "stripe", "payment", "marketplace", "woocommerce", "shopify"]
    },
    {
      label: "Mobile",
      blurb: "Native, hybrid & cross-platform mobile apps.",
      color: "#0284c7",
      bg: "#f0f9ff",
      keywords: ["mobile", "react-native", "ios", "android", "flutter", "capacitor", "expo", "ionic", "pwa", "reactnative"]
    },
    {
      label: "AI & ML",
      blurb: "LLMs, agents, inference & machine learning.",
      color: "#9333ea",
      bg: "#faf5ff",
      keywords: ["ai", "llm", "machine-learning", "ml", "chatbot", "gpt", "openai", "agent", "agentic", "rag", "neural", "deep-learning", "langchain", "genai"]
    },
    {
      label: "Authentication",
      blurb: "Auth, identity, OAuth & access control.",
      color: "#dc2626",
      bg: "#fef2f2",
      keywords: ["authentication", "auth", "oauth", "oauth2", "jwt", "identity", "login", "sso", "session", "passkey", "oidc"]
    },
    {
      label: "SaaS",
      blurb: "Multi-tenant apps, billing & subscriptions.",
      color: "#4f46e5",
      bg: "#eef2ff",
      keywords: ["saas", "subscription", "billing", "multi-tenant", "multitenant", "stripe-billing", "recurring"]
    },
    {
      label: "Real-time",
      blurb: "WebSockets, chat, live sync & collaboration.",
      color: "#16a34a",
      bg: "#f0fdf4",
      keywords: ["websocket", "websockets", "realtime", "real-time", "chat", "collaboration", "live", "socket", "webrtc", "multiplayer"]
    },
    {
      label: "Dashboards",
      blurb: "Admin panels, analytics & internal tools.",
      color: "#6366f1",
      bg: "#eef2ff",
      keywords: ["dashboard", "admin", "analytics", "panel", "backoffice", "back-office", "metrics", "monitoring", "crm"]
    },
    {
      label: "Testing",
      blurb: "Unit, integration & end-to-end test tooling.",
      color: "#0d9488",
      bg: "#f0fdfa",
      keywords: ["testing", "test", "e2e", "jest", "playwright", "cypress", "vitest", "mocha", "selenium", "unit-test", "integration-test"]
    },
    {
      label: "APIs",
      blurb: "REST, GraphQL, gRPC & API clients.",
      color: "#e11d48",
      bg: "#fff1f2",
      keywords: ["graphql", "rest-api", "openapi", "swagger", "grpc", "trpc", "api-client", "postgrest", "api-gateway"]
    },
    {
      label: "Templates",
      blurb: "Starters, boilerplates & scaffolds.",
      color: "#475569",
      bg: "#f8fafc",
      keywords: ["starter", "boilerplate", "scaffold", "seed", "cookiecutter", "create-app", "starter-kit", "starterkit"]
    },
    {
      label: "Docs",
      blurb: "Documentation & knowledge bases.",
      color: "#7c3aed",
      bg: "#f5f3ff",
      keywords: ["docs", "documentation", "handbook", "knowledge", "wiki", "docsite"]
    },
    {
      label: "Blogs",
      blurb: "Content sites & publishing engines.",
      color: "#059669",
      bg: "#ecfdf5",
      keywords: ["blog", "cms", "content", "markdown", "mdx", "publishing", "newsletter", "portfolio", "headless-cms"]
    },
    {
      label: "UI Kits",
      blurb: "Component libraries & design systems.",
      color: "#0891b2",
      bg: "#ecfeff",
      keywords: ["ui", "component", "components", "design-system", "design", "kit", "tailwind", "css", "theme", "shadcn", "radix"]
    },
    {
      label: "DevTools",
      blurb: "CLIs, monitors & developer utilities.",
      color: "#d97706",
      bg: "#fffbeb",
      keywords: ["cli", "devtool", "developer", "tool", "tools", "lint", "build", "bundler", "framework", "plugin", "generator", "debugger", "formatter"]
    }
  ]
};

// src/classify.ts
var CATEGORIES = categories_default.categories.map((c) => c.label);
var RULES = categories_default.categories.map((c) => [c.label, c.keywords]);
function classify(input) {
  const hay = `${(input.topics || []).join(" ")} ${input.description || ""} ${input.name || ""}`.toLowerCase();
  for (const [cat, kws] of RULES) if (kws.some((k) => hay.includes(k))) return cat;
  return "DevTools";
}
__name(classify, "classify");

// src/score.ts
var DAY = 864e5;
function qualityScore(r, now) {
  const stars = Math.max(0, r.stars || 0);
  const popularity = Math.min(1, Math.log10(stars + 1) / Math.log10(2e5));
  const parsed = r.pushedAt ? Date.parse(r.pushedAt) : NaN;
  const ageDays = Number.isNaN(parsed) ? 3650 : Math.max(0, (now - parsed) / DAY);
  const recency = Math.max(0, 1 - ageDays / 365);
  const completeness = (r.hasHomepage ? 0.4 : 0) + (r.hasLicense ? 0.25 : 0) + (r.hasDescription ? 0.2 : 0) + Math.min(0.15, r.topicCount * 0.03);
  let score = 0.6 * popularity + 0.25 * recency + 0.15 * completeness;
  if (ageDays > 730) score -= 0.15;
  if (!r.hasDescription) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}
__name(qualityScore, "qualityScore");

// src/scrape.ts
var SEARCH = `
query($q: String!, $n: Int!) {
  search(query: $q, type: REPOSITORY, first: $n) {
    repositoryCount
    nodes { ... on Repository {
      databaseId name nameWithOwner description stargazerCount homepageUrl url
      isFork isArchived pushedAt
      owner { login avatarUrl }
      licenseInfo { spdxId }
      primaryLanguage { name }
      repositoryTopics(first: 12) { nodes { topic { name } } }
      languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name } } }
    } }
  }
}`;
function relativeTime(iso, now) {
  if (!iso) return "recently";
  const days = Math.max(0, Math.round((now - Date.parse(iso)) / 864e5));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.round(days / 365)} year${days < 730 ? "" : "s"} ago`;
}
__name(relativeTime, "relativeTime");
function stackFrom(node) {
  const skip = /* @__PURE__ */ new Set(["hacktoberfest", "javascript", "typescript"]);
  const pretty = { nextjs: "Next.js", nuxtjs: "Nuxt", nodejs: "Node", vuejs: "Vue", reactjs: "React", tailwindcss: "Tailwind CSS", graphql: "GraphQL" };
  const topics = node.repositoryTopics?.nodes?.map((t) => t.topic.name) ?? [];
  const chips = topics.filter((t) => !skip.has(t)).slice(0, 4).map((t) => pretty[t] || t.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
  const lang = node.primaryLanguage?.name;
  if (lang && !chips.some((c) => c.toLowerCase() === lang.toLowerCase())) chips.unshift(lang);
  return chips.slice(0, 5);
}
__name(stackFrom, "stackFrom");
function languages(node) {
  const total = node.languages?.totalSize || 0;
  let langs = (node.languages?.edges ?? []).map((e) => ({ name: e.node.name, pct: total ? Math.round(e.size / total * 100) : 0 })).slice(0, 3);
  if (!langs.length) {
    const l = node.primaryLanguage?.name || "JavaScript";
    return [{ name: l, pct: 72 }, { name: l === "TypeScript" ? "JavaScript" : "CSS", pct: 20 }, { name: "Other", pct: 8 }];
  }
  const drift = 100 - langs.reduce((s, l) => s + l.pct, 0);
  langs[0].pct += drift;
  return langs;
}
__name(languages, "languages");
function longCopy(node) {
  const desc = (node.description || "").trim().replace(/\s+/g, " ");
  const base = desc ? desc.endsWith(".") ? desc : desc + "." : "An open-source project built with a modern stack.";
  const topicPhrase = (node.repositoryTopics?.nodes ?? []).slice(0, 3).map((t) => t.topic.name).join(", ");
  return {
    long1: `${base} Maintained by ${node.owner.login} on GitHub, where it has earned ${node.stargazerCount.toLocaleString()} stars from the community.`,
    long2: topicPhrase ? `It's actively developed around ${topicPhrase}, and is a solid reference for anyone building with these tools.` : `It's actively developed and a solid reference for anyone building on this stack.`
  };
}
__name(longCopy, "longCopy");
function normalise(node, now) {
  const topics = node.repositoryTopics?.nodes?.map((t) => t.topic.name) ?? [];
  const { long1, long2 } = longCopy(node);
  return {
    githubId: node.databaseId,
    slug: node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || String(node.databaseId),
    name: node.name,
    fullName: node.nameWithOwner,
    category: classify({ topics, description: node.description, name: node.name }),
    stars: node.stargazerCount,
    author: node.owner.login,
    avatar: node.owner.avatarUrl,
    desc: (node.description || "A project worth exploring.").trim(),
    demo: node.homepageUrl && /^https?:\/\//.test(node.homepageUrl) ? node.homepageUrl : null,
    repoUrl: node.url,
    long1,
    long2,
    stack: stackFrom(node),
    updated: relativeTime(node.pushedAt, now),
    license: node.licenseInfo?.spdxId && node.licenseInfo.spdxId !== "NOASSERTION" ? node.licenseInfo.spdxId : "\u2014",
    langs: languages(node),
    topics,
    score: qualityScore({
      stars: node.stargazerCount,
      pushedAt: node.pushedAt,
      hasHomepage: !!node.homepageUrl,
      hasLicense: !!node.licenseInfo?.spdxId,
      topicCount: topics.length,
      hasDescription: !!node.description
    }, now)
  };
}
__name(normalise, "normalise");
function hardNoise(node, domain) {
  const excl = new Set(domain.exclude.map((s) => s.toLowerCase()));
  return node.isFork || node.isArchived || excl.has(node.nameWithOwner.toLowerCase()) || node.name.toLowerCase() === domain.slug;
}
__name(hardNoise, "hardNoise");
function softNoise(node) {
  return /^awesome[-_]/.test(node.name.toLowerCase()) || (node.repositoryTopics?.nodes?.some((t) => t.topic.name === "awesome-list") ?? false);
}
__name(softNoise, "softNoise");
async function scrapeDomain(gh, domain, now) {
  const byId = /* @__PURE__ */ new Map();
  let total = 0;
  try {
    const cnt = await gh.rest(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(domain.match)}&per_page=1`,
      `count:${domain.slug}`
    );
    total = cnt.data.total_count;
  } catch {
  }
  for (const [lo, hi] of STAR_PARTITIONS) {
    const stars = hi == null ? `stars:>=${lo}` : `stars:${lo}..${hi}`;
    const q = `${domain.match} ${stars} sort:stars-desc`;
    const { search } = await gh.graphql(SEARCH, { q, n: 100 });
    for (const node of search.nodes) if (node?.databaseId) byId.set(node.databaseId, node);
    const usable = [...byId.values()].filter((n) => !hardNoise(n, domain) && !softNoise(n)).length;
    if (usable >= domain.keep * 2) break;
  }
  const pool = [...byId.values()].filter((n) => !hardNoise(n, domain));
  let candidates = pool.filter((n) => !softNoise(n));
  if (candidates.length < 6) candidates = pool;
  const projects = candidates.map((n) => normalise(n, now)).sort((a, b) => b.score - a.score || b.stars - a.stars).slice(0, domain.keep);
  return {
    slug: domain.slug,
    scrapedAt: new Date(now).toISOString(),
    source: "github-graphql",
    totalRepos: total || candidates.length,
    projects
  };
}
__name(scrapeDomain, "scrapeDomain");
var REPO_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    databaseId name nameWithOwner description stargazerCount homepageUrl url
    isFork isArchived pushedAt
    owner { login avatarUrl }
    licenseInfo { spdxId }
    primaryLanguage { name }
    repositoryTopics(first: 12) { nodes { topic { name } } }
    languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name } } }
  }
}`;
async function scrapeRepo(gh, owner, name, now) {
  const d = await gh.graphql(REPO_QUERY, { owner, name });
  return d.repository ? normalise(d.repository, now) : null;
}
__name(scrapeRepo, "scrapeRepo");
function parseRepoUrl(url) {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], name: m[2] } : null;
}
__name(parseRepoUrl, "parseRepoUrl");

// src/merge.ts
function mergeDataset(raw, approved, overrides, keep) {
  const ov = new Map(overrides.map((o) => [o.github_id, o]));
  const byId = /* @__PURE__ */ new Map();
  for (const p of raw.projects) byId.set(p.githubId, p);
  for (const p of approved) byId.set(p.githubId, p);
  const projects = [];
  for (const p of byId.values()) {
    const o = ov.get(p.githubId);
    if (o?.hidden) continue;
    projects.push({
      ...p,
      name: o?.name || p.name,
      desc: o?.description || p.desc,
      category: o?.category || p.category,
      featured: !!o?.featured
    });
  }
  projects.sort((a, b) => Number(b.featured) - Number(a.featured) || b.score - a.score);
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured).slice(0, Math.max(0, keep - featured.length));
  return { ...raw, projects: [...featured, ...rest] };
}
__name(mergeDataset, "mergeDataset");

// src/storage.ts
function kvEtagStore(kv) {
  return {
    async get(key) {
      return await kv.get(`etag:${key}`, "json");
    },
    async put(key, value) {
      await kv.put(`etag:${key}`, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 30 });
    }
  };
}
__name(kvEtagStore, "kvEtagStore");
var PUBLISHED = /* @__PURE__ */ __name((slug) => `data/${slug}.json`, "PUBLISHED");
var CONFIG = /* @__PURE__ */ __name((slug) => `config/${slug}.json`, "CONFIG");
var RAW = /* @__PURE__ */ __name((slug) => `raw/${slug}.json`, "RAW");
var SNAPSHOT = /* @__PURE__ */ __name((slug, iso) => `snapshots/${slug}/${iso}.json`, "SNAPSHOT");
var JSON_META = { contentType: "application/json" };
async function writeRaw(r2, dataset) {
  await r2.put(RAW(dataset.slug), JSON.stringify(dataset), { httpMetadata: JSON_META });
}
__name(writeRaw, "writeRaw");
async function readRaw(r2, slug) {
  const obj = await r2.get(RAW(slug));
  return obj ? await obj.json() : null;
}
__name(readRaw, "readRaw");
async function writePublished(r2, dataset) {
  await r2.put(PUBLISHED(dataset.slug), JSON.stringify(dataset), { httpMetadata: JSON_META });
  const snapshot = {
    scrapedAt: dataset.scrapedAt,
    totalRepos: dataset.totalRepos,
    metrics: dataset.projects.map((p) => ({ githubId: p.githubId, stars: p.stars, score: p.score, featured: !!p.featured }))
  };
  await r2.put(SNAPSHOT(dataset.slug, dataset.scrapedAt), JSON.stringify(snapshot), { httpMetadata: JSON_META });
}
__name(writePublished, "writePublished");
async function readDataset(r2, slug) {
  const obj = await r2.get(PUBLISHED(slug));
  return obj ? obj.text() : null;
}
__name(readDataset, "readDataset");
async function writeDomainConfig(r2, slug, config) {
  await r2.put(CONFIG(slug), JSON.stringify(config), { httpMetadata: JSON_META });
}
__name(writeDomainConfig, "writeDomainConfig");
async function readDomainConfig(r2, slug) {
  const obj = await r2.get(CONFIG(slug));
  return obj ? obj.text() : null;
}
__name(readDomainConfig, "readDomainConfig");

// src/publish.ts
async function publishFromRaw(r2, db, slug, keep) {
  const raw = await readRaw(r2, slug);
  if (!raw) return null;
  const [approved, overrides] = await Promise.all([db.approvedFor(slug), db.overridesFor(slug)]);
  const merged = mergeDataset(raw, approved, overrides, keep);
  await writePublished(r2, merged);
  return merged;
}
__name(publishFromRaw, "publishFromRaw");
async function scrapeAndPublish(gh, r2, db, domain, now) {
  const raw = await scrapeDomain(gh, domain, now);
  await writeRaw(r2, raw);
  const [approved, overrides] = await Promise.all([db.approvedFor(domain.slug), db.overridesFor(domain.slug)]);
  const merged = mergeDataset(raw, approved, overrides, domain.keep);
  await writePublished(r2, merged);
  return merged;
}
__name(scrapeAndPublish, "scrapeAndPublish");

// src/access.ts
function b64urlToBytes(s) {
  const pad = s.length % 4 ? "=".repeat(4 - s.length % 4) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64urlToBytes, "b64urlToBytes");
function decodeJson(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}
__name(decodeJson, "decodeJson");
async function loadKeys(teamDomain, kv) {
  const cacheKey = `jwks:${teamDomain}`;
  const cached = await kv.get(cacheKey, "json");
  if (cached) return cached;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  try {
    await kv.put(cacheKey, JSON.stringify(keys), { expirationTtl: 3600 });
  } catch (e) {
    console.error(`JWKS cache write failed: ${e.message}`);
  }
  return keys;
}
__name(loadKeys, "loadKeys");
async function verifyAccess(req, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (env.ADMIN_DEV_BYPASS === "true" && (!team || !aud) && req.headers.get("x-admin-dev-bypass") === "1") {
    return { email: req.headers.get("x-admin-dev-email") || "dev@local", sub: "dev" };
  }
  if (!team || !aud) return null;
  const token = req.headers.get("cf-access-jwt-assertion") || cookie(req, "CF_Authorization");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  let keys;
  try {
    keys = await loadKeys(team, env.STATE);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return null;
  } catch {
    return null;
  }
  return { email: payload.email || "unknown", sub: payload.sub || "" };
}
__name(verifyAccess, "verifyAccess");
function cookie(req, name) {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
__name(cookie, "cookie");

// src/util.ts
var json = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra }
}), "json");
async function triggerDeploy(env) {
  if (!env.PAGES_DEPLOY_HOOK) return;
  try {
    await fetch(env.PAGES_DEPLOY_HOOK, { method: "POST" });
    console.log("triggered Pages deploy hook");
  } catch (e) {
    console.log(`deploy hook failed: ${e.message}`);
  }
}
__name(triggerDeploy, "triggerDeploy");

// src/domain-settings.ts
var BESPOKE_BASELINE = {
  nuxt: {
    eyebrow: "The Nuxt showcase",
    heroTitle: "Discover the best apps & sites built with Nuxt",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.",
    seoTitle: "Made with Nuxt \u2014 the showcase of apps & sites built with Nuxt",
    seoDescription: "A curated, daily-updated gallery of the best open-source projects built with Nuxt, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools."
  },
  node: {
    eyebrow: "// open-source projects indexed",
    heroTitle: "Real apps shipped with Node",
    tagline: "Indexed nightly from GitHub. Filter by category & stars \u2014 discover production repos worth reading.",
    seoTitle: "made-with-node \u2014 production apps & tools built with Node.js",
    seoDescription: "A nightly-indexed directory of real open-source projects built with Node.js, ranked by GitHub stars. Grep the ecosystem for dashboards, dev tools, UI kits and more."
  },
  next: {
    eyebrow: "The Next showcase",
    heroTitle: "The definitive index of Next.js sites & apps in production",
    heroHeadline: "MADE WITH<br>NEXT.JS",
    tagline: "The definitive index of sites & apps in production. {total} projects, ranked by GitHub stars and shipped weekly.",
    seoTitle: "Made with Next.js \u2014 the definitive index of Next.js sites & apps",
    seoDescription: "The definitive, ranked index of production sites and apps built with Next.js. Browse the editorial gallery of the highest-starred open-source Next.js projects on GitHub."
  },
  ionic: {
    eyebrow: "The Ionic showcase",
    heroTitle: "Discover the best apps built with Ionic",
    tagline: "A hand-curated, daily-updated gallery of open-source apps. Browse {total} repos, ranked by GitHub stars.",
    seoTitle: "Made with Ionic \u2014 the showcase of mobile apps built with Ionic",
    seoDescription: "A curated, daily-updated gallery of the best open-source mobile & web apps built with Ionic, ranked by GitHub stars. Discover UI kits, dev tools and production apps."
  },
  statamic: {
    eyebrow: "The Statamic showcase",
    heroTitle: "Discover the best sites built with Statamic",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars \u2014 and find your next stack.",
    seoTitle: "Made with Statamic \u2014 the showcase of sites built with Statamic",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and add-ons built with Statamic, ranked by GitHub stars. Discover CMS builds, UI kits and dev tools."
  },
  twill: {
    eyebrow: "The Twill showcase",
    heroTitle: "Discover the best sites built with Twill",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars \u2014 and find your next stack.",
    seoTitle: "Made with Twill \u2014 the showcase of sites built with Twill CMS",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and packages built with Twill, the Laravel CMS, ranked by GitHub stars. Discover CMS builds and dev tools."
  }
};
function genericBaseline(techName, domain) {
  return {
    eyebrow: `The ${techName} showcase`,
    heroTitle: `Discover the best projects built with ${techName}`,
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.",
    domain,
    pageUrl: `https://${domain}/`,
    seoTitle: `Made with ${techName} \u2014 the showcase of projects built with ${techName}`,
    seoDescription: `A curated, daily-updated gallery of the best open-source projects built with ${techName}, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.`
  };
}
__name(genericBaseline, "genericBaseline");
function baselineForSlug(slug) {
  const entry = domain_catalog_default.find((d) => d.slug === slug);
  if (!entry) throw new Error(`unknown slug: ${slug}`);
  const base = entry.bespoke && BESPOKE_BASELINE[slug] ? BESPOKE_BASELINE[slug] : genericBaseline(entry.techName, entry.domain);
  return {
    slug,
    techName: entry.techName,
    domain: entry.domain,
    pageUrl: `https://${entry.domain}/`,
    group: entry.group,
    visibleCategories: null,
    ...base
  };
}
__name(baselineForSlug, "baselineForSlug");
function mergeDomainSettings(baseline, override) {
  if (!override) return { ...baseline };
  const out = { ...baseline };
  for (const [k, v] of Object.entries(override)) {
    if (v !== void 0 && v !== null && v !== "") out[k] = v;
  }
  if (override.visibleCategories !== void 0) out.visibleCategories = override.visibleCategories;
  return out;
}
__name(mergeDomainSettings, "mergeDomainSettings");

// src/settings.ts
function has(v) {
  return typeof v === "string" && v.trim().length > 0;
}
__name(has, "has");
function preview(v) {
  if (!has(v)) return null;
  const s = String(v).trim();
  if (s.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return `${s.slice(0, 4)}\u2026${s.slice(-4)}`;
}
__name(preview, "preview");
function buildAdminSettings(env, identity) {
  const accessConfigured = has(env.ACCESS_TEAM_DOMAIN) && has(env.ACCESS_AUD);
  const devBypass = env.ADMIN_DEV_BYPASS === "true";
  const secrets = [
    {
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      scope: "worker-secret",
      configured: has(env.GITHUB_TOKEN),
      required: true,
      preview: preview(env.GITHUB_TOKEN),
      purpose: "Scrape GitHub for Refresh, submission approval, and cron runs.",
      configure: "Local: worker/.dev.vars \xB7 Production: wrangler secret put GITHUB_TOKEN"
    },
    {
      key: "REFRESH_SECRET",
      label: "Refresh secret",
      scope: "worker-secret",
      configured: has(env.REFRESH_SECRET),
      required: false,
      preview: preview(env.REFRESH_SECRET),
      purpose: "Gates legacy POST /refresh outside the admin UI.",
      configure: "Local: worker/.dev.vars \xB7 Production: wrangler secret put REFRESH_SECRET"
    },
    {
      key: "PAGES_DEPLOY_HOOK",
      label: "Pages deploy hook",
      scope: "worker-secret",
      configured: has(env.PAGES_DEPLOY_HOOK),
      required: false,
      preview: preview(env.PAGES_DEPLOY_HOOK),
      purpose: "Triggers a Cloudflare Pages rebuild after publish/refresh.",
      configure: "Production: wrangler secret put PAGES_DEPLOY_HOOK"
    }
  ];
  const vars = [
    {
      key: "ACCESS_TEAM_DOMAIN",
      label: "Access team domain",
      scope: "worker-var",
      configured: has(env.ACCESS_TEAM_DOMAIN),
      required: !devBypass,
      preview: has(env.ACCESS_TEAM_DOMAIN) ? String(env.ACCESS_TEAM_DOMAIN) : null,
      purpose: "Cloudflare Access JWKS issuer (yourteam.cloudflareaccess.com).",
      configure: "wrangler.jsonc vars or wrangler secret"
    },
    {
      key: "ACCESS_AUD",
      label: "Access AUD tag",
      scope: "worker-var",
      configured: has(env.ACCESS_AUD),
      required: !devBypass,
      preview: preview(env.ACCESS_AUD),
      purpose: "Audience tag for the /admin Access application.",
      configure: "wrangler.jsonc vars or dashboard"
    },
    {
      key: "ADMIN_DEV_BYPASS",
      label: "Admin dev bypass",
      scope: "worker-var",
      configured: devBypass,
      required: false,
      preview: devBypass ? "true" : null,
      purpose: "Local dev only \u2014 allows admin API without Access when true.",
      configure: "worker/.dev.vars (never enable in production)"
    }
  ];
  const bindings = [
    {
      key: "DATA",
      label: "R2 DATA bucket",
      scope: "binding",
      configured: !!env.DATA,
      required: true,
      preview: env.DATA ? "bound" : null,
      purpose: "Raw scrape, published datasets, domain config JSON.",
      configure: "worker/wrangler.jsonc \u2192 r2_buckets"
    },
    {
      key: "STATE",
      label: "KV STATE",
      scope: "binding",
      configured: !!env.STATE,
      required: true,
      preview: env.STATE ? "bound" : null,
      purpose: "GitHub ETag cache, JWKS cache, last-run metadata.",
      configure: "worker/wrangler.jsonc \u2192 kv_namespaces"
    },
    {
      key: "DB",
      label: "D1 admin database",
      scope: "binding",
      configured: !!env.DB,
      required: true,
      preview: env.DB ? "bound" : null,
      purpose: "Submissions, overrides, domain settings.",
      configure: "worker/wrangler.jsonc \u2192 d1_databases + migrations apply"
    }
  ];
  return {
    email: identity.email,
    access: {
      mode: accessConfigured ? "cloudflare-access" : devBypass ? "dev-bypass" : "misconfigured",
      teamDomain: has(env.ACCESS_TEAM_DOMAIN) ? String(env.ACCESS_TEAM_DOMAIN) : null,
      audConfigured: has(env.ACCESS_AUD)
    },
    scrape: { domainCount: DOMAINS.length, keepPerDomain: DEFAULT_KEEP },
    groups: [
      { title: "Worker secrets", parameters: secrets },
      { title: "Worker configuration", parameters: vars },
      { title: "Worker bindings", parameters: bindings }
    ]
  };
}
__name(buildAdminSettings, "buildAdminSettings");

// src/admin.ts
var ghClient = /* @__PURE__ */ __name((env) => new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: /* @__PURE__ */ __name((m) => console.log(m), "log") }), "ghClient");
async function galleryProjectCount(r2, slug) {
  const [pubText, raw] = await Promise.all([readDataset(r2, slug), readRaw(r2, slug)]);
  if (pubText) {
    try {
      const n = JSON.parse(pubText).projects?.length;
      if (typeof n === "number" && n > 0) return n;
    } catch {
    }
  }
  return raw?.projects?.length ?? 0;
}
__name(galleryProjectCount, "galleryProjectCount");
async function handleAdmin(req, env, path, ctx) {
  const identity = await verifyAccess(req, env);
  if (!identity) return json({ error: "unauthorized" }, 401);
  const db = new Db(env.DB);
  const url = new URL(req.url);
  const seg = path.replace(/^\/admin\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  if (seg[0] === "me") return json({ email: identity.email });
  if (seg[0] === "settings" && method === "GET") {
    return json(buildAdminSettings(env, identity));
  }
  if (seg[0] === "overview" && method === "GET") {
    const [lastRun, pending, domains] = await Promise.all([
      env.STATE.get("meta:lastRun", "json"),
      db.countPending(),
      Promise.all(DOMAINS.map(async (d) => {
        const [raw, pubText, published] = await Promise.all([
          readRaw(env.DATA, d.slug),
          readDataset(env.DATA, d.slug),
          galleryProjectCount(env.DATA, d.slug)
        ]);
        let pub = null;
        if (pubText) {
          try {
            pub = JSON.parse(pubText);
          } catch (e) {
            console.error(`bad published dataset for ${d.slug}: ${e.message}`);
          }
        }
        return { slug: d.slug, techName: d.techName, published, total: pub?.totalRepos ?? raw?.totalRepos ?? 0, scrapedAt: pub?.scrapedAt ?? raw?.scrapedAt ?? null, hasRaw: !!raw };
      }))
    ]);
    return json({ email: identity.email, pending, lastRun, domains });
  }
  if (seg[0] === "submissions") {
    if (method === "GET" && !seg[1]) return json({ submissions: await db.listSubmissions(url.searchParams.get("status") || void 0) });
    if (method === "POST" && seg[1]) {
      const sub = await db.getSubmission(Number(seg[1]));
      if (!sub) return json({ error: "not found" }, 404);
      const note = typeof body.note === "string" ? body.note.slice(0, 400) : null;
      if (body.action === "reject") {
        await db.decideSubmission(sub.id, "rejected", identity.email, note, nowIso);
        return json({ ok: true, status: "rejected" });
      }
      if (body.action === "approve") {
        const parsed = parseRepoUrl(sub.repo_url);
        if (!parsed) return json({ error: "invalid repo_url" }, 400);
        let project;
        try {
          project = await scrapeRepo(ghClient(env), parsed.owner, parsed.name, Date.now());
        } catch (err) {
          return json({ error: `GitHub scrape failed: ${err.message}` }, 502);
        }
        if (!project) return json({ error: "repo not found on GitHub" }, 404);
        if (sub.category) project.category = sub.category;
        await db.upsertApproved(sub.slug, project, nowIso);
        await db.decideSubmission(sub.id, "approved", identity.email, note, nowIso);
        const merged = await publishFromRaw(env.DATA, db, sub.slug, getDomain(sub.slug)?.keep ?? DEFAULT_KEEP);
        ctx.waitUntil(triggerDeploy(env));
        return json({ ok: true, status: "approved", published: merged?.projects.length ?? 0 });
      }
      return json({ error: "unknown action" }, 400);
    }
  }
  if (seg[0] === "domains") {
    if (method === "GET" && !seg[1]) {
      const overrides = await db.listDomainSettings();
      const ovMap = new Map(overrides.map((o) => [o.slug, o.data]));
      const domains = await Promise.all(DOMAINS.map(async (d) => {
        const baseline = baselineForSlug(d.slug);
        const merged = mergeDomainSettings(baseline, ovMap.get(d.slug) ?? null);
        const published = await galleryProjectCount(env.DATA, d.slug);
        return { slug: d.slug, techName: d.techName, group: merged.group ?? baseline.group, domain: merged.domain ?? baseline.domain, pageUrl: merged.pageUrl ?? baseline.pageUrl, published, hasOverrides: ovMap.has(d.slug) };
      }));
      return json({ domains });
    }
    if (seg[1]) {
      const slug = seg[1];
      const dcfg = getDomain(slug);
      if (!dcfg) return json({ error: "unknown domain" }, 404);
      if (method === "GET") {
        const baseline = baselineForSlug(slug);
        const override = await db.getDomainSettings(slug);
        const merged = mergeDomainSettings(baseline, override);
        const [raw, overrides, approved, pubText] = await Promise.all([
          readRaw(env.DATA, slug),
          db.overridesFor(slug),
          db.approvedFor(slug),
          readDataset(env.DATA, slug)
        ]);
        const ov = new Map(overrides.map((o) => [o.github_id, o]));
        const manualIds = new Set(approved.map((a) => a.githubId));
        const base = [...raw?.projects ?? [], ...approved];
        const seen = /* @__PURE__ */ new Set();
        const entries = base.filter((p) => seen.has(p.githubId) ? false : (seen.add(p.githubId), true)).map((p) => ({
          githubId: p.githubId,
          name: p.name,
          author: p.author,
          stars: p.stars,
          category: p.category,
          manual: manualIds.has(p.githubId),
          hidden: !!ov.get(p.githubId)?.hidden,
          featured: !!ov.get(p.githubId)?.featured
        }));
        let published = [];
        if (pubText) {
          try {
            published = JSON.parse(pubText).projects ?? [];
          } catch {
          }
        }
        const categoryCounts = {};
        for (const p of published.length ? published : base) {
          categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
        }
        return json({ slug, baseline, override, merged, entries, categoryCounts });
      }
      if (method === "POST") {
        const payload = {
          eyebrow: strOrNull(body.eyebrow),
          heroTitle: strOrNull(body.heroTitle),
          heroHeadline: strOrNull(body.heroHeadline),
          tagline: strOrNull(body.tagline),
          domain: strOrNull(body.domain),
          pageUrl: strOrNull(body.pageUrl),
          seoTitle: strOrNull(body.seoTitle),
          seoDescription: strOrNull(body.seoDescription),
          group: validGroup(body.group),
          visibleCategories: Array.isArray(body.visibleCategories) ? body.visibleCategories.map(String) : body.visibleCategories === null ? null : void 0
        };
        await db.upsertDomainSettings(slug, payload, identity.email, nowIso);
        const baseline = baselineForSlug(slug);
        const merged = mergeDomainSettings(baseline, payload);
        await writeDomainConfig(env.DATA, slug, { slug, ...merged, updatedAt: nowIso });
        ctx.waitUntil(triggerDeploy(env));
        return json({ ok: true, merged });
      }
    }
  }
  if (seg[0] === "entries" && seg[1]) {
    const slug = seg[1];
    const dcfg = getDomain(slug);
    if (!dcfg) return json({ error: "unknown domain" }, 404);
    if (method === "GET" && !seg[2]) {
      const [raw, overrides, approved] = await Promise.all([readRaw(env.DATA, slug), db.overridesFor(slug), db.approvedFor(slug)]);
      const ov = new Map(overrides.map((o) => [o.github_id, o]));
      const manualIds = new Set(approved.map((a) => a.githubId));
      const base = [...raw?.projects ?? [], ...approved];
      const seen = /* @__PURE__ */ new Set();
      const entries = base.filter((p) => seen.has(p.githubId) ? false : (seen.add(p.githubId), true)).map((p) => ({
        githubId: p.githubId,
        name: p.name,
        author: p.author,
        stars: p.stars,
        category: p.category,
        score: p.score,
        manual: manualIds.has(p.githubId),
        override: ov.get(p.githubId) ?? null
      }));
      return json({ slug, entries });
    }
    if (method === "POST" && seg[2]) {
      const o = {
        slug,
        github_id: Number(seg[2]),
        hidden: !!body.hidden,
        featured: !!body.featured,
        name: body.name || null,
        description: body.description || null,
        category: body.category || null,
        updated_at: nowIso,
        updated_by: identity.email
      };
      await db.upsertOverride(o);
      const merged = await publishFromRaw(env.DATA, db, slug, dcfg.keep);
      ctx.waitUntil(triggerDeploy(env));
      return json({ ok: true, published: merged?.projects.length ?? 0 });
    }
  }
  if ((seg[0] === "refresh" || seg[0] === "republish") && method === "POST") {
    const targets = body.slug ? DOMAINS.filter((d) => d.slug === body.slug) : DOMAINS;
    if (!targets.length) return json({ error: "unknown domain" }, 404);
    if (seg[0] === "refresh") {
      if (!env.GITHUB_TOKEN?.trim()) {
        return json({ error: "GITHUB_TOKEN is not configured on the worker", refreshed: [] }, 503);
      }
      const gh = ghClient(env);
      const results2 = [];
      const logs2 = [];
      for (const d of targets) {
        const started = Date.now();
        logs2.push(`[${d.slug}] scrape started`);
        try {
          const ds = await scrapeAndPublish(gh, env.DATA, db, d, Date.now());
          const ms = Date.now() - started;
          const line = `[${d.slug}] ok \u2014 ${ds.projects.length} projects, ecosystem ${ds.totalRepos} (${ms}ms)`;
          logs2.push(line);
          results2.push({ slug: d.slug, published: ds.projects.length, log: line });
        } catch (err) {
          const msg = err.message;
          console.error(`refresh failed for ${d.slug}: ${msg}`);
          logs2.push(`[${d.slug}] failed \u2014 ${msg}`);
          results2.push({ slug: d.slug, error: msg });
        }
      }
      if (targets.length > 1 || !body.slug) {
        await env.STATE.put("meta:lastRun", JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), summary: results2 }));
      }
      ctx.waitUntil(triggerDeploy(env));
      return json({ refreshed: results2, logs: logs2 });
    }
    const results = [];
    const logs = [];
    for (const d of targets) {
      logs.push(`[${d.slug}] republish started`);
      const merged = await publishFromRaw(env.DATA, db, d.slug, d.keep);
      if (!merged) {
        const msg = "no raw dataset \u2014 run Refresh (scrape) first";
        logs.push(`[${d.slug}] skipped \u2014 ${msg}`);
        results.push({ slug: d.slug, published: 0, error: msg });
        continue;
      }
      const line = `[${d.slug}] ok \u2014 ${merged.projects.length} projects`;
      logs.push(line);
      results.push({ slug: d.slug, published: merged.projects.length, log: line });
    }
    ctx.waitUntil(triggerDeploy(env));
    return json({ republished: results, logs });
  }
  return json({ error: "not found" }, 404);
}
__name(handleAdmin, "handleAdmin");
function strOrNull(v) {
  if (v === void 0 || v === null) return null;
  const s = String(v).trim();
  return s || null;
}
__name(strOrNull, "strOrNull");
var DOMAIN_GROUPS = ["frontend", "frameworks", "backend", "cms", "commerce"];
function validGroup(v) {
  if (v === void 0 || v === null || v === "") return void 0;
  const s = String(v);
  return DOMAIN_GROUPS.includes(s) ? s : void 0;
}
__name(validGroup, "validGroup");

// src/submit.ts
var GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i;
var cap = /* @__PURE__ */ __name((s, n) => typeof s === "string" ? s.trim().slice(0, n) : "", "cap");
function validateSubmission(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid body" };
  const slug = cap(body.slug, 40).toLowerCase();
  if (!DOMAIN_SLUGS.includes(slug)) return { ok: false, error: "unknown domain" };
  const repo_url = cap(body.repo_url, 200);
  if (!GITHUB_REPO.test(repo_url)) return { ok: false, error: "repo_url must be a https://github.com/owner/repo URL" };
  const name = cap(body.name, 100);
  if (!name) return { ok: false, error: "name is required" };
  const category = body.category ? cap(body.category, 40) : null;
  if (category && !CATEGORIES.includes(category)) return { ok: false, error: "unknown category" };
  const demo_url = body.demo_url ? cap(body.demo_url, 200) : null;
  if (demo_url && !/^https?:\/\//i.test(demo_url)) return { ok: false, error: "demo_url must be http(s)" };
  return { ok: true, value: { slug, repo_url, name, description: cap(body.description, 400) || null, category, demo_url } };
}
__name(validateSubmission, "validateSubmission");
async function rateLimited(kv, ip, day, limit = 20) {
  const key = `submitcount:${ip}:${day}`;
  const n = Number(await kv.get(key) || "0");
  if (n >= limit) return true;
  await kv.put(key, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  return false;
}
__name(rateLimited, "rateLimited");
async function handleSubmit(req, db, kv, nowIso) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json2({ error: "invalid JSON" }, 400);
  }
  const v = validateSubmission(body);
  if (!v.ok) return json2({ error: v.error }, 400);
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  const day = nowIso.slice(0, 10);
  if (await rateLimited(kv, ip, day)) return json2({ error: "rate limit \u2014 try again tomorrow" }, 429);
  const id = await db.insertSubmission({ ...v.value, created_at: nowIso });
  return json2({ ok: true, id, status: "pending" }, 201);
}
__name(handleSubmit, "handleSubmit");
var json2 = /* @__PURE__ */ __name((b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }), "json");

// src/index.ts
async function refreshAll(env) {
  const gh = new GitHub({ token: env.GITHUB_TOKEN, etags: kvEtagStore(env.STATE), log: /* @__PURE__ */ __name((m) => console.log(m), "log") });
  const db = new Db(env.DB);
  const now = Date.now();
  const summary = [];
  for (const domain of DOMAINS) {
    try {
      const ds = await scrapeAndPublish(gh, env.DATA, db, domain, now);
      summary.push({ slug: domain.slug, published: ds.projects.length, total: ds.totalRepos });
    } catch (e) {
      console.error(`scheduled scrape failed for ${domain.slug}: ${e.message}`);
      summary.push({ slug: domain.slug, error: e.message });
    }
  }
  await env.STATE.put("meta:lastRun", JSON.stringify({ at: new Date(now).toISOString(), summary }));
  await triggerDeploy(env);
  return summary;
}
__name(refreshAll, "refreshAll");
function authorized(req, env) {
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || new URL(req.url).searchParams.get("key") || "";
  const expected = env.REFRESH_SECRET || "";
  if (!expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
__name(authorized, "authorized");
var src_default = {
  async scheduled(_e, env, ctx) {
    ctx.waitUntil(refreshAll(env).then((s) => console.log("refresh complete", JSON.stringify(s))).catch((e) => console.log(`refresh failed: ${e.message}`)));
  },
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, cf-access-jwt-assertion",
          "access-control-max-age": "86400"
        }
      });
    }
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/health") return json({ ok: true, domains: DOMAINS.map((d) => d.slug) });
    const dataMatch = path.match(/^\/data\/([a-z0-9-]+)\.json$/);
    if (dataMatch && req.method === "GET") {
      const bodyText = await readDataset(env.DATA, dataMatch[1]);
      if (!bodyText) return json({ error: "not found" }, 404);
      return new Response(bodyText, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300, s-maxage=3600", "access-control-allow-origin": "*" }
      });
    }
    const configMatch = path.match(/^\/config\/([a-z0-9-]+)\.json$/);
    if (configMatch && req.method === "GET") {
      const bodyText = await readDomainConfig(env.DATA, configMatch[1]);
      if (!bodyText) return json({ error: "not found" }, 404);
      return new Response(bodyText, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300, s-maxage=3600", "access-control-allow-origin": "*" }
      });
    }
    if (path === "/submit" && req.method === "POST") {
      return handleSubmit(req, new Db(env.DB), env.STATE, (/* @__PURE__ */ new Date()).toISOString());
    }
    if (path === "/admin/api" || path.startsWith("/admin/api/")) {
      return handleAdmin(req, env, path, ctx);
    }
    if (path === "/refresh" && req.method === "POST") {
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
      ctx.waitUntil(refreshAll(env).catch((e) => console.log(`bg refresh failed: ${e.message}`)));
      return json({ started: true, domains: DOMAINS.map((d) => d.slug) });
    }
    return json({ error: "not found" }, 404);
  }
};

// ../node_modules/.pnpm/wrangler@4.110.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/.pnpm/wrangler@4.110.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-7GTgnb/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/.pnpm/wrangler@4.110.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-7GTgnb/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
