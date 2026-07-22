import { blogTechFor } from "./blog-tech";
import { formatBlogDate } from "./blog-dates";
import { englishDisplayText } from "./preview-text";
import { readableOn, tint } from "../config/accessible-color";

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  date: string;
  updated: string;
  author: string;
  category: string;
  primaryTechnology: string;
  secondaryTechnology?: string;
  tags: string[];
  image?: string;
  readMin: number;
  body?: string;
  sourcePath?: string;
  canonical?: string;
  jsonLd?: string;
}

export const BLOG_CATEGORIES = ["All", "Tutorial", "Patterns", "Performance", "Guide", "AI / LLM", "Headless"] as const;

const BLOG_CATEGORY_COLOR: Record<(typeof BLOG_CATEGORIES)[number], { icon: string; color: string }> = {
  All: { icon: "◎", color: "#2F6FEB" },
  Tutorial: { icon: "▣", color: "#16A34A" },
  Patterns: { icon: "◈", color: "#7C3AED" },
  Performance: { icon: "△", color: "#EA7A2B" },
  Guide: { icon: "❯", color: "#0D9488" },
  "AI / LLM": { icon: "✦", color: "#6366F1" },
  Headless: { icon: "❏", color: "#C2612B" },
};

/**
 * `color` tints the pill background and border; `ink` is the label. The filter
 * pills draw the label on a 9% (inactive) or 18% (active) tint of the same hue,
 * where the raw colour sat around 3–4:1 — `ink` targets the 18% tint, the
 * darker of the two.
 */
export const BLOG_CATEGORY_META: Record<
  (typeof BLOG_CATEGORIES)[number],
  { icon: string; color: string; ink: string }
> = Object.fromEntries(
  Object.entries(BLOG_CATEGORY_COLOR).map(([label, v]) => [
    label,
    { ...v, ink: readableOn(v.color, tint(v.color, 18)) },
  ])
) as Record<(typeof BLOG_CATEGORIES)[number], { icon: string; color: string; ink: string }>;

/** Map factory editorial categories to blog index filter pills. */
const FACTORY_CATEGORY_MAP: Record<string, (typeof BLOG_CATEGORIES)[number]> = {
  Comparison: "Guide",
  "Ecosystem Guide": "Guide",
  "Release News": "Guide",
  "Security Alert": "Guide",
  "Stack Guide": "Tutorial",
  "Architecture Analysis": "Guide",
  "Repository Spotlight": "Guide",
  "Adoption Analysis": "Guide",
  "Migration Guide": "Guide",
  "Performance Checklist": "Performance",
};

function normalizeCategory(category: string, tags: string[]): string {
  const mapped = FACTORY_CATEGORY_MAP[category];
  if (mapped) return mapped;
  if ((BLOG_CATEGORIES as readonly string[]).includes(category)) return category;
  if (tags.some((tag) => tag === "AI / LLM")) return "AI / LLM";
  if (tags.some((tag) => /headless/i.test(tag))) return "Headless";
  if (/pattern/i.test(category)) return "Patterns";
  if (/performance/i.test(category)) return "Performance";
  if (/tutorial/i.test(category)) return "Tutorial";
  return "Guide";
}

const READ_MINUTES: Record<string, number> = {
  "Getting started with Laravel: a 2025 field guide": 6,
  "12 patterns for production-grade React apps": 9,
  "How one team cut Next.js build times by 60%": 5,
  "Structuring large Django projects that scale": 8,
  "Composables that keep Vue apps tidy": 6,
  "Running local LLMs with Ollama in production": 11,
  "A headless CMS workflow with Strapi + Next.js": 7,
  "The Symfony service container, demystified": 10,
  "Build a typed REST API with FastAPI": 7,
  "State patterns in Svelte 5 runes": 6,
  "Composing retrieval pipelines with LangChain": 12,
  "Scaling Shopware for Black Friday traffic": 9,
  "Islands architecture with Astro, explained": 6,
  "A modern block theme workflow in WordPress": 8,
};

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, unknown> = {};
  let currentKey = "";
  let listKey = "";

  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const listItem = trimmed.match(/^- (.+)$/);
    if (listItem && listKey) {
      const items = (data[listKey] as string[]) ?? [];
      items.push(parseYamlValue(listItem[1]));
      data[listKey] = items;
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;

    const [, key, value] = kv;
    if (!value) {
      listKey = key;
      data[key] = [];
      currentKey = key;
      continue;
    }

    listKey = "";
    currentKey = key;
    data[key] = parseYamlValue(value);
  }

  return { data, body: match[2].trim() };
}

function parseYamlValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function estimateReadMin(title: string, body: string): number {
  if (READ_MINUTES[title]) return READ_MINUTES[title];
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.round(words / 220));
}

function articleFromParsed(path: string, data: Record<string, unknown>, body: string): BlogArticle | null {
  const slug = String(data.slug ?? "").trim();
  const title = String(data.title ?? "").trim();
  if (!slug || !title) return null;

  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const date = String(data.date ?? data.publication_date ?? "").trim();
  const updated = String(data.updated ?? date).trim();

  return {
    slug,
    title,
    description: String(data.description ?? data.excerpt ?? "").trim(),
    excerpt: String(data.excerpt ?? data.description ?? "").trim(),
    date,
    updated,
    author: String(data.author ?? "MadeWithWhat Editorial Team").trim(),
    category: normalizeCategory(String(data.category ?? "Guide").trim(), tags),
    primaryTechnology: String(data.primaryTechnology ?? tags[0] ?? "Web").trim(),
    secondaryTechnology: data.secondaryTechnology ? String(data.secondaryTechnology) : undefined,
    tags,
    image: data.image ? String(data.image) : undefined,
    readMin: estimateReadMin(title, body),
    body: body || undefined,
    sourcePath: path,
    canonical: data.canonical ? String(data.canonical) : undefined,
    jsonLd: data.jsonLd ? String(data.jsonLd) : undefined,
  };
}

