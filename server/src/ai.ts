/**
 * OpenAI fallback for low-confidence classifications — the Workers AI
 * replacement. The rule engine (shared/classify.mjs) handles clear cases; repos
 * below LOW_CONFIDENCE get a one-label second opinion from a small model over
 * OpenAI's official Chat Completions API. Results are cached in Redis by repo id.
 *
 * Entirely optional: when OPENAI_API_KEY is absent or a call fails, the
 * rule engine's answer stands.
 */
import { CATEGORIES, CATEGORY_BLURBS, LOW_CONFIDENCE, classifyDetailed, type Category } from "./classify";
import type { Project } from "./scrape";
import type { Kv } from "./types";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const CACHE_TTL = 60 * 60 * 24 * 30;

/** Prompt is generated from categories.json so it always matches the taxonomy. */
const SYSTEM = `You classify GitHub repositories into exactly one catalog category.

Categories:
${CATEGORIES.map((c) => `- ${c}: ${CATEGORY_BLURBS.get(c) ?? ""}`).join("\n")}

Reply with the category name only — nothing else.`;

export interface AiOpts {
  apiKey?: string;
  model?: string;
}

/** Extract a valid category from a model reply, or null. */
export function parseCategory(reply: unknown): Category | null {
  if (typeof reply !== "string") return null;
  const text = reply.trim().toLowerCase();
  for (const c of CATEGORIES) if (text === c.toLowerCase()) return c;
  for (const c of CATEGORIES) if (text.includes(c.toLowerCase())) return c;
  return null;
}

async function askModel(apiKey: string, model: string, project: Project): Promise<string | null> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Repository: ${project.fullName}\nDescription: ${project.desc || "(none)"}\nTopics: ${project.topics.join(", ") || "(none)"}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

/**
 * Re-classify low-confidence projects in place. Mutates `projects`.
 * Returns how many were re-labeled by the model.
 */
export async function refineCategories(kv: Kv, projects: Project[], opts: AiOpts): Promise<number> {
  const apiKey = opts.apiKey;
  if (!apiKey) return 0;
  const model = opts.model || DEFAULT_MODEL;
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

      const category = parseCategory(await askModel(apiKey, model, p));
      if (!category) continue; // contract violated — keep the rule-based answer
      await kv.put(cacheKey, category, { ttlSeconds: CACHE_TTL }).catch(() => {});
      if (p.category !== category) { p.category = category; changed++; }
    } catch (e) {
      // AI is best-effort — never fail a scrape over it.
      console.log(`ai classify failed for ${p.fullName}: ${(e as Error).message}`);
    }
  }
  return changed;
}
