/**
 * Per-domain theme configuration — the whole "replicate per domain" model lives
 * here. Every MadeWithWhat site shares one engine (components, data pipeline, four
 * screens) and differs only by the tokens below: colour, logo letter, fonts,
 * shape language and a hero treatment. Cloning a domain = adding one entry.
 */

import catalog from "./domain-catalog.json";
import { readableOn, tint } from "./accessible-color";
import { applyEngineTokens } from "./engine-theme";
import type { HeroArch } from "./engine-theme";
import { applyThemeOverrides, getDomainSettings } from "./domain-settings";

export type Variant = "light" | "terminal";
export type HeroId = "nuxt" | "node" | "next" | "ionic" | "statamic" | "twill" | "generic";
export type { HeroArch };
export type DomainGroup = "frameworks" | "frontend" | "backend" | "cms-crm" | "commerce" | "ai-llm";
export type NetworkCardStyle = "default" | "tint" | "black" | "terminal";

export interface NetworkSiteMeta {
  accent: string;
  accentInk: string;
  card: NetworkCardStyle;
}

export interface Theme {
  slug: string;
  techName: string;
  domain: string;
  group: DomainGroup;
  accent: string;
  accentInk: string;
  variant: Variant;
  editorial: boolean;
  heroId: HeroId;
  /** Engine layout — band, browser, phone, terminal, or banner (editorial grid). */
  heroArch?: HeroArch;
  /**
   * True when the page shell is dark (terminal variants + Next's black editorial
   * shell). Components branch on this to pick the light- or dark-surface ink
   * instead of assuming a near-white page.
   */
  darkShell?: boolean;
  heroGradient?: string;
  heroMockHero?: string;
  heroBandDark?: boolean;
  heroBandBg?: string;
  heroSoftBorder?: string;
  /** Optional override; generic domains use /favicon.svg until bespoke assets ship. */
  favicon?: string;
  dispFont: string;
  bodyFont: string;
  fontHref: string;
  radius: number;
  bg: string;
  ink: string;
  headerBg: string;
  headerBorder: string;
  footerBg: string;
  footerBorder: string;
  eyebrow: string;
  heroTitle: string;
  heroHeadline?: string;
  chipAccent?: boolean;
  tagline: string;
  seoTitle: string;
  seoDescription: string;
  /** Set via admin domain settings (build-time from config/*.json). */
  pageUrl?: string;
  visibleCategories?: string[] | null;
}

export interface CatalogEntry {
  slug: string;
  techName: string;
  domain: string;
  group: DomainGroup;
  bespoke: boolean;
  scrape: { query: string; minStars: number; exclude: string[] };
}

export const DOMAIN_CATALOG = catalog as CatalogEntry[];

const FONTS = {
  nuxt: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap",
  node: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
  next: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=swap",
  ionic: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap",
  statamic: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap",
  twill: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700;6..72,800&display=swap",
  generic: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap",
};

/** Placeholder palette per group — swap for bespoke tokens when designs land. */
const GROUP_ACCENT: Record<DomainGroup, string> = {
  frameworks: "#16A34A",
  frontend: "#2F6FEB",
  backend: "#d97706",
  "cms-crm": "#7c3aed",
  commerce: "#b45309",
  "ai-llm": "#6366f1",
};

/** Per-tech accents & card variants for the network landing (design handoff). */
const NETWORK_CARD: Partial<Record<string, NetworkCardStyle>> = {
  express: "terminal",
  next: "black",
  ollama: "black",
};

