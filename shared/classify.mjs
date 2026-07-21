/**
 * Repository → catalog-category classifier (shared by the Worker and any
 * build-time tooling — single source of truth so implementations can't drift).
 *
 * Replaces the substring first-match classifier, whose failure modes are live
 * in the published data: "ai" matched inside "maintain"/"email"/"domain" and
 * "ml" inside "html" (which is how ~25–48% of repos landed in "AI & ML"),
 * "ui" matched inside "building", and one weak keyword outranked several
 * strong ones.
 *
 * This engine instead:
 *  - tokenizes on word boundaries (unigrams + hyphen-joined bi/trigram phrases,
 *    so "design system" and "static site generator" match as phrases);
 *  - scores every category from a weighted signal table, weighting by source
 *    (topic 1.5× > name 1.2× > description 1×), each term counted once at its
 *    strongest source;
 *  - suppresses double-counting: when a phrase matches ("shadcn-ui"), its
 *    component words ("shadcn", "ui") don't also score for the same category;
 *  - applies diminishing returns per category (1, 0.6, 0.36, …) so one
 *    definitive signal beats a pile of weak incidental ones;
 *  - treats styling-stack terms (tailwind, bootstrap, shadcn) as *support only*
 *    — they can't win UI Kits for an app that merely uses them for styling;
 *  - requires a minimum score to commit — weak single hits fall back to
 *    DevTools ("developer utilities", the honest catch-all for GitHub repos)
 *    instead of winning a category on noise;
 *  - reports a confidence so callers can route low-confidence repos to a
 *    smarter fallback (the Worker uses an optional Workers AI pass).
 *
 * The category set mirrors src/config/categories.json — a unit test asserts
 * the two stay in sync.
 */

export const CATEGORIES = [
  "E-commerce", "Mobile", "AI & ML", "Authentication", "SaaS", "Real-time",
  "Dashboards", "Testing", "APIs", "Templates", "Docs", "Blogs", "UI Kits", "DevTools",
];

export const DEFAULT_CATEGORY = "DevTools";

/** A category only wins outright when its score reaches this. */
const MIN_SCORE = 3;

/** Source multipliers — a GitHub topic is a deliberate label, a description word is incidental. */
const SRC_TOPIC = 1.5;
const SRC_NAME = 1.2;
const SRC_DESC = 1.0;

/**
 * Signal table: term → [category, weight]. Terms are lowercase unigrams or
 * hyphen-joined phrases (matched against topic strings, name tokens and
 * description uni/bi/trigrams). Weights: 4 = definitive, 3 = strong,
 * 2 = solid, ≤1.5 = weak supporting evidence only.
 *
 * Deliberately absent: framework/domain names (nuxt, ionic, laravel, react…)
 * — they appear on every repo of that domain and carry no category signal.
 */
