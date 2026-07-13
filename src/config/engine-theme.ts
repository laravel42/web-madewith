/**
 * Per-tech catalog tokens from MadeWith Engine.dc.html — accents, hero arch,
 * radius, gradients and terminal/editorial flags.
 */
import type { Theme } from "./domains";

export type HeroArch = "band" | "browser" | "phone" | "terminal" | "banner";

export interface EngineTokens {
  accent: string;
  accentInk: string;
  radius: number;
  arch: HeroArch;
  gradient?: string;
  mockHero?: string;
  serif?: boolean;
}

/** Design handoff — slug → engine tokens. */
export const ENGINE_TOKENS: Record<string, EngineTokens> = {
  react: { accent: "#61DAFB", accentInk: "#04222c", radius: 14, arch: "browser", mockHero: "linear-gradient(135deg,#04222c,#61DAFB)" },
  vue: { accent: "#4FC08D", accentInk: "#06231a", radius: 16, arch: "band", gradient: "linear-gradient(135deg,#35495e,#4FC08D)" },
  angular: { accent: "#DD0031", accentInk: "#ffffff", radius: 6, arch: "banner" },
  svelte: { accent: "#FF3E00", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#c42d00,#FF3E00)" },
  jquery: { accent: "#0769AD", accentInk: "#ffffff", radius: 4, arch: "terminal" },
  alpine: { accent: "#77C1D2", accentInk: "#0a2233", radius: 22, arch: "phone", mockHero: "linear-gradient(135deg,#4a9fb0,#77C1D2)" },
  solidjs: { accent: "#2C4F7C", accentInk: "#ffffff", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#1a3050,#2C4F7C)" },
  astro: { accent: "#FF5D01", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#3245FF,#FF5D01)" },
  sveltekit: { accent: "#FF3E00", accentInk: "#ffffff", radius: 8, arch: "banner" },
  laravel: { accent: "#FF2D20", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#1a1a1a,#FF2D20)" },
  symfony: { accent: "#1A171B", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#000,#2d2d2d)" },
  django: { accent: "#0C4B33", accentInk: "#ffffff", radius: 6, arch: "band", gradient: "linear-gradient(135deg,#092e20,#0C4B33)", serif: true },
  rails: { accent: "#D30001", accentInk: "#ffffff", radius: 6, arch: "banner", serif: true },
  "spring-boot": { accent: "#6DB33F", accentInk: "#0a2109", radius: 10, arch: "browser", mockHero: "linear-gradient(135deg,#1b3409,#6DB33F)" },
  "aspnet-core": { accent: "#512BD4", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#2b1b6b,#512BD4)" },
  express: { accent: "#4B5563", accentInk: "#ffffff", radius: 4, arch: "terminal" },
  nestjs: { accent: "#E0234E", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#8b0f2e,#E0234E)" },
  fastapi: { accent: "#009688", accentInk: "#ffffff", radius: 8, arch: "terminal" },
  flask: { accent: "#111111", accentInk: "#ffffff", radius: 5, arch: "band", gradient: "linear-gradient(135deg,#000,#333)", serif: true },
  gin: { accent: "#00ADD8", accentInk: "#04222c", radius: 10, arch: "browser", mockHero: "linear-gradient(135deg,#053a49,#00ADD8)" },
  fiber: { accent: "#00ADD8", accentInk: "#04222c", radius: 14, arch: "band", gradient: "linear-gradient(135deg,#053a49,#00ADD8)" },
  fastify: { accent: "#000000", accentInk: "#ffffff", radius: 6, arch: "terminal" },
  hono: { accent: "#E36002", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#ff9a2e,#E36002)" },
  koa: { accent: "#33333D", accentInk: "#ffffff", radius: 6, arch: "band", gradient: "linear-gradient(135deg,#111114,#33333D)" },
  "actix-web": { accent: "#2E7D9A", accentInk: "#ffffff", radius: 6, arch: "terminal" },
  rocket: { accent: "#D33847", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#7a1420,#D33847)" },
  phoenix: { accent: "#FD4F00", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#a83600,#FD4F00)" },
  preact: { accent: "#673AB8", accentInk: "#ffffff", radius: 14, arch: "browser", mockHero: "linear-gradient(135deg,#3d2270,#673AB8)" },
  lit: { accent: "#324FFF", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#00E8FF,#324FFF)" },
  qwik: { accent: "#18B6F6", accentInk: "#04222c", radius: 16, arch: "phone", mockHero: "linear-gradient(135deg,#0093ee,#18B6F6)" },
  wordpress: { accent: "#21759B", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#464342,#21759B)" },
  drupal: { accent: "#0678BE", accentInk: "#ffffff", radius: 8, arch: "banner" },
  joomla: { accent: "#5091CD", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#2f6fb0,#5091CD)" },
  octobercms: { accent: "#E63C2A", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#8f2a19,#E63C2A)" },
  strapi: { accent: "#4945FF", accentInk: "#ffffff", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#2f2c8f,#4945FF)" },
  directus: { accent: "#6644FF", accentInk: "#ffffff", radius: 14, arch: "band", gradient: "linear-gradient(135deg,#00C897,#6644FF)" },
  payload: { accent: "#000000", accentInk: "#ffffff", radius: 2, arch: "banner" },
  ghost: { accent: "#15171A", accentInk: "#ffffff", radius: 6, arch: "band", gradient: "linear-gradient(135deg,#000000,#2b2f36)", serif: true },
  magento: { accent: "#EC6737", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#f26322,#EC6737)" },
  prestashop: { accent: "#DF0067", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#251C6B,#DF0067)" },
  woocommerce: { accent: "#7F54B3", accentInk: "#ffffff", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#4b2f75,#7F54B3)" },
  bagisto: { accent: "#0EA5E9", accentInk: "#04222c", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#5C39D9,#0EA5E9)" },
  medusa: { accent: "#6D28D9", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#3d1a99,#6D28D9)" },
  saleor: { accent: "#06847B", accentInk: "#ffffff", radius: 14, arch: "browser", mockHero: "linear-gradient(135deg,#043f3a,#06847B)" },
  shopware: { accent: "#189EFF", accentInk: "#04222c", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#0a5fb8,#189EFF)" },
  opencart: { accent: "#23A1D4", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#136b90,#23A1D4)" },
  odoo: { accent: "#714B67", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#4a3143,#714B67)" },
  erpnext: { accent: "#2490EF", accentInk: "#ffffff", radius: 10, arch: "browser", mockHero: "linear-gradient(135deg,#155aa0,#2490EF)" },
  suitecrm: { accent: "#D65B27", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#8a3915,#D65B27)" },
  espocrm: { accent: "#1B4E6B", accentInk: "#ffffff", radius: 8, arch: "band", gradient: "linear-gradient(135deg,#0d2c3d,#1B4E6B)" },
  dolibarr: { accent: "#2C5987", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#16324d,#2C5987)" },
  "twenty-crm": { accent: "#1961ED", accentInk: "#ffffff", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#0f3a91,#1961ED)" },
  vtiger: { accent: "#17A2B8", accentInk: "#04222c", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#0c6675,#17A2B8)" },
  monica: { accent: "#EA6E4B", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#9c3f26,#EA6E4B)", serif: true },
  ollama: { accent: "#000000", accentInk: "#ffffff", radius: 6, arch: "terminal" },
  langchain: { accent: "#199C82", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#0c5b4c,#199C82)" },
  llamaindex: { accent: "#8A3FFC", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#4c1d99,#8A3FFC)" },
  flowise: { accent: "#10B981", accentInk: "#04231a", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#08654a,#10B981)" },
  dify: { accent: "#1C64F2", accentInk: "#ffffff", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#103b91,#1C64F2)" },
  "open-webui": { accent: "#6366F1", accentInk: "#ffffff", radius: 12, arch: "band", gradient: "linear-gradient(135deg,#383a99,#6366F1)" },
  librechat: { accent: "#0EA5A4", accentInk: "#04231f", radius: 14, arch: "band", gradient: "linear-gradient(135deg,#075e5d,#0EA5A4)" },
  anythingllm: { accent: "#36B37E", accentInk: "#04231a", radius: 10, arch: "band", gradient: "linear-gradient(135deg,#1d6b4c,#36B37E)" },
  haystack: { accent: "#C6E42A", accentInk: "#1a2200", radius: 12, arch: "browser", mockHero: "linear-gradient(135deg,#7f9410,#C6E42A)" },
  vllm: { accent: "#5B8DEF", accentInk: "#ffffff", radius: 6, arch: "terminal" },
};

const BESPOKE_SLUGS = new Set(["nuxt", "node", "next", "ionic", "statamic", "twill"]);

const BESPOKE_ARCH: Record<string, HeroArch> = {
  nuxt: "browser",
  node: "terminal",
  next: "banner",
  ionic: "phone",
  statamic: "band",
  twill: "band",
};

export function engineTokensFor(slug: string): EngineTokens | null {
  return ENGINE_TOKENS[slug] ?? null;
}

export function applyEngineTokens(theme: Theme): Theme {
  const tokens = ENGINE_TOKENS[theme.slug];
  const arch = BESPOKE_ARCH[theme.slug] ?? tokens?.arch ?? "band";
  const accent = tokens?.accent ?? theme.accent;
  const accentInk = tokens?.accentInk ?? theme.accentInk;
  const radius = tokens?.radius ?? theme.radius;
  const gradient = tokens?.gradient;
  const mockHero = tokens?.mockHero;
  const serif = tokens?.serif ?? false;

  const variant = arch === "terminal" ? "terminal" as const : "light" as const;
  // Next keeps its bespoke black editorial shell; other banner techs use light editorial grid.
  const editorial = arch === "banner";
  const bandDark = arch === "band" && !!gradient;

  const soft = `color-mix(in srgb, ${accent} 13%, #ffffff)`;
  const softBorder = `color-mix(in srgb, ${accent} 22%, #ffffff)`;
  const bandBg = bandDark
    ? gradient!
    : `radial-gradient(560px 300px at 92% 6%, ${soft}, rgba(255,255,255,0) 62%), linear-gradient(135deg, ${soft} 0%, #f7fbf9 100%)`;

  const terminalBg = `radial-gradient(1100px 520px at 78% -10%, color-mix(in srgb, ${accent} 28%, #000) 0%, rgba(0,0,0,0) 58%), #0c0f0e`;

  let bg = theme.bg;
  let ink = theme.ink;
  let headerBg = theme.headerBg;
  let headerBorder = theme.headerBorder;
  let footerBg = theme.footerBg;
  let footerBorder = theme.footerBorder;

  if (!BESPOKE_SLUGS.has(theme.slug)) {
    bg = "#fbfcfb";
    ink = "#16201b";
    headerBg = "rgba(251,252,251,.85)";
    headerBorder = "1px solid #ebeeec";
    footerBg = "#fff";
    footerBorder = "1px solid #ebeeec";

    if (variant === "terminal") {
      bg = terminalBg;
      ink = "#c7d0ca";
      headerBg = "rgba(12,15,14,.85)";
      headerBorder = "1px solid #1c211e";
      footerBg = "#0a0d0c";
      footerBorder = "1px solid #1c211e";
    } else if (arch === "banner") {
      headerBg = "rgba(255,255,255,.92)";
      headerBorder = "2px solid #0a0a0a";
    }
  } else if (theme.slug === "next") {
    // Next keeps its bespoke black shell; banner header tokens still apply for grid.
  }

  const dispFont = BESPOKE_SLUGS.has(theme.slug)
    ? theme.dispFont
    : serif
      ? "'Instrument Serif', serif"
      : arch === "banner"
        ? "'Bricolage Grotesque', sans-serif"
        : theme.dispFont;

  return {
    ...theme,
    accent,
    accentInk,
    radius,
    variant,
    editorial,
    heroArch: arch,
    heroGradient: gradient,
    heroMockHero: mockHero,
    heroBandDark: bandDark,
    heroBandBg: bandBg,
    heroSoftBorder: softBorder,
    dispFont,
    bodyFont: variant === "terminal" && !BESPOKE_SLUGS.has(theme.slug)
      ? "'JetBrains Mono', monospace"
      : theme.bodyFont,
    fontHref: variant === "terminal" && !BESPOKE_SLUGS.has(theme.slug)
      ? "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
      : theme.fontHref,
    bg,
    ink,
    headerBg,
    headerBorder,
    footerBg,
    footerBorder,
    eyebrow: theme.eyebrow || `The ${theme.techName} showcase`,
    heroTitle: theme.heroTitle || `Discover the best projects built with ${theme.techName}`,
    tagline: theme.tagline || "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.",
  };
}
