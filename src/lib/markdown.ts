import { marked } from "marked";

const CALLOUTS: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

/** Render an article's Markdown to HTML, upgrading GitHub-style callouts. */
export function renderArticle(md: string): string {
  if (!md?.trim()) return "";
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/gi,
    (_m, type: string) => {
      const key = type.toUpperCase();
      return `<blockquote class="callout callout-${key.toLowerCase()}"><p class="callout-title">${CALLOUTS[key] ?? key}</p><p>`;
    },
  );
}