const SIGNALS = {
  // ---- E-commerce ----
  "ecommerce": ["E-commerce", 4], "e-commerce": ["E-commerce", 4], "commerce": ["E-commerce", 4],
  "headless-commerce": ["E-commerce", 4], "storefront": ["E-commerce", 4], "shop": ["E-commerce", 3],
  "store": ["E-commerce", 2.5], "cart": ["E-commerce", 3], "checkout": ["E-commerce", 3],
  "payments": ["E-commerce", 3], "payment": ["E-commerce", 2.5], "stripe": ["E-commerce", 2],
  "marketplace": ["E-commerce", 3], "shopify": ["E-commerce", 3], "woocommerce": ["E-commerce", 4],
  "pos": ["E-commerce", 2],

  // ---- Mobile ----
  "mobile": ["Mobile", 3], "mobile-app": ["Mobile", 4], "react-native": ["Mobile", 3.5],
  "ios": ["Mobile", 2], "android": ["Mobile", 2], "ios-app": ["Mobile", 3.5],
  "android-app": ["Mobile", 3.5], "flutter": ["Mobile", 2.5], "capacitor": ["Mobile", 3],
  "cordova": ["Mobile", 3], "expo": ["Mobile", 3], "pwa": ["Mobile", 2],
  "cross-platform": ["Mobile", 1.5],

  // ---- AI & ML ----
  "ai": ["AI & ML", 2], "llm": ["AI & ML", 3], "llms": ["AI & ML", 3],
  "machine-learning": ["AI & ML", 3], "deep-learning": ["AI & ML", 3], "neural": ["AI & ML", 2.5],
  "gpt": ["AI & ML", 2.5], "chatgpt": ["AI & ML", 2.5], "openai": ["AI & ML", 2.5],
  "claude": ["AI & ML", 2.5], "gemini": ["AI & ML", 2], "ollama": ["AI & ML", 3],
  "agent": ["AI & ML", 2], "agents": ["AI & ML", 2], "agentic": ["AI & ML", 2.5],
  "ai-agent": ["AI & ML", 3], "ai-agents": ["AI & ML", 3], "rag": ["AI & ML", 3],
  "langchain": ["AI & ML", 3], "genai": ["AI & ML", 3], "generative-ai": ["AI & ML", 3],
  "inference": ["AI & ML", 2.5], "chatbot": ["AI & ML", 2.5], "assistant": ["AI & ML", 2],
  "embeddings": ["AI & ML", 2.5], "ml": ["AI & ML", 1.5], "nlp": ["AI & ML", 2.5],
  "computer-vision": ["AI & ML", 3], "stable-diffusion": ["AI & ML", 3],
  "transformers": ["AI & ML", 2.5], "prompt": ["AI & ML", 2], "prompts": ["AI & ML", 2],
  "copilot": ["AI & ML", 2.5], "text-to-speech": ["AI & ML", 3], "speech-recognition": ["AI & ML", 3],

  // ---- Authentication ----
  "auth": ["Authentication", 3], "authentication": ["Authentication", 3.5],
  "authorization": ["Authentication", 3], "oauth": ["Authentication", 3],
  "oauth2": ["Authentication", 3], "jwt": ["Authentication", 2.5], "sso": ["Authentication", 3],
  "identity": ["Authentication", 2.5], "login": ["Authentication", 2.5],
  "passkey": ["Authentication", 3], "passkeys": ["Authentication", 3], "oidc": ["Authentication", 3],
  "2fa": ["Authentication", 3], "mfa": ["Authentication", 3], "rbac": ["Authentication", 2.5],
  "access-control": ["Authentication", 3],
  // Low-weight phrase entries neutralize dependency topics: matching "next-auth"
  // suppresses its "auth" component word, so apps merely *using* an auth package
  // don't get filed under Authentication.
  "next-auth": ["Authentication", 1], "nextauth": ["Authentication", 1],

  // ---- SaaS ----
  "saas": ["SaaS", 3.5], "subscription": ["SaaS", 3], "subscriptions": ["SaaS", 3],
  "billing": ["SaaS", 3], "multi-tenant": ["SaaS", 3.5], "multitenant": ["SaaS", 3.5],
  "multi-tenancy": ["SaaS", 3.5], "invoicing": ["SaaS", 2.5], "invoice": ["SaaS", 2.5],
  "stripe-billing": ["SaaS", 4],

  // ---- Real-time ----
  "realtime": ["Real-time", 3], "real-time": ["Real-time", 3], "websocket": ["Real-time", 3],
  "websockets": ["Real-time", 3], "webrtc": ["Real-time", 3], "socket": ["Real-time", 2],
  "chat": ["Real-time", 2], "messaging": ["Real-time", 2.5], "collaboration": ["Real-time", 2.5],
  "collaborative": ["Real-time", 3], "presence": ["Real-time", 2.5], "pubsub": ["Real-time", 3],
  "sse": ["Real-time", 2.5], "live": ["Real-time", 1.5], "video-conference": ["Real-time", 3.5],
  "video-conferencing": ["Real-time", 3.5], "crdt": ["Real-time", 3],

  // ---- Dashboards ----
  "dashboard": ["Dashboards", 4], "dashboards": ["Dashboards", 4], "admin": ["Dashboards", 3],
  "admin-panel": ["Dashboards", 4], "admin-dashboard": ["Dashboards", 4], "analytics": ["Dashboards", 4],
  "metrics": ["Dashboards", 3], "backoffice": ["Dashboards", 3], "back-office": ["Dashboards", 3],
  "internal-tools": ["Dashboards", 3], "crm": ["Dashboards", 3], "erp": ["Dashboards", 3],
  "kanban": ["Dashboards", 3], "business-intelligence": ["Dashboards", 3], "reporting": ["Dashboards", 2.5],
  "charts": ["Dashboards", 2], "grafana": ["Dashboards", 2], "scheduling": ["Dashboards", 2],
  "booking": ["Dashboards", 2], "panel": ["Dashboards", 2], "self-hosted": ["Dashboards", 1],
  "web-analytics": ["Dashboards", 4], "project-management": ["Dashboards", 3],
  "issue-tracker": ["Dashboards", 3],

  // ---- Testing ----
  "testing": ["Testing", 2.5], "test": ["Testing", 1.5], "tests": ["Testing", 1.5],
  "test-runner": ["Testing", 3.5], "e2e": ["Testing", 3], "end-to-end": ["Testing", 2.5],
  "unit-testing": ["Testing", 3.5], "jest": ["Testing", 2.5], "mocha": ["Testing", 2.5],
  "cypress": ["Testing", 3], "playwright": ["Testing", 2.5], "vitest": ["Testing", 3],
  "assertion": ["Testing", 2.5], "mock": ["Testing", 2.5], "mocking": ["Testing", 3],
  "tdd": ["Testing", 3], "code-coverage": ["Testing", 3],

  // ---- APIs ----
  "api": ["APIs", 2], "apis": ["APIs", 2], "graphql": ["APIs", 2.5], "rest": ["APIs", 1.5],
  "rest-api": ["APIs", 3], "restful": ["APIs", 3], "openapi": ["APIs", 3.5],
  "swagger": ["APIs", 3.5], "grpc": ["APIs", 3], "trpc": ["APIs", 3],
  "api-gateway": ["APIs", 3.5], "api-client": ["APIs", 3], "webhooks": ["APIs", 2.5],
  "webhook": ["APIs", 2.5],

  // ---- Templates ----
  "starter": ["Templates", 3], "starter-kit": ["Templates", 4], "starter-template": ["Templates", 4],
  "boilerplate": ["Templates", 4], "template": ["Templates", 2], "templates": ["Templates", 2],
  "scaffold": ["Templates", 3], "scaffolding": ["Templates", 3], "starters": ["Templates", 3],

  // ---- Docs ----
  "documentation": ["Docs", 4], "docs": ["Docs", 3], "wiki": ["Docs", 3],
  "knowledge-base": ["Docs", 4], "knowledge": ["Docs", 2], "handbook": ["Docs", 3],
  "tutorial": ["Docs", 3], "tutorials": ["Docs", 3], "guide": ["Docs", 2], "guides": ["Docs", 2],
  "cheat-sheet": ["Docs", 4], "cheatsheet": ["Docs", 4], "best-practices": ["Docs", 3],
  "curriculum": ["Docs", 3], "education": ["Docs", 3], "certification": ["Docs", 2],
  "learn": ["Docs", 2], "learning": ["Docs", 2], "course": ["Docs", 2], "courses": ["Docs", 2],
  "interview": ["Docs", 2], "roadmap": ["Docs", 2], "concepts": ["Docs", 2],
  "examples": ["Docs", 1.5], "reference": ["Docs", 2], "mkdocs": ["Docs", 2],
  "mdbook": ["Docs", 1.5], "docusaurus": ["Docs", 3], "style-guide": ["Docs", 3],
  "styleguide": ["Docs", 3],

  // ---- Blogs (content sites & publishing engines) ----
  "blog": ["Blogs", 4], "blogs": ["Blogs", 3], "blogging": ["Blogs", 4],
  "cms": ["Blogs", 2], "headless-cms": ["Blogs", 2.5], "cms-framework": ["Blogs", 2],
  "content-management": ["Blogs", 3], "content-management-system": ["Blogs", 3],
  "publishing": ["Blogs", 3], "newsletter": ["Blogs", 3], "portfolio": ["Blogs", 3],
  "homepage": ["Blogs", 2], "website": ["Blogs", 1.5], "writing": ["Blogs", 2],
  "writings": ["Blogs", 2], "content": ["Blogs", 1.5], "editorial": ["Blogs", 2],
  "magazine": ["Blogs", 3], "journalism": ["Blogs", 3], "markdown": ["Blogs", 1.5],
  "mdx": ["Blogs", 1.5], "rss": ["Blogs", 2],

  // ---- UI Kits ----
  "component": ["UI Kits", 3], "components": ["UI Kits", 3], "component-library": ["UI Kits", 4],
  "ui": ["UI Kits", 2], "ui-library": ["UI Kits", 4], "ui-components": ["UI Kits", 4],
  "ui-kit": ["UI Kits", 4], "design-system": ["UI Kits", 4], "web-components": ["UI Kits", 3],
  "icons": ["UI Kits", 3], "icon": ["UI Kits", 2], "icon-pack": ["UI Kits", 4], "iconset": ["UI Kits", 3],
  "widgets": ["UI Kits", 3], "primitives": ["UI Kits", 3], "theme": ["UI Kits", 2], "themes": ["UI Kits", 2],
  "tailwind": ["UI Kits", 2], "tailwindcss": ["UI Kits", 2], "bootstrap": ["UI Kits", 2],
  "shadcn": ["UI Kits", 3], "shadcn-ui": ["UI Kits", 3], "css-framework": ["UI Kits", 3],
  "forms": ["UI Kits", 2.5], "dynamic-forms": ["UI Kits", 3], "page-builder": ["UI Kits", 3],
  "figma": ["UI Kits", 2], "storybook": ["UI Kits", 2], "animation": ["UI Kits", 1.5],
  "animations": ["UI Kits", 1.5], "design": ["UI Kits", 1],

  // ---- DevTools (CLIs, libraries, frameworks & developer utilities) ----
  "cli": ["DevTools", 4], "command-line": ["DevTools", 3], "command-line-tool": ["DevTools", 4],
  "sdk": ["DevTools", 3], "wrapper": ["DevTools", 3], "plugin": ["DevTools", 3],
  "plugins": ["DevTools", 2.5], "addon": ["DevTools", 3], "addons": ["DevTools", 2.5],
  "extension": ["DevTools", 2], "package": ["DevTools", 2], "library": ["DevTools", 2],
  "client": ["DevTools", 2], "client-library": ["DevTools", 3], "driver": ["DevTools", 3],
  "framework": ["DevTools", 2], "toolchain": ["DevTools", 3], "toolkit": ["DevTools", 2],
  "compiler": ["DevTools", 3], "bundler": ["DevTools", 3], "runtime": ["DevTools", 2],
  "database": ["DevTools", 3], "databases": ["DevTools", 2.5], "orm": ["DevTools", 3],
  "http": ["DevTools", 1.5], "http-client": ["DevTools", 3], "linter": ["DevTools", 3],
  "lint": ["DevTools", 2], "deploy": ["DevTools", 2], "deployment": ["DevTools", 3],
  "github-actions": ["DevTools", 3], "github-pages": ["DevTools", 2], "migration": ["DevTools", 2],
  "migrator": ["DevTools", 3], "generator": ["DevTools", 2], "static-site-generator": ["DevTools", 3],
  "devops": ["DevTools", 3], "docker": ["DevTools", 2], "container": ["DevTools", 2],
  "container-image": ["DevTools", 3], "kubernetes": ["DevTools", 2], "utility": ["DevTools", 3],
  "utilities": ["DevTools", 2.5], "tool": ["DevTools", 2], "tools": ["DevTools", 2],
  "tooling": ["DevTools", 2.5], "console": ["DevTools", 2], "terminal": ["DevTools", 2],
  "version-manager": ["DevTools", 3], "package-manager": ["DevTools", 3], "backend": ["DevTools", 2],
  "backend-as-a-service": ["DevTools", 3], "infrastructure": ["DevTools", 2], "paas": ["DevTools", 3],
  "firebase": ["DevTools", 2], "postgres": ["DevTools", 2.5], "postgresql": ["DevTools", 2.5],
  "mysql": ["DevTools", 2.5], "sqlite": ["DevTools", 2.5], "platform": ["DevTools", 1.5],
  "hosting": ["DevTools", 2], "monitor": ["DevTools", 3], "monitoring": ["DevTools", 3],
  "uptime": ["DevTools", 3], "logging": ["DevTools", 2], "scraper": ["DevTools", 2],
  "crawler": ["DevTools", 2], "automation": ["DevTools", 2], "visualization": ["DevTools", 2],
  "seo": ["DevTools", 2], "cache": ["DevTools", 2], "caching": ["DevTools", 2],
  "queue": ["DevTools", 2], "parser": ["DevTools", 2], "validation": ["DevTools", 2],
  "validator": ["DevTools", 2], "middleware": ["DevTools", 2], "microservices": ["DevTools", 1.5],
  "serverless": ["DevTools", 1.5], "encryption": ["DevTools", 2], "security": ["DevTools", 1.5],
  "cross-platform-desktop": ["DevTools", 3], "desktop": ["DevTools", 2], "electron": ["DevTools", 2],
  "installer": ["DevTools", 2.5], "server": ["DevTools", 1.5], "module": ["DevTools", 1.5],
  "integration": ["DevTools", 2], "npm": ["DevTools", 1.5], "eslint": ["DevTools", 1],
};

