/** Deterministic category classification — rules live in src/config/categories.json. */
import raw from "../../src/config/categories.json";

export const CATEGORIES = raw.categories.map((c) => c.label) as readonly string[];
export type Category = (typeof CATEGORIES)[number];

const RULES: Array<[Category, string[]]> = raw.categories.map((c) => [c.label as Category, c.keywords]);

export function classify(input: { topics?: string[]; description?: string | null; name?: string }): Category {
  const hay = `${(input.topics || []).join(" ")} ${input.description || ""} ${input.name || ""}`.toLowerCase();
  for (const [cat, kws] of RULES) if (kws.some((k) => hay.includes(k))) return cat;
  return "DevTools";
}