const NETWORK_ACCENT: Partial<Record<string, { accent: string; accentInk: string }>> = {
  react: { accent: "#61DAFB", accentInk: "#04222c" },
  vue: { accent: "#4FC08D", accentInk: "#06231a" },
  angular: { accent: "#DD0031", accentInk: "#ffffff" },
  svelte: { accent: "#FF3E00", accentInk: "#ffffff" },
  jquery: { accent: "#0769AD", accentInk: "#ffffff" },
  alpine: { accent: "#77C1D2", accentInk: "#0a2233" },
  solidjs: { accent: "#2C4F7C", accentInk: "#ffffff" },
  next: { accent: "#000000", accentInk: "#ffffff" },
  nuxt: { accent: "#00DC82", accentInk: "#04231a" },
  astro: { accent: "#FF5D01", accentInk: "#ffffff" },
  sveltekit: { accent: "#FF3E00", accentInk: "#ffffff" },
  laravel: { accent: "#FF2D20", accentInk: "#ffffff" },
  symfony: { accent: "#1A171B", accentInk: "#ffffff" },
  django: { accent: "#0C4B33", accentInk: "#ffffff" },
  rails: { accent: "#D30001", accentInk: "#ffffff" },
  "spring-boot": { accent: "#6DB33F", accentInk: "#0a2109" },
  "aspnet-core": { accent: "#512BD4", accentInk: "#ffffff" },
  express: { accent: "#4B5563", accentInk: "#ffffff" },
  nestjs: { accent: "#E0234E", accentInk: "#ffffff" },
  fastapi: { accent: "#009688", accentInk: "#ffffff" },
  flask: { accent: "#111111", accentInk: "#ffffff" },
  gin: { accent: "#00ADD8", accentInk: "#04222c" },
  fiber: { accent: "#00ADD8", accentInk: "#04222c" },
  fastify: { accent: "#000000", accentInk: "#ffffff" },
  hono: { accent: "#E36002", accentInk: "#ffffff" },
  koa: { accent: "#33333D", accentInk: "#ffffff" },
  "actix-web": { accent: "#2E7D9A", accentInk: "#ffffff" },
  rocket: { accent: "#D33847", accentInk: "#ffffff" },
  phoenix: { accent: "#FD4F00", accentInk: "#ffffff" },
  preact: { accent: "#673AB8", accentInk: "#ffffff" },
  lit: { accent: "#324FFF", accentInk: "#ffffff" },
  qwik: { accent: "#18B6F6", accentInk: "#04222c" },
  ghost: { accent: "#15171A", accentInk: "#ffffff" },
  shopware: { accent: "#189EFF", accentInk: "#04222c" },
  saleor: { accent: "#06847B", accentInk: "#ffffff" },
  medusa: { accent: "#6D28D9", accentInk: "#ffffff" },
  opencart: { accent: "#23A1D4", accentInk: "#ffffff" },
  odoo: { accent: "#714B67", accentInk: "#ffffff" },
  erpnext: { accent: "#2490EF", accentInk: "#ffffff" },
  suitecrm: { accent: "#D65B27", accentInk: "#ffffff" },
  espocrm: { accent: "#1B4E6B", accentInk: "#ffffff" },
  dolibarr: { accent: "#2C5987", accentInk: "#ffffff" },
  "twenty-crm": { accent: "#1961ED", accentInk: "#ffffff" },
  vtiger: { accent: "#17A2B8", accentInk: "#04222c" },
  monica: { accent: "#EA6E4B", accentInk: "#ffffff" },
  ollama: { accent: "#000000", accentInk: "#ffffff" },
  langchain: { accent: "#199C82", accentInk: "#ffffff" },
  llamaindex: { accent: "#8A3FFC", accentInk: "#ffffff" },
  flowise: { accent: "#10B981", accentInk: "#04231a" },
  dify: { accent: "#1C64F2", accentInk: "#ffffff" },
  "open-webui": { accent: "#6366F1", accentInk: "#ffffff" },
  librechat: { accent: "#0EA5A4", accentInk: "#04231f" },
  anythingllm: { accent: "#36B37E", accentInk: "#04231a" },
  haystack: { accent: "#C6E42A", accentInk: "#1a2200" },
  vllm: { accent: "#5B8DEF", accentInk: "#ffffff" },
  ionic: { accent: "#3880FF", accentInk: "#ffffff" },
  twill: { accent: "#E4442B", accentInk: "#ffffff" },
  statamic: { accent: "#7C3AED", accentInk: "#ffffff" },
  wordpress: { accent: "#21759B", accentInk: "#ffffff" },
  drupal: { accent: "#0678BE", accentInk: "#ffffff" },
  joomla: { accent: "#5091CD", accentInk: "#ffffff" },
  octobercms: { accent: "#E63C2A", accentInk: "#ffffff" },
  strapi: { accent: "#4945FF", accentInk: "#ffffff" },
  directus: { accent: "#6644FF", accentInk: "#ffffff" },
  payload: { accent: "#000000", accentInk: "#ffffff" },
  magento: { accent: "#EC6737", accentInk: "#ffffff" },
  prestashop: { accent: "#DF0067", accentInk: "#ffffff" },
  woocommerce: { accent: "#7F54B3", accentInk: "#ffffff" },
  bagisto: { accent: "#0EA5E9", accentInk: "#04222c" },
};