/** Map lookup — a plain-object lookup would hit Object.prototype members
 * ("constructor", "toString"…) when they appear as words in repo text. */
const SIGNAL_MAP = new Map(Object.entries(SIGNALS));

/**
 * Support-only terms: real evidence a repo *uses* a styling stack, but not that
 * it *is* a UI kit. They only count when the category also has a core match.
 */
const SUPPORT_ONLY = new Set(["tailwind", "tailwindcss", "bootstrap", "shadcn", "shadcn-ui", "figma", "storybook"]);

/** Diminishing returns: per-category contributions are weighted 1, DECAY, DECAY², … */
const DECAY = 0.6;

const WORD = /[a-z0-9]+/g;

/** words → the words plus hyphen-joined bigrams and trigrams ("static-site-generator"). */
function withPhrases(words) {
  const out = [...words];
  for (let i = 0; i < words.length - 1; i++) out.push(`${words[i]}-${words[i + 1]}`);
  for (let i = 0; i < words.length - 2; i++) out.push(`${words[i]}-${words[i + 1]}-${words[i + 2]}`);
  return out;
}

/** Build {term → sourceMultiplier} keeping the strongest source per term. */
function termSources({ name, description, topics }) {
  const sources = new Map();
  const add = (terms, mult) => {
    for (const t of terms) if ((sources.get(t) ?? 0) < mult) sources.set(t, mult);
  };
  // Description: unigrams + phrases.
  add(withPhrases(String(description || "").toLowerCase().match(WORD) ?? []), SRC_DESC);
  // Name: split into tokens + phrases ("eloquent-driver" → eloquent, driver, eloquent-driver).
  add(withPhrases(String(name || "").toLowerCase().match(WORD) ?? []), SRC_NAME);
  // Topics: the topic string itself is already hyphen-joined; also its words + phrases.
  for (const topic of topics || []) {
    const words = String(topic).toLowerCase().match(WORD) ?? [];
    add(withPhrases(words), SRC_TOPIC);
  }
  return sources;
}

