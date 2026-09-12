import { marked } from "marked";

/**
 * Raw HTML in the Markdown is dropped, keeping its text content.
 *
 * Every caller of renderArticle renders model-written text (project READMEs,
 * video summaries and transcripts), and `set:html` puts the result straight
 * into the page. One generated README contained a stray `</div>`, which closed
 * the detail page's README column early and threw the whole sidebar out of the
 * grid. Tags are separate tokens from the text they wrap, so stripping them
 * loses no words.
 */
marked.use({
  renderer: {
    html: () => "",
  },
});

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
