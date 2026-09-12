/** Mirrors server/src/classify.ts's CATEGORIES — same source JSON, no server/ dependency. */
import raw from "../../../src/config/categories.json" with { type: "json" };

export const CATEGORIES: readonly string[] = raw.categories.map((c: { label: string }) => c.label);
