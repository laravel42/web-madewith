import type { Project } from "./catalog";

const NON_LATIN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0900-\u097f]/;
const NON_LATIN_RUN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0900-\u097f]+/g;
const NON_LATIN_PARENS = /\([^)]*[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0900-\u097f][^)]*\)/g;
const NON_LATIN_BRACKETS = /\[[^\]]*[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0900-\u097f][^\]]*\]/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
const SHORTCODE = /:[a-z0-9_+-]+:/gi;
/** Block elements, geometric shapes, dingbats — common YouTube description dividers. */
const DECORATIVE_SYMBOLS = /[\u2580-\u259F\u25A0-\u25FF]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/** Remove emoji, :shortcodes:, decorative blocks, and extra whitespace. */
export function stripIcons(text: string): string {
  return text
    .replace(SHORTCODE, "")
    .replace(ZERO_WIDTH, "")
    .replace(DECORATIVE_SYMBOLS, "")
    .replace(EMOJI, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Like stripIcons, but keeps newlines so callers can split paragraphs first. */
function stripIconsKeepBreaks(text: string): string {
  return text
    .replace(SHORTCODE, "")
    .replace(ZERO_WIDTH, "")
    .replace(DECORATIVE_SYMBOLS, "")
    .replace(EMOJI, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Drop parenthetical/bracketed non-Latin fragments and inline non-Latin runs. */
export function stripNonLatinText(text: string): string {
  return text
    .replace(NON_LATIN_PARENS, "")
    .replace(NON_LATIN_BRACKETS, "")
    .replace(NON_LATIN_RUN, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanCandidate(text: string): string {
  return stripNonLatinText(stripIcons(text));
}

export function isMostlyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NON_LATIN.test(trimmed)) return false;
  return /[A-Za-z]{3}/.test(trimmed);
}

/** Pick the first English candidate after stripping icons and non-Latin text. */
export function englishPreviewText(...candidates: string[]): string {
  for (const raw of candidates) {
    if (!raw) continue;
    const cleaned = cleanCandidate(raw);
    if (cleaned && isMostlyEnglish(cleaned)) return cleaned;
  }
  for (const raw of candidates) {
    if (!raw) continue;
    const cleaned = cleanCandidate(raw);
    if (cleaned && /[A-Za-z]{2,}/.test(cleaned)) return cleaned;
  }
  const last = candidates.filter(Boolean).at(-1) ?? "";
  return cleanCandidate(last) || stripIcons(last);
}

/** Alias for titles and labels shown in the UI. */
export const englishDisplayText = englishPreviewText;

export function projectDisplayName(project: Pick<Project, "name" | "slug" | "fullName">): string {
  const slugLabel = project.slug.replace(/-/g, " ");
  const repoName = project.fullName.split("/").pop() ?? "";
  return englishDisplayText(project.name, slugLabel, repoName);
}

export function projectPreviewExcerpt(project: Project): string {
  const stackHint = project.stack.length
    ? `Open-source project built with ${project.stack.slice(0, 4).join(", ")}.`
    : `Open-source project maintained by ${project.author}.`;
  return englishPreviewText(project.desc, project.long2, project.long1, stackHint);
}

export function projectDisplayLong(project: Project, field: "long1" | "long2"): string {
  const excerpt = projectPreviewExcerpt(project);
  if (field === "long1") {
    return englishDisplayText(project.long1, project.desc, excerpt);
  }
  return englishDisplayText(project.long2, project.long1, project.desc, excerpt);
}

export function videoDisplayTitle(title: string, description = "", stack = ""): string {
  const stackHint = stack ? `${stack} tutorial` : "Video tutorial";
  return englishDisplayText(title, description, stackHint);
}

export function videoDisplayDescription(description: string, title = ""): string {
  return englishDisplayText(description, title);
}

/**
 * Split a YouTube description into cleaned display paragraphs.
 * Blank lines become paragraph breaks; single newlines within a block collapse to spaces.
 */
export function videoDescriptionParagraphs(description: string, title = ""): string[] {
  const source = (description || "").trim() || (title || "").trim();
  if (!source) return [];

  const blocks = stripIconsKeepBreaks(source).split(/\n(?:\s*\n)+/);
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const cleaned = stripNonLatinText(block.replace(/\n+/g, " "));
    if (cleaned && /[A-Za-z0-9]/.test(cleaned)) paragraphs.push(cleaned);
  }
  if (paragraphs.length) return paragraphs;

  const fallback = videoDisplayDescription(description, title);
  return fallback ? [fallback] : [];
}

export function truncatePreviewText(text: string, max = 120): string {
  const cleaned = englishDisplayText(text);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
}
