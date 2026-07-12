/** Domain page editorial settings — stored in D1, published to R2 for static builds. */
import catalog from "../../src/config/domain-catalog.json";

export interface DomainSettingsPayload {
  eyebrow?: string | null;
  heroTitle?: string | null;
  heroHeadline?: string | null;
  tagline?: string | null;
  domain?: string | null;
  pageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Network landing page section */
  group?: "frontend" | "frameworks" | "backend" | "cms" | "commerce" | null;
  /** null/undefined = auto (top by count); [] = none; non-empty = explicit allowlist order */
  visibleCategories?: string[] | null;
}

export interface DomainSettingsRow {
  slug: string;
  data: DomainSettingsPayload;
  updated_at: string | null;
  updated_by: string | null;
}

const BESPOKE_BASELINE: Record<string, DomainSettingsPayload> = {
  nuxt: {
    eyebrow: "The Nuxt showcase",
    heroTitle: "Discover the best apps & sites built with Nuxt",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.",
    seoTitle: "Made with Nuxt — the showcase of apps & sites built with Nuxt",
    seoDescription:
      "A curated, daily-updated gallery of the best open-source projects built with Nuxt, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.",
  },
  node: {
    eyebrow: "// open-source projects indexed",
    heroTitle: "Real apps shipped with Node",
    tagline: "Indexed nightly from GitHub. Filter by category & stars — discover production repos worth reading.",
    seoTitle: "made-with-node — production apps & tools built with Node.js",
    seoDescription:
      "A nightly-indexed directory of real open-source projects built with Node.js, ranked by GitHub stars. Grep the ecosystem for dashboards, dev tools, UI kits and more.",
  },
  next: {
    eyebrow: "The Next showcase",
    heroTitle: "The definitive index of Next.js sites & apps in production",
    heroHeadline: "MADE WITH<br>NEXT.JS",
    tagline: "The definitive index of sites & apps in production. {total} projects, ranked by GitHub stars and shipped weekly.",
    seoTitle: "Made with Next.js — the definitive index of Next.js sites & apps",
    seoDescription:
      "The definitive, ranked index of production sites and apps built with Next.js. Browse the editorial gallery of the highest-starred open-source Next.js projects on GitHub.",
  },
  ionic: {
    eyebrow: "The Ionic showcase",
    heroTitle: "Discover the best apps built with Ionic",
    tagline: "A hand-curated, daily-updated gallery of open-source apps. Browse {total} repos, ranked by GitHub stars.",
    seoTitle: "Made with Ionic — the showcase of mobile apps built with Ionic",
    seoDescription:
      "A curated, daily-updated gallery of the best open-source mobile & web apps built with Ionic, ranked by GitHub stars. Discover UI kits, dev tools and production apps.",
  },
  statamic: {
    eyebrow: "The Statamic showcase",
    heroTitle: "Discover the best sites built with Statamic",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Statamic — the showcase of sites built with Statamic",
    seoDescription:
      "A curated, daily-updated gallery of the best open-source sites and add-ons built with Statamic, ranked by GitHub stars. Discover CMS builds, UI kits and dev tools.",
  },
  twill: {
    eyebrow: "The Twill showcase",
    heroTitle: "Discover the best sites built with Twill",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Twill — the showcase of sites built with Twill CMS",
    seoDescription:
      "A curated, daily-updated gallery of the best open-source sites and packages built with Twill, the Laravel CMS, ranked by GitHub stars. Discover CMS builds and dev tools.",
  },
};

function genericBaseline(techName: string, domain: string): DomainSettingsPayload {
  return {
    eyebrow: `The ${techName} showcase`,
    heroTitle: `Discover the best projects built with ${techName}`,
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.",
    domain,
    pageUrl: `https://${domain}/`,
    seoTitle: `Made with ${techName} — the showcase of projects built with ${techName}`,
    seoDescription: `A curated, daily-updated gallery of the best open-source projects built with ${techName}, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.`,
  };
}

export function baselineForSlug(slug: string): DomainSettingsPayload & { slug: string; techName: string } {
  const entry = catalog.find((d) => d.slug === slug);
  if (!entry) throw new Error(`unknown slug: ${slug}`);
  const base = entry.bespoke && BESPOKE_BASELINE[slug] ? BESPOKE_BASELINE[slug] : genericBaseline(entry.techName, entry.domain);
  return {
    slug,
    techName: entry.techName,
    domain: entry.domain,
    pageUrl: `https://${entry.domain}/`,
    group: entry.group as DomainSettingsPayload["group"],
    visibleCategories: null,
    ...base,
  };
}

export function mergeDomainSettings(
  baseline: DomainSettingsPayload,
  override: DomainSettingsPayload | null,
): DomainSettingsPayload {
  if (!override) return { ...baseline };
  const out: DomainSettingsPayload = { ...baseline };
  for (const [k, v] of Object.entries(override) as [keyof DomainSettingsPayload, unknown][]) {
    if (v !== undefined && v !== null && v !== "") (out as any)[k] = v;
  }
  if (override.visibleCategories !== undefined) out.visibleCategories = override.visibleCategories;
  return out;
}
