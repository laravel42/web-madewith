/**
 * Repository → catalog-category classifier (shared by the Worker and any
 * build-time tooling — single source of truth so implementations can't drift).
 *
 * Replaces the substring first-match classifier, whose failure modes are live
 * in the published data: "ai" matched inside "maintain"/"email"/"domain" and
 * "ml" inside "html" (which is how ~25–48% of repos landed in "AI & ML"),
 * "ui" matched inside "building", and one weak keyword outranked several
 * strong ones.
 *
 * This engine instead:
 *  - tokenizes on word boundaries (unigrams + hyphen-joined bi/trigram phrases,
 *    so "design system" and "static site generator" match as phrases);
 *  - scores every category from a weighted signal table, weighting by source
 *    (topic 1.5× > name 1.2× > description 1×), each term counted once at its
 *    strongest source;
 *  - suppresses double-counting: when a phrase matches ("shadcn-ui"), its
 *    component words ("shadcn", "ui") don't also score for the same category;
 *  - applies diminishing returns per category (1, 0.6, 0.36, …) so one
 *    definitive signal beats a pile of weak incidental ones;
 *  - treats styling-stack terms (tailwind, bootstrap, shadcn) as *support only*
 *    — they can't win UI Kits for an app that merely uses them for styling;
 *  - requires a minimum score to commit — weak single hits fall back to
 *    DevTools ("developer utilities", the honest catch-all for GitHub repos)
 *    instead of winning a category on noise;
 *  - reports a confidence so callers can route low-confidence repos to a
 *    smarter fallback (the Worker uses an optional Workers AI pass).
 *
 * The category set mirrors src/config/categories.json — a unit test asserts
 * the two stay in sync.
 */

import CONFIG from "./classify-signals.json" with { type: "json" };

export const CATEGORIES = CONFIG.categories;

export const DEFAULT_CATEGORY = CONFIG.default_category;

/** A category only wins outright when its score reaches this. */
const MIN_SCORE = CONFIG.min_score;

/** Source multipliers — a GitHub topic is a deliberate label, a description word is incidental. */
const SRC_TOPIC = CONFIG.source_multipliers.topic;
const SRC_NAME = CONFIG.source_multipliers.name;
const SRC_DESC = CONFIG.source_multipliers.description;

/**
 * Signal table: term → [category, weight] — loaded from classify-signals.json,
 * the single source of truth shared with the Python publish pipeline
 * (workers/projects/madewith_scraper/classify_engine.py). Terms are lowercase unigrams
 * or hyphen-joined phrases; weights: 4 = definitive, 3 = strong, 2 = solid,
 * ≤1.5 = weak supporting evidence. Framework/domain names are deliberately
 * absent — they appear on every repo of that domain.
 */
const SIGNALS = CONFIG.signals;

/** Map lookup — a plain-object lookup would hit Object.prototype members
 * ("constructor", "toString"…) when they appear as words in repo text. */
const SIGNAL_MAP = new Map(Object.entries(SIGNALS));

/**
 * Support-only terms: real evidence a repo *uses* a styling stack, but not that
 * it *is* a UI kit. They only count when the category also has a core match.
 */
const SUPPORT_ONLY = new Set(CONFIG.support_only);

/** Diminishing returns: per-category contributions are weighted 1, DECAY, DECAY², … */
const DECAY = CONFIG.decay;

const WORD = /[a-z0-9]+/g;

/** words → the words plus hyphen-joined bigrams and trigrams ("static-site-generator"). */
function withPhrases(words) {
  const out = [...words];
  for (let i = 0; i < words.length - 1; i++) out.push(`${words[i]}-${words[i + 1]}`);
  for (let i = 0; i < words.length - 2; i++) out.push(`${words[i]}-${words[i + 1]}-${words[i + 2]}`);
  return out;
}

/** Build {term → sourceMultiplier} keeping the strongest source per term. */
function termSources({ name, description, topics }) {
  const sources = new Map();
  const add = (terms, mult) => {
    for (const t of terms) if ((sources.get(t) ?? 0) < mult) sources.set(t, mult);
  };
  // Description: unigrams + phrases.
  add(withPhrases(String(description || "").toLowerCase().match(WORD) ?? []), SRC_DESC);
  // Name: split into tokens + phrases ("eloquent-driver" → eloquent, driver, eloquent-driver).
  add(withPhrases(String(name || "").toLowerCase().match(WORD) ?? []), SRC_NAME);
  // Topics: the topic string itself is already hyphen-joined; also its words + phrases.
  for (const topic of topics || []) {
    const words = String(topic).toLowerCase().match(WORD) ?? [];
    add(withPhrases(words), SRC_TOPIC);
  }
  return sources;
}

/**
 * Classify a repo. Input: { name, description, topics }.
 * Returns { category, confidence (0..1), scores } — confidence < ~0.45 means
 * "weak evidence; a smarter fallback should double-check".
 */
export function classifyDetailed(input) {
  const sources = termSources(input);

  // Collect matches per category.
  const byCat = new Map(CATEGORIES.map((c) => [c, []]));
  for (const [term, mult] of sources) {
    const sig = SIGNAL_MAP.get(term);
    if (sig) byCat.get(sig[0]).push({ term, contribution: sig[1] * mult, words: term.split("-") });
  }

  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const [cat, matches] of byCat) {
    if (!matches.length) continue;

    // Phrase suppression: a unigram doesn't also score when it's a component
    // word of a matched phrase in the same category ("ui" ⊄ "shadcn-ui").
    const phraseWords = new Set(matches.filter((m) => m.words.length > 1).flatMap((m) => m.words));
    let kept = matches.filter((m) => m.words.length > 1 || !phraseWords.has(m.term));

    // Support-only terms need a core match to count at all.
    if (!kept.some((m) => !SUPPORT_ONLY.has(m.term))) continue;

    // Diminishing returns: strongest signal counts fully, the rest decay.
    kept.sort((a, b) => b.contribution - a.contribution);
    scores[cat] = kept.reduce((sum, m, i) => sum + m.contribution * DECAY ** i, 0);
  }

  const ranked = CATEGORIES.map((c) => [c, scores[c]]).sort((a, b) => b[1] - a[1]);
  const [topCat, top] = ranked[0];
  const second = ranked[1][1];

  if (top < MIN_SCORE) {
    // Not enough evidence for any category — default rather than guess on noise.
    return { category: DEFAULT_CATEGORY, confidence: top === 0 ? 0.1 : 0.25, scores };
  }

  // Confidence blends absolute strength with separation from the runner-up.
  const strength = Math.min(1, top / 8);
  const separation = top > 0 ? (top - second) / top : 0;
  const confidence = Math.min(0.98, Math.round((0.35 + 0.4 * strength + 0.25 * separation) * 100) / 100);
  return { category: topCat, confidence, scores };
}

/** Back-compat: just the category label. */
export function classify(input) {
  return classifyDetailed(input).category;
}

/** Callers route repos below this to the smarter (AI) fallback. */
export const LOW_CONFIDENCE = CONFIG.low_confidence;