/**
 * Classify a repo. Input: { name, description, topics }.
 * Returns { category, confidence (0..1), scores } — confidence < ~0.45 means
 * "weak evidence; a smarter fallback should double-check".
 */
export function classifyDetailed(input) {
  const sources = termSources(input);

  // Collect matches per category.
  const byCat = new Map(CATEGORIES.map((c) => [c, []]));
  for (const [term, mult] of sources) {
    const sig = SIGNAL_MAP.get(term);
    if (sig) byCat.get(sig[0]).push({ term, contribution: sig[1] * mult, words: term.split("-") });
  }

  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const [cat, matches] of byCat) {
    if (!matches.length) continue;

    // Phrase suppression: a unigram doesn't also score when it's a component
    // word of a matched phrase in the same category ("ui" ⊄ "shadcn-ui").
    const phraseWords = new Set(matches.filter((m) => m.words.length > 1).flatMap((m) => m.words));
    let kept = matches.filter((m) => m.words.length > 1 || !phraseWords.has(m.term));

    // Support-only terms need a core match to count at all.
    if (!kept.some((m) => !SUPPORT_ONLY.has(m.term))) continue;

    // Diminishing returns: strongest signal counts fully, the rest decay.
    kept.sort((a, b) => b.contribution - a.contribution);
    scores[cat] = kept.reduce((sum, m, i) => sum + m.contribution * DECAY ** i, 0);
  }

  const ranked = CATEGORIES.map((c) => [c, scores[c]]).sort((a, b) => b[1] - a[1]);
  const [topCat, top] = ranked[0];
  const second = ranked[1][1];

  if (top < MIN_SCORE) {
    // Not enough evidence for any category — default rather than guess on noise.
    return { category: DEFAULT_CATEGORY, confidence: top === 0 ? 0.1 : 0.25, scores };
  }

  // Confidence blends absolute strength with separation from the runner-up.
  const strength = Math.min(1, top / 8);
  const separation = top > 0 ? (top - second) / top : 0;
  const confidence = Math.min(0.98, Math.round((0.35 + 0.4 * strength + 0.25 * separation) * 100) / 100);
  return { category: topCat, confidence, scores };
}

/** Back-compat: just the category label. */
export function classify(input) {
  return classifyDetailed(input).category;
}

/** Callers route repos below this to the smarter (AI) fallback. */
export const LOW_CONFIDENCE = 0.45;