function loadFileArticles(): BlogArticle[] {
  const globs = [
    import.meta.glob<string>("../content/blog/**/*.md", { eager: true, query: "?raw", import: "default" }),
    import.meta.glob<string>("../../factory/output/articles/**/*.md", { eager: true, query: "?raw", import: "default" }),
  ];

  const articles: BlogArticle[] = [];
  for (const files of globs) {
    for (const [path, raw] of Object.entries(files)) {
      const { data, body } = parseFrontmatter(raw);
      const article = articleFromParsed(path, data, body);
      if (article) articles.push(article);
    }
  }

  const bySlug = new Map<string, BlogArticle>();
  for (const article of articles.sort((a, b) => a.sourcePath!.localeCompare(b.sourcePath!))) {
    bySlug.set(article.slug, article);
  }
  return [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

/** Seed posts from the blog design handoff — used until factory articles are synced. */
function seedArticles(): BlogArticle[] {
  const rows: Array<[string, string, string, string, string, string, string]> = [
    ["laravel-2025-field-guide", "Laravel", "Tutorial", "Getting started with Laravel: a 2025 field guide", "Set up a modern Laravel project from scratch — tooling, structure and your first deploy.", "Sarah Dev", "2025-03-04"],
    ["react-production-patterns", "React", "Patterns", "12 patterns for production-grade React apps", "Conventions for structuring, testing and scaling real React codebases without the churn.", "Lindsey Cole", "2025-02-18"],
    ["nextjs-build-performance", "Next.js", "Performance", "How one team cut Next.js build times by 60%", "A concrete walkthrough of the profiling and caching wins behind a much faster pipeline.", "Devhouse", "2025-01-27"],
    ["django-large-projects", "Django", "Guide", "Structuring large Django projects that scale", "Apps, services and settings layouts that keep a growing Django codebase maintainable.", "J. Kemp", "2025-01-15"],
    ["vue-composables", "Vue.js", "Tutorial", "Composables that keep Vue apps tidy", "Extract reusable logic with the Composition API — and know when a composable is overkill.", "Pixel", "2025-01-08"],
    ["ollama-production", "Ollama", "AI / LLM", "Running local LLMs with Ollama in production", "Model selection, GPU sizing and a caching layer for a self-hosted inference endpoint.", "Opsteam", "2024-12-19"],
    ["strapi-nextjs-headless", "Strapi", "Headless", "A headless CMS workflow with Strapi + Next.js", "Model content once, serve it everywhere — with preview, webhooks and typed responses.", "Writeonce", "2024-12-05"],
    ["symfony-service-container", "Symfony", "Guide", "The Symfony service container, demystified", "How autowiring really works, and how to lean on it without losing the plot.", "Buildco", "2024-11-22"],
    ["fastapi-typed-rest", "FastAPI", "Tutorial", "Build a typed REST API with FastAPI", "From path operations to dependency injection and automatic OpenAPI docs.", "Sarah Dev", "2024-11-09"],
    ["svelte5-runes", "Svelte", "Patterns", "State patterns in Svelte 5 runes", "When to reach for $state, $derived and stores — with examples that scale.", "Lindsey Cole", "2024-10-28"],
    ["langchain-rag-pipelines", "LangChain", "AI / LLM", "Composing retrieval pipelines with LangChain", "Chains, retrievers and evaluators for a RAG app you can actually maintain.", "Opsteam", "2024-10-14"],
    ["shopware-black-friday", "Shopware", "Performance", "Scaling Shopware for Black Friday traffic", "Caching layers, queue tuning and the metrics that matter under real load.", "Shopkit", "2024-10-02"],
    ["astro-islands-architecture", "Astro", "Performance", "Islands architecture with Astro, explained", "Ship mostly-static pages and hydrate only what needs to be interactive.", "Pixel", "2024-09-20"],
    ["wordpress-block-themes", "WordPress", "Guide", "A modern block theme workflow in WordPress", "theme.json, patterns and full-site editing without fighting the platform.", "Writeonce", "2024-09-06"],
  ];

  return rows.map(([slug, tech, category, title, excerpt, author, date]) => ({
    slug,
    title,
    description: excerpt,
    excerpt,
    date,
    updated: date,
    author,
    category,
    primaryTechnology: tech,
    tags: [tech, category],
    readMin: READ_MINUTES[title] ?? 7,
  }));
}

let cache: BlogArticle[] | null = null;

export function getArticles(): BlogArticle[] {
  if (cache) return cache;
  const fileArticles = loadFileArticles();
  const seeds = seedArticles();
  const bySlug = new Map<string, BlogArticle>();
  for (const article of seeds) bySlug.set(article.slug, article);
  for (const article of fileArticles) bySlug.set(article.slug, { ...bySlug.get(article.slug), ...article });
  cache = [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  return cache;
}

export function getArticle(slug: string): BlogArticle | undefined {
  return getArticles().find((a) => a.slug === slug);
}

export { formatBlogDate, humanizeIsoTimestamps, parseBlogDate } from "./blog-dates";

export function articleHref(slug: string): string {
  return `/blog/${slug}/`;
}

function isTruncatedMetaDescription(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\b(and|or|for|to|with|a|an|the|in|on|of)\.$/i.test(trimmed)) return true;
  return trimmed.length > 120 && !/[.!?]["']?$/.test(trimmed);
}

/** Human-facing deck copy — prefers excerpt when SEO description is clipped. */
export function articleDeckDescription(article: Pick<BlogArticle, "excerpt" | "description" | "title">): string {
  const excerpt = englishDisplayText(article.excerpt, article.description, article.title);
  const description = englishDisplayText(article.description, article.excerpt, article.title);
  if (!excerpt) return description;
  if (!description) return excerpt;
  if (isTruncatedMetaDescription(description)) return excerpt;
  return excerpt.length >= description.length ? excerpt : description;
}

/** Card/list preview — full deck text, rendered unclamped. */
export function articleCardExcerpt(article: Pick<BlogArticle, "excerpt" | "description" | "title">): string {
  return articleDeckDescription(article);
}

export function articleCardMeta(article: BlogArticle) {
  const tech = blogTechFor(article.primaryTechnology);
  // White chips sit on the light end of the gradient, so it ends at `accentCover`.
  const coverStyle = article.image
    ? `height:150px; background:url(${article.image}) center/cover no-repeat; display:flex; align-items:flex-end; padding:13px; position:relative;`
    : `height:150px; background:linear-gradient(135deg, color-mix(in srgb, ${tech.accentCover} 80%, #000), ${tech.accentCover}); display:flex; align-items:flex-end; padding:13px; position:relative;`;
  return {
    ...article,
    title: englishDisplayText(article.title, article.excerpt, article.description),
    excerpt: articleCardExcerpt(article),
    description: englishDisplayText(article.description, article.excerpt, article.title),
    tech,
    href: articleHref(article.slug),
    dateLabel: formatBlogDate(article.date),
    authorInitial: article.author.charAt(0).toUpperCase(),
    coverStyle,
    tagChipStyle: "font-size:11px; font-weight:700; color:#fff; background:rgba(0,0,0,.24); padding:4px 10px; border-radius:20px;",
    avatarStyle: `width:24px; height:24px; border-radius:50%; background:${tech.accentSolid}; color:${tech.accentInk}; font-weight:700; font-size:11px; display:inline-flex; align-items:center; justify-content:center;`,
  };
}

/** Card fields for the blog index — excludes body/sourcePath so JSON can be embedded safely. */
export function articleIndexItem(article: BlogArticle) {
  const tech = blogTechFor(article.primaryTechnology);
  // White chips sit on the light end of the gradient, so it ends at `accentCover`.
  const coverStyle = article.image
    ? `height:150px; background:url(${article.image}) center/cover no-repeat; display:flex; align-items:flex-end; padding:13px; position:relative;`
    : `height:150px; background:linear-gradient(135deg, color-mix(in srgb, ${tech.accentCover} 80%, #000), ${tech.accentCover}); display:flex; align-items:flex-end; padding:13px; position:relative;`;
  return {
    slug: article.slug,
    title: englishDisplayText(article.title, article.excerpt, article.description),
    excerpt: articleCardExcerpt(article),
    category: article.category,
    primaryTechnology: article.primaryTechnology,
    author: article.author,
    date: article.date,
    readMin: article.readMin,
    image: article.image,
    tech,
    href: articleHref(article.slug),
    dateLabel: formatBlogDate(article.date),
    authorInitial: article.author.charAt(0).toUpperCase(),
    coverStyle,
    tagChipStyle: "font-size:11px; font-weight:700; color:#fff; background:rgba(0,0,0,.24); padding:4px 10px; border-radius:20px;",
    avatarStyle: `width:24px; height:24px; border-radius:50%; background:${tech.accentSolid}; color:${tech.accentInk}; font-weight:700; font-size:11px; display:inline-flex; align-items:center; justify-content:center;`,
  };
}

export function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function defaultArticleBody(techName: string): string {
  return [
    `${techName} has spent years smoothing the rough edges off everyday development, and the current release is the most approachable it has ever been. This guide walks the whole path — from an empty folder to a deployed app — and points out the conventions worth internalizing early.`,
    "",
    "## Setting up your environment",
    "",
    "You need a recent runtime, a package manager, and a database or store appropriate to your project. The fastest way to a clean slate is to scaffold a fresh workspace and start the dev server.",
    "",
    "```bash",
    `# scaffold a new ${techName} workspace`,
    "mkdir my-app && cd my-app",
    "# install dependencies, then start the dev server",
    "```",
    "",
    "Open the local URL and you'll see a working starter — no build pipeline to hand-configure and no boilerplate to delete before you begin.",
    "",
    "## A project structure that scales",
    "",
    `${techName} ships with an opinionated layout, and leaning into it saves you from bikeshedding. The folders you'll touch most often are routing, models or data access, handlers or controllers, and views or components.`,
    "",
    "As an app grows, resist the urge to invent new top-level folders. Push business logic into dedicated service or action classes so the entry points stay readable and your tests stay fast.",
    "",
    "## Conventions worth keeping",
    "",
    "Frameworks reward consistency. Name things predictably, keep side effects at the edges, and prefer the built-in solution before reaching for a dependency.",
    "",
    "> Treat migrations and schema changes as append-only. Once one ships to production, write a new change rather than editing history.",
    "",
    "## Testing as you go",
    "",
    `Write a test the moment a behavior matters. ${techName}'s testing helpers make it cheap to assert on real requests, so you can refactor with confidence instead of fear.`,
    "",
    "## Your first deploy",
    "",
    "For a first deploy, a managed platform removes the most friction: push your repository, set a few environment variables, and let it run any release steps for you.",
    "",
    "## Wrapping up",
    "",
    `You now have the shape of a real ${techName} app: a clear structure, sensible conventions, tests you trust, and a repeatable deploy. From here, explore the ecosystem's queues, events and tooling — that's where the framework really starts to pay off.`,
  ].join("\n");
}
