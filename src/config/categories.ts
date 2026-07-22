import raw from "./categories.json";
import { readableOn, readableOnSurfaceDark, tint } from "./accessible-color";

export interface CategoryDef {
  label: string;
  blurb: string;
  color: string;
  bg: string;
  keywords: string[];
}

export const CATEGORY_DEFS = raw.categories as CategoryDef[];

/**
 * `color` is the category hue — chip borders, icon plates, the tinted top band
 * of a category card. `ink` / `inkDark` are that hue pushed until it clears AA
 * as a 12–13px label: the raw hue ran 2.2–4.4:1 both on its own pastel chip and
 * on the terminal variant's near-black card.
 *
 * `ink` targets the 12% tint (the darkest light surface a category label sits
 * on); `inkDark` targets the 22%-over-#0c0f0e tint used by the terminal cards.
 */
export const CATEGORY_META: Record<
  string,
  { blurb: string; color: string; ink: string; inkDark: string; bg: string }
> = Object.fromEntries(
  CATEGORY_DEFS.map((c) => [
    c.label,
    {
      blurb: c.blurb,
      color: c.color,
      ink: readableOn(c.color, tint(c.color, 12)),
      inkDark: readableOnSurfaceDark(c.color, tint(c.color, 22, "#0c0f0e")),
      bg: c.bg,
    },
  ])
);

export const CATEGORY_ORDER = CATEGORY_DEFS.map((c) => c.label);

/** Tag filter order (categories prefixed with the "All" pill). */
export const TAG_ORDER = ["All", ...CATEGORY_ORDER];

/** Keyword rules for classification — order matches CATEGORY_DEFS (first match wins). */
export const CLASSIFIER_RULES: Array<[string, string[]]> = CATEGORY_DEFS.map((c) => [c.label, c.keywords]);

export function classifyProject(input: { topics?: string[]; description?: string; name?: string }): string {
  const hay = `${(input.topics || []).join(" ")} ${input.description || ""} ${input.name || ""}`.toLowerCase();
  for (const [cat, kws] of CLASSIFIER_RULES) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return "DevTools";
}