export function networkMetaFor(theme: Theme): NetworkSiteMeta {
  const card = NETWORK_CARD[theme.slug] ?? (theme.variant === "terminal" ? "terminal" : "default");
  const accent = NETWORK_ACCENT[theme.slug]?.accent ?? theme.accent;
  const accentInk = NETWORK_ACCENT[theme.slug]?.accentInk ?? theme.accentInk;
  return { card, accent, accentInk };
}

function genericTheme(entry: CatalogEntry): Theme {
  const accent = GROUP_ACCENT[entry.group];
  return {
    slug: entry.slug,
    techName: entry.techName,
    domain: entry.domain,
    group: entry.group,
    accent,
    accentInk: "#ffffff",
    variant: "light",
    editorial: false,
    heroId: "generic",
    favicon: "/favicon.svg",
    dispFont: "'Inter', sans-serif",
    bodyFont: "'Hanken Grotesk', sans-serif",
    fontHref: FONTS.generic,
    radius: 12,
    bg: "#f8faf9",
    ink: "#16201b",
    headerBg: "rgba(248,250,249,.92)",
    headerBorder: "1px solid #e8ecea",
    footerBg: "#fff",
    footerBorder: "1px solid #e8ecea",
    eyebrow: `The ${entry.techName} showcase`,
    heroTitle: `Discover the best projects built with ${entry.techName}`,
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars.",
    seoTitle: `Made with ${entry.techName} — the showcase of projects built with ${entry.techName}`,
    seoDescription: `A curated, daily-updated gallery of the best open-source projects built with ${entry.techName}, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.`,
  };
}

