/**
 * Category classification — thin adapter over the shared scoring engine
 * (../../shared/classify.mjs), which replaces the old substring first-match
 * rules. The category *taxonomy* (labels, blurbs, colors) still lives in
 * src/config/categories.json; the engine's weighted signal table must cover
 * the same labels — a unit test asserts the two stay in sync.
 */
import raw from "../../src/config/categories.json";
import { classify as engineClassify, classifyDetailed, LOW_CONFIDENCE, DEFAULT_CATEGORY } from "../../shared/classify.mjs";

export const CATEGORIES = raw.categories.map((c) => c.label) as readonly string[];
export type Category = (typeof CATEGORIES)[number];

/** Label → blurb, used to build the AI-fallback prompt. */
export const CATEGORY_BLURBS: ReadonlyMap<string, string> = new Map(raw.categories.map((c) => [c.label, c.blurb]));

export { classifyDetailed, LOW_CONFIDENCE, DEFAULT_CATEGORY };

export function classify(input: { topics?: string[]; description?: string | null; name?: string }): Category {
  return engineClassify(input);
}
