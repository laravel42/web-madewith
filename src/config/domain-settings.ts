import type { Theme } from "./domains";

export interface DomainSettingsOverride {
  slug?: string;
  eyebrow?: string;
  heroTitle?: string;
  heroHeadline?: string;
  tagline?: string;
  domain?: string;
  pageUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  group?: "frameworks" | "frontend" | "backend" | "cms-crm" | "commerce" | "ai-llm";
  visibleCategories?: string[] | null;
  updatedAt?: string;
}

const files = import.meta.glob<DomainSettingsOverride>("../data/config/*.json", {
  eager: true,
  import: "default",
});

const BY_SLUG: Record<string, DomainSettingsOverride> = {};
for (const path in files) {
  const data = files[path];
  const slug = data.slug || path.replace(/.*\/([^.]+)\.json$/, "$1");
  BY_SLUG[slug] = data;
}

export function getDomainSettings(slug: string): DomainSettingsOverride | null {
  return BY_SLUG[slug] ?? null;
}

export function applyThemeOverrides(theme: Theme, settings: DomainSettingsOverride | null): Theme {
  if (!settings) return theme;
  const out = { ...theme };
  if (settings.eyebrow) out.eyebrow = settings.eyebrow;
  if (settings.heroTitle) out.heroTitle = settings.heroTitle;
  if (settings.heroHeadline) out.heroHeadline = settings.heroHeadline;
  if (settings.tagline) out.tagline = settings.tagline;
  if (settings.domain) out.domain = settings.domain;
  if (settings.seoTitle) out.seoTitle = settings.seoTitle;
  if (settings.seoDescription) out.seoDescription = settings.seoDescription;
  if (settings.pageUrl) (out as Theme & { pageUrl?: string }).pageUrl = settings.pageUrl;
  if (settings.group) out.group = settings.group;
  if (settings.visibleCategories !== undefined) (out as Theme & { visibleCategories?: string[] | null }).visibleCategories = settings.visibleCategories;
  return out;
}

/** Hero subcopy — supports `{total}` placeholder in tagline. */
export function heroSubcopy(theme: Theme, total: string): string {
  const text = theme.tagline || "A hand-curated, daily-updated gallery of open-source projects. Browse {total} repos, ranked by GitHub stars.";
  return text.replace(/\{total\}/g, total);
}

export function canonicalUrl(theme: Theme, pathname: string, site: string): string {
  const pageUrl = (theme as Theme & { pageUrl?: string }).pageUrl;
  if (pageUrl) {
    try {
      const base = new URL(pageUrl);
      if (pathname === `/${theme.slug}/` || pathname === `/${theme.slug}`) return base.href.replace(/\/+$/, "") + "/";
      const sub = pathname.replace(new RegExp(`^/${theme.slug}`), "") || "/";
      return new URL(sub, base).href;
    } catch {
      /* fall through */
    }
  }
  return new URL(pathname, site).href;
}
