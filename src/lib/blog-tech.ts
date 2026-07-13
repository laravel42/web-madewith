import { DOMAINS, getResolvedTheme, networkMetaFor } from "../config/domains";

export interface BlogTechMeta {
  techName: string;
  slug: string;
  accent: string;
  accentInk: string;
  galleryHref: string;
}

const BY_NAME = new Map<string, BlogTechMeta>();

for (const entry of DOMAINS) {
  const theme = getResolvedTheme(entry.slug);
  const net = networkMetaFor(theme);
  BY_NAME.set(theme.techName, {
    techName: theme.techName,
    slug: theme.slug,
    accent: net.accent,
    accentInk: net.accentInk,
    galleryHref: `/${theme.slug}/`,
  });
}

export function blogTechFor(techName: string): BlogTechMeta {
  return (
    BY_NAME.get(techName) ?? {
      techName,
      slug: techName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      accent: "#2F6FEB",
      accentInk: "#ffffff",
      galleryHref: "/",
    }
  );
}