/** Bespoke themes — existing domains with unique identity. */
const BESPOKE_THEMES: Record<string, Omit<Theme, "slug" | "techName" | "domain" | "group">> = {
  nuxt: {
    accent: "#00DC82", accentInk: "#04231a", variant: "light", editorial: false, heroId: "nuxt",
    dispFont: "'Sora', sans-serif", bodyFont: "'Hanken Grotesk', sans-serif", fontHref: FONTS.nuxt, radius: 14,
    bg: "radial-gradient(1100px 460px at 72% -10%, #cffbe9 0%, rgba(207,251,233,0) 62%), #fbfcfb", ink: "#16201b",
    headerBg: "rgba(251,252,251,.85)", headerBorder: "1px solid #ebeeec", footerBg: "#fff", footerBorder: "1px solid #ebeeec",
    eyebrow: "The Nuxt showcase", heroTitle: "Discover the best apps & sites built with Nuxt",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars.",
    seoTitle: "Made with Nuxt — the showcase of apps & sites built with Nuxt",
    seoDescription: "A curated, daily-updated gallery of the best open-source projects built with Nuxt, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.",
  },
  node: {
    accent: "#5FA04E", accentInk: "#04231a", variant: "terminal", editorial: false, heroId: "node",
    dispFont: "'Space Grotesk', sans-serif", bodyFont: "'JetBrains Mono', monospace", fontHref: FONTS.node, radius: 10,
    bg: "radial-gradient(1100px 520px at 78% -10%, #123322 0%, rgba(18,51,34,0) 58%), #080b0a", ink: "#c7d0ca",
    headerBg: "rgba(12,15,14,.88)", headerBorder: "1px solid #1c211e", footerBg: "#0a0d0c", footerBorder: "1px solid #1c211e",
    eyebrow: "// open-source projects indexed", heroTitle: "Real apps shipped with Node",
    tagline: "Indexed nightly from GitHub. Filter by category & stars — discover production repos worth reading.",
    seoTitle: "made-with-node — production apps & tools built with Node.js",
    seoDescription: "A nightly-indexed directory of real open-source projects built with Node.js, ranked by GitHub stars. Grep the ecosystem for dashboards, dev tools, UI kits and more.",
  },
  next: {
    accent: "#ffffff", accentInk: "#0a0a0a", variant: "light", editorial: true, heroId: "next",
    dispFont: "'Bricolage Grotesque', sans-serif", bodyFont: "'Hanken Grotesk', sans-serif", fontHref: FONTS.next, radius: 2,
    bg: "#000000", ink: "#fafafa", headerBg: "rgba(0,0,0,.85)", headerBorder: "1px solid #262626",
    footerBg: "#000000", footerBorder: "1px solid #262626",
    eyebrow: "The Next showcase", heroTitle: "The definitive index of Next.js sites & apps in production",
    heroHeadline: "MADE WITH<br>NEXT.JS",
    tagline: "The definitive index of sites & apps in production, ranked by GitHub stars and shipped weekly.",
    seoTitle: "Made with Next.js — the definitive index of Next.js sites & apps",
    seoDescription: "The definitive, ranked index of production sites and apps built with Next.js. Browse the editorial gallery of the highest-starred open-source Next.js projects on GitHub.",
  },
  ionic: {
    accent: "#3880FF", accentInk: "#ffffff", variant: "light", editorial: false, heroId: "ionic",
    dispFont: "'Poppins', sans-serif", bodyFont: "'Poppins', sans-serif", fontHref: FONTS.ionic, radius: 22,
    bg: "radial-gradient(1050px 450px at 75% -10%, #d7e6ff 0%, rgba(215,230,255,0) 60%), #fbfcfb", ink: "#16201b",
    headerBg: "rgba(244,248,255,.9)", headerBorder: "1px solid #e3ecfb", footerBg: "#fff", footerBorder: "1px solid #e3ecfb",
    eyebrow: "The Ionic showcase", heroTitle: "Discover the best apps built with Ionic",
    tagline: "A hand-curated, daily-updated gallery of open-source apps. Browse the ecosystem, ranked by GitHub stars.",
    seoTitle: "Made with Ionic — the showcase of mobile apps built with Ionic",
    seoDescription: "A curated, daily-updated gallery of the best open-source mobile & web apps built with Ionic, ranked by GitHub stars. Discover UI kits, dev tools and production apps.",
  },
  statamic: {
    accent: "#FF269E", accentInk: "#ffffff", variant: "light", editorial: false, heroId: "statamic", chipAccent: true,
    dispFont: "'Instrument Serif', serif", bodyFont: "'Manrope', sans-serif", fontHref: FONTS.statamic, radius: 10,
    bg: "radial-gradient(1000px 440px at 78% -10%, #ece3ff 0%, rgba(236,227,255,0) 60%), #fbfcfb", ink: "#16201b",
    headerBg: "rgba(251,250,255,.88)", headerBorder: "1px solid #ece7f6", footerBg: "#fff", footerBorder: "1px solid #ece7f6",
    eyebrow: "The Statamic showcase", heroTitle: "Discover the best sites built with Statamic",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Statamic — the showcase of sites built with Statamic",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and add-ons built with Statamic, ranked by GitHub stars. Discover CMS builds, UI kits and dev tools.",
  },
  twill: {
    accent: "#6621d9", accentInk: "#ffffff", variant: "light", editorial: false, heroId: "twill",
    dispFont: "'Newsreader', serif", bodyFont: "'Hanken Grotesk', sans-serif", fontHref: FONTS.twill, radius: 5,
    bg: "#f7f4ee", ink: "#211d16", headerBg: "rgba(247,244,238,.92)", headerBorder: "1px solid #17140f",
    footerBg: "#f2efe7", footerBorder: "1px solid #17140f",
    eyebrow: "The Twill showcase", heroTitle: "Discover the best sites built with Twill",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Twill — the showcase of sites built with Twill CMS",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and packages built with Twill, the Laravel CMS, ranked by GitHub stars. Discover CMS builds and dev tools.",
  },
};

function buildTheme(entry: CatalogEntry): Theme {
  const base = entry.bespoke && BESPOKE_THEMES[entry.slug]
    ? { slug: entry.slug, techName: entry.techName, domain: entry.domain, group: entry.group, ...BESPOKE_THEMES[entry.slug] }
    : genericTheme(entry);
  return applyEngineTokens(base);
}

export const DOMAINS: Theme[] = DOMAIN_CATALOG.map(buildTheme);

export const DOMAIN_MAP: Record<string, Theme> = Object.fromEntries(DOMAINS.map((d) => [d.slug, d]));

/**
 * Temporary: hide generic madewith*.com (non-bespoke) galleries from the
 * public network hub. Flip to false to restore them on the homepage / llms.txt.
 * Individual /[domain]/ routes stay buildable.
 */
export const HIDE_SINGLE_DOMAINS = false;

