/**
 * Workers AI fallback for low-confidence classifications.
 *
 * The rule engine (shared/classify.mjs) handles clear cases deterministically
 * and cheaply; repos it can't place confidently (confidence < LOW_CONFIDENCE —
 * typically apps with no categorical keywords) are classified by a small model
 * with a strict one-label contract. Results are cached in KV by GitHub repo id
 * so each repo is asked about at most once a month.
 *
 * Entirely optional: when the AI binding is absent or a call fails, the rule
 * engine's answer stands. This mirrors the reference pipeline's "rule-based
 * first, LLM contract below the confidence threshold" design.
 */
import { CATEGORIES, CATEGORY_BLURBS, LOW_CONFIDENCE, classifyDetailed, type Category } from "./classify";
import type { Project } from "./scrape";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CACHE_TTL = 60 * 60 * 24 * 30;

/** Prompt is generated from categories.json so it always matches the taxonomy. */
const SYSTEM = `You classify GitHub repositories into exactly one catalog category.

Categories:
${CATEGORIES.map((c) => `- ${c}: ${CATEGORY_BLURBS.get(c) ?? ""}`).join("\n")}

Reply with the category name only — nothing else.`;

/** Extract a valid category from a model reply, or null. */
export function parseCategory(reply: unknown): Category | null {
  if (typeof reply !== "string") return null;
  const text = reply.trim().toLowerCase();
  // Exact match first, then containment (models sometimes add a period or quote).
  for (const c of CATEGORIES) if (text === c.toLowerCase()) return c;
  for (const c of CATEGORIES) if (text.includes(c.toLowerCase())) return c;
  return null;
}

/**
 * Re-classify low-confidence projects in place. Mutates `projects`.
 * Returns how many were re-labeled by the model.
 */
export async function refineCategories(ai: Ai | undefined, kv: KVNamespace, projects: Project[]): Promise<number> {
  if (!ai) return 0;
  let changed = 0;

  for (const p of projects) {
    const ruled = classifyDetailed({ name: p.name, description: p.desc, topics: p.topics });
    if (ruled.confidence >= LOW_CONFIDENCE) continue;

    const cacheKey = `aicat:v2:${p.githubId}`;
    try {
      const cached = await kv.get(cacheKey);
      if (cached && (CATEGORIES as readonly string[]).includes(cached)) {
        if (p.category !== cached) { p.category = cached as Category; changed++; }
        continue;
      }

      const result = (await ai.run(MODEL as Parameters<Ai["run"]>[0], {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Repository: ${p.fullName}\nDescription: ${p.desc || "(none)"}\nTopics: ${p.topics.join(", ") || "(none)"}` },
        ],
        max_tokens: 16,
      })) as { response?: string };

      const category = parseCategory(result?.response);
      if (!category) continue; // contract violated — keep the rule-based answer
      await kv.put(cacheKey, category, { expirationTtl: CACHE_TTL }).catch(() => {});
      if (p.category !== category) { p.category = category; changed++; }
    } catch (e) {
      // AI is best-effort — never fail a scrape over it.
      console.log(`ai classify failed for ${p.fullName}: ${(e as Error).message}`);
    }
  }
  return changed;
}
