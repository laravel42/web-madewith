import { DOMAINS, getResolvedTheme, networkMetaFor } from "../config/domains";
import { coverBase, readableOnLight, solidSurface } from "../config/accessible-color";

export interface BlogTechMeta {
  techName: string;
  slug: string;
  /** Raw brand colour. Fills, borders, watermarks, gradient starts — never text. */
  accent: string;
  accentInk: string;
  /** The accent as text on a light surface (tech labels, timecodes, links). */
  accentOnLight: string;
  /** The accent as a solid surface carrying `accentInk` (avatars, buttons). */
  accentSolid: string;
  /** Light end of a cover gradient that white text sits on. */
  accentCover: string;
  galleryHref: string;
}

function withDerived(base: Omit<BlogTechMeta, "accentOnLight" | "accentSolid" | "accentCover">): BlogTechMeta {
  return {
    ...base,
    accentOnLight: readableOnLight(base.accent),
    accentSolid: solidSurface(base.accent, base.accentInk),
    accentCover: coverBase(base.accent),
  };
}

const BY_NAME = new Map<string, BlogTechMeta>();

for (const entry of DOMAINS) {
  const theme = getResolvedTheme(entry.slug);
  const net = networkMetaFor(theme);
  BY_NAME.set(
    theme.techName,
    withDerived({
      techName: theme.techName,
      slug: theme.slug,
      accent: net.accent,
      accentInk: net.accentInk,
      galleryHref: `/${theme.slug}/`,
    })
  );
}

export function blogTechFor(techName: string): BlogTechMeta {
  return (
    BY_NAME.get(techName) ??
    withDerived({
      techName,
      slug: techName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      accent: "#2F6FEB",
      accentInk: "#ffffff",
      galleryHref: "/",
    })
  );
}