const BESPOKE_SLUGS = new Set(DOMAIN_CATALOG.filter((d) => d.bespoke).map((d) => d.slug));

export function isBespokeDomain(slug: string): boolean {
  return BESPOKE_SLUGS.has(slug);
}

/** Domains listed on the network landing and related public surfaces. */
export const NETWORK_DOMAINS: Theme[] = HIDE_SINGLE_DOMAINS
  ? DOMAINS.filter((d) => isBespokeDomain(d.slug))
  : DOMAINS;

export function getTheme(slug: string): Theme {
  const t = DOMAIN_MAP[slug];
  if (!t) throw new Error(`Unknown domain slug: ${slug}`);
  return t;
}

/** Legacy admin values map to current network sections. */
export function normalizeDomainGroup(group: string | undefined | null): DomainGroup {
  if (group === "cms" || group === "crm-erp") return "cms-crm";
  if (
    group === "frameworks" ||
    group === "frontend" ||
    group === "backend" ||
    group === "cms-crm" ||
    group === "commerce" ||
    group === "ai-llm"
  ) {
    return group;
  }
  return "frameworks";
}

/** Theme with admin overrides from pulled config (if any). */
export function getResolvedTheme(slug: string): Theme {
  const theme = applyEngineTokens(applyThemeOverrides(getTheme(slug), getDomainSettings(slug)));
  return { ...theme, group: normalizeDomainGroup(theme.group) };
}

/** Domains grouped for the network landing page. */
export const DOMAINS_BY_GROUP: Record<DomainGroup, Theme[]> = {
  frameworks: DOMAINS.filter((d) => d.group === "frameworks"),
  frontend: DOMAINS.filter((d) => d.group === "frontend"),
  backend: DOMAINS.filter((d) => d.group === "backend"),
  "cms-crm": DOMAINS.filter((d) => d.group === "cms-crm"),
  commerce: DOMAINS.filter((d) => d.group === "commerce"),
  "ai-llm": DOMAINS.filter((d) => d.group === "ai-llm"),
};

export const GROUP_LABELS: Record<DomainGroup, string> = {
  frameworks: "Frameworks",
  frontend: "Frontend",
  backend: "Backend",
  "cms-crm": "CMS / CRM",
  commerce: "Commerce",
  "ai-llm": "AI / LLM",
};

/**
 * `color` is the group's hue — used for the chip background tint, the icon
 * plate and borders. `ink` is that hue darkened until it clears AA as 12–14px
 * text on the 16% tint (the darkest surface it lands on); the raw hue ran
 * 2.45–4.48:1 there, so labels and glyphs must use `ink`, not `color`.
 */
export const GROUP_META: Record<DomainGroup, { label: string; icon: string; color: string; ink: string; bg: string }> = {
  frameworks: {
    label: "Frameworks",
    icon: "◈",
    color: "#16A34A",
    ink: readableOn("#16A34A", tint("#16A34A", 16)),
    bg: "color-mix(in srgb, #16A34A 16%, #ffffff)",
  },
  frontend: {
    label: "Frontend",
    icon: "▤",
    color: "#2F6FEB",
    ink: readableOn("#2F6FEB", tint("#2F6FEB", 16)),
    bg: "color-mix(in srgb, #2F6FEB 16%, #ffffff)",
  },
  backend: {
    label: "Backend",
    icon: "❯",
    color: "#EA7A2B",
    ink: readableOn("#EA7A2B", tint("#EA7A2B", 16)),
    bg: "color-mix(in srgb, #EA7A2B 16%, #ffffff)",
  },
  "cms-crm": {
    label: "CMS / CRM",
    icon: "❏",
    color: "#7C3AED",
    ink: readableOn("#7C3AED", tint("#7C3AED", 16)),
    bg: "color-mix(in srgb, #7C3AED 16%, #ffffff)",
  },
  commerce: {
    label: "Commerce",
    icon: "⛬",
    color: "#C2612B",
    ink: readableOn("#C2612B", tint("#C2612B", 16)),
    bg: "color-mix(in srgb, #C2612B 16%, #ffffff)",
  },
  "ai-llm": {
    label: "AI / LLM",
    icon: "✦",
    color: "#6366F1",
    ink: readableOn("#6366F1", tint("#6366F1", 16)),
    bg: "color-mix(in srgb, #6366F1 16%, #ffffff)",
  },
};
