import raw from "./categories.json";

export interface CategoryDef {
  label: string;
  blurb: string;
  color: string;
  bg: string;
  keywords: string[];
}

export const CATEGORY_DEFS = raw.categories as CategoryDef[];

export const CATEGORY_META: Record<string, { blurb: string; color: string; bg: string }> =
  Object.fromEntries(CATEGORY_DEFS.map((c) => [c.label, { blurb: c.blurb, color: c.color, bg: c.bg }]));

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
