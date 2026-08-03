/** Prepare factory article bodies for the site renderer. */
import { humanizeIsoTimestamps } from "./blog-dates";

export function isFactoryCoverImage(src: string, heroImage?: string): boolean {
  const normalized = src.trim();
  if (!normalized) return false;
  if (heroImage && normalized === heroImage.trim()) return true;
  return /-cover\.(?:jpe?g|webp|png)(?:\?.*)?$/i.test(normalized);
}

export function prepareBlogBody(body: string, opts?: { heroImage?: string }): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length && !lines[i].trim()) i++;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    const cover = trimmed.match(/^!\[[^\]]*\]\(\s*([^)]+)\s*\)$/);
    if (cover && isFactoryCoverImage(cover[1], opts?.heroImage)) {
      i++;
      continue;
    }

    if (isFactorySectionLabel(trimmed)) {
      i++;
      continue;
    }

    if (/^Generated\/checked data/i.test(trimmed)) {
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === "Table of contents" || t.startsWith("## ") || t === "---") break;
        i++;
      }
      continue;
    }

    if (trimmed === "Table of contents") {
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === "---" || t.startsWith("## ") || t.startsWith("> [!")) break;
        i++;
      }
      continue;
    }

    if (trimmed === "## Table of contents") {
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === "---" || (t.startsWith("## ") && t !== "## Table of contents") || t.startsWith("> [!")) break;
        i++;
      }
      continue;
    }

    if (/^## Frequently asked questions$/i.test(trimmed)) {
      out.push("## FAQ");
      i++;
      continue;
    }

    if (isSeoBlockStart(trimmed)) {
      i = skipSeoBlock(lines, i + 1);
      continue;
    }

    // Factory articles often ship the same Q&A twice: a numbered "## FAQs" block
    // followed by a prose "## FAQ" section. Keep the latter for cleaner rendering.
    if (trimmed === "## FAQs") {
      const hasFaqSection = lines.slice(i + 1).some((line) => line.trim() === "## FAQ");
      if (hasFaqSection) {
        i++;
        while (i < lines.length && lines[i].trim() !== "## FAQ") i++;
        continue;
      }
    }

    out.push(lines[i]);
    i++;
  }

  return humanizeIsoTimestamps(out.join("\n").trim());
}

/** Minimal markdown → HTML for blog article bodies. */
export function renderBlogMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let listBuf: string[] = [];
  let listOrdered = false;
  let tableBuf: string[] = [];
  let calloutBuf: string[] = [];
  let calloutType = "";
  let inSeoBlock = false;

  const flushList = () => {
    if (!listBuf.length) return;
    const tag = listOrdered ? "ol" : "ul";
    out.push(`<${tag}>${listBuf.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    listBuf = [];
    listOrdered = false;
  };

  const flushCode = () => {
    if (!codeBuf.length) return;
    const content = codeBuf.join("\n");
    if (isJsonLdCode(content, codeLang)) {
      codeBuf = [];
      codeLang = "";
      return;
    }
    const lang = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    out.push(`<pre><code${lang}>${escapeHtml(content)}</code></pre>`);
    codeBuf = [];
    codeLang = "";
  };

  const flushCallout = () => {
    if (!calloutBuf.length) return;
    const type = calloutType || "note";
    out.push(
      `<aside class="callout callout-${type}"><strong>${calloutLabel(type)}</strong><p>${calloutBuf.map((line) => inline(line)).join(" ")}</p></aside>`,
    );
    calloutBuf = [];
    calloutType = "";
  };

  const flushTable = () => {
    if (tableBuf.length < 2) {
      for (const row of tableBuf) out.push(`<p>${inline(row)}</p>`);
      tableBuf = [];
      return;
    }
    const rows = tableBuf.filter((row) => !/^\|?[\s|:-]+\|?$/.test(row.replace(/\s/g, "")));
    if (!rows.length) {
      tableBuf = [];
      return;
    }
    const parseRow = (row: string) =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    const [head, ...body] = rows;
    const headCells = parseRow(head);
    out.push("<table><thead><tr>" + headCells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
    for (const row of body) {
      const cells = parseRow(row);
      out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
    }
    out.push("</tbody></table>");
    tableBuf = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.startsWith("```")) {
      flushList();
      flushTable();
      flushCallout();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushTable();
      flushCallout();
      continue;
    }

    if (inSeoBlock) {
      if (trimmed.startsWith("## ") && !isSeoSectionHeading(line)) {
        inSeoBlock = false;
      } else {
        continue;
      }
    }

    if (isSeoBlockStart(trimmed)) {
      flushList();
      flushTable();
      flushCallout();
      inSeoBlock = true;
      continue;
    }

    if (isSeoMetadataLine(trimmed)) continue;

    if (trimmed === "---") continue;

    const calloutMarker = trimmed.match(/^(?:>\s*)?\[!(NOTE|TIP|WARNING)\]$/i);
    if (calloutMarker) {
      flushList();
      flushTable();
      flushCallout();
      calloutType = calloutMarker[1].toLowerCase();
      continue;
    }

    if (calloutType) {
      const quoted = trimmed.match(/^>\s?(.*)$/);
      calloutBuf.push(quoted ? quoted[1] : trimmed);
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushList();
      flushCallout();
      tableBuf.push(trimmed);
      continue;
    }

    if (tableBuf.length) flushTable();

    if (trimmed.startsWith("### ")) {
      flushList();
      const text = trimmed.slice(4).trim();
      const id = slugify(text);
      out.push(`<h3 id="${id}">${inline(text)}</h3>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushList();
      if (isFaqHeading(trimmed)) {
        const faqLines: string[] = [];
        while (index + 1 < lines.length) {
          const next = lines[index + 1].trim();
          if (next.startsWith("## ")) break;
          faqLines.push(lines[++index]);
        }
        out.push(renderFaqSection(parseFaqItems(faqLines)));
        continue;
      }
      if (isSeoMetaHeading(trimmed) || isJsonLdHeading(trimmed)) {
        inSeoBlock = true;
        index = skipSeoBlock(lines, index + 1) - 1;
        continue;
      }
      const text = trimmed.slice(3).trim();
      const id = slugify(text);
      out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushList();
      const text = trimmed.slice(2).trim();
      const id = slugify(text);
      out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushList();
      out.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(\s*([^)]+?)\s*\)$/);
    if (image) {
      const src = image[2].trim();
      if (isFactoryCoverImage(src)) continue;
      flushList();
      const alt = escapeHtml(image[1].trim());
      const safeSrc = escapeHtml(src);
      out.push(`<figure><img src="${safeSrc}" alt="${alt}" loading="lazy" decoding="async" />${alt ? `<figcaption>${alt}</figcaption>` : ""}</figure>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (isSeoMetadataLine(ordered[1])) continue;
      if (!listOrdered && listBuf.length) flushList();
      listOrdered = true;
      listBuf.push(ordered[1]);
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const item = trimmed.slice(2);
      if (isSeoMetadataLine(item)) continue;
      if (listOrdered && listBuf.length) flushList();
      listBuf.push(item);
      continue;
    }

    flushList();
    out.push(`<p>${inline(trimmed)}</p>`);
  }

  flushList();
  flushTable();
  flushCallout();
  if (inCode) flushCode();

  return out.join("\n");
}

export function blogTocFromMarkdown(source: string): Array<{ id: string; label: string }> {
  const prepared = prepareBlogBody(source);
  const seen = new Set<string>();
  const items: Array<{ id: string; label: string }> = [];

  for (const line of prepared.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("## ") || trimmed.startsWith("### ")) continue;
    const text = trimmed.slice(3).trim();
    if (/^table of contents$/i.test(text)) continue;
    if (isSeoTocHeading(text)) continue;
    const id = slugify(text);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label: text });
  }

  return items;
}

function isFactorySectionLabel(trimmed: string): boolean {
  if (!trimmed || /^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*>\d|!`]|^```/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  const exact = new Set([
    "executive summary",
    "executive answer",
    "facts",
    "evidence",
    "evidence used",
    "limitations",
    "meta",
    "open graph fields",
    "observed facts",
    "selection risks",
    "execution notes",
    "operational notes",
    "operational monitoring",
    "measurement boundaries",
    "workload categories",
    "caching strategies",
    "concurrency considerations",
    "capacity planning",
    "instrumentation data collection",
    "detecting remote slowness",
    "core metrics to capture",
    "recommended ci tiers",
    "affected-range table",
    "facts from repositories",
    "inferred trade-offs",
    "inferred guidance",
    "how to interpret these signals",
  ]);
  if (exact.has(lower)) return true;

  return [
    /^inferred\b/i,
    /^assumptions\b/i,
    /^evidence used\b/i,
    /^article (metadata|schema)\b/i,
    /^schema \(article\b/i,
    /^designing ci checks\b/i,
    /^representative test harness\b/i,
    /^assumptions and\b/i,
  ].some((pattern) => pattern.test(trimmed));
}

function calloutLabel(type: string): string {
  if (type === "tip") return "Tip";
  if (type === "warning") return "Warning";
  return "Note";
}

type FaqItem = { question: string; answerParts: string[] };

function isFaqHeading(line: string): boolean {
  const text = line.trim().slice(3).trim();
  return /^(faq|faqs|frequently asked questions)$/i.test(text);
}

function parseFaqItems(lines: string[]): FaqItem[] {
  const items: FaqItem[] = [];
  let current: FaqItem | null = null;

  const pushCurrent = () => {
    if (current?.question) items.push(current);
    current = null;
  };

  const startItem = (question: string) => {
    pushCurrent();
    current = { question: question.trim(), answerParts: [] };
  };

  const appendAnswer = (answer: string) => {
    if (!current) startItem("");
    current!.answerParts.push(answer.trim());
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line === "---") continue;

    const normalized = line.replace(/^[-*]\s+/, "");
    if (isSeoBlockStart(normalized) || isSeoBlockStart(line) || isSeoMetadataLine(line)) {
      pushCurrent();
      break;
    }

    if (line.startsWith("### ")) {
      startItem(line.slice(4));
      continue;
    }

    const combined = line.match(/^(?:\d+\.\s*)?(?:-\s*)?Q:\s*(.+?)\s+A:\s*(.+)$/i);
    if (combined) {
      startItem(combined[1]);
      appendAnswer(combined[2]);
      continue;
    }

    const question = line.match(/^(?:\d+\.\s*)?(?:-\s*)?Q:\s*(.+)$/i);
    if (question) {
      startItem(question[1]);
      continue;
    }

    const answer = line.match(/^(?:\d+\.\s*)?(?:-\s*)?A:\s*(.+)$/i);
    if (answer) {
      if (!current) startItem("");
      appendAnswer(answer[1]);
      continue;
    }

    if (current) appendAnswer(line);
  }

  pushCurrent();
  return items;
}

function renderFaqSection(items: FaqItem[]): string {
  // Native <details>: answers are hidden until the question is toggled,
  // keyboard-accessible without any client JS.
  const body = items
    .map((item) => {
      const answer = item.answerParts.join(" ").trim();
      return `<details class="blog-faq-item"><summary class="blog-faq-question">${inline(item.question)}</summary><p class="blog-faq-answer">${inline(answer)}</p></details>`;
    })
    .join("");
  return `<section class="blog-faq"><h2 id="faq">FAQ</h2><div class="blog-faq-list">${body}</div></section>`;
}

function isSeoMetaHeading(line: string): boolean {
  if (!line.trim().startsWith("## ")) return false;
  return isSeoMetaHeadingText(line.trim().slice(3).trim());
}

function isJsonLdHeading(line: string): boolean {
  if (!line.trim().startsWith("## ")) return false;
  return isJsonLdHeadingText(line.trim().slice(3).trim());
}

function isSeoTocHeading(text: string): boolean {
  return isSeoMetaHeadingText(text) || isJsonLdHeadingText(text);
}

function isSeoMetaHeadingText(text: string): boolean {
  if (/^(what|at-a-glance|core repository|repository snapshot|evidence|architectural conclusions)/i.test(text)) {
    return false;
  }
  if (/cannot be concluded from public metadata/i.test(text)) return false;
  if (/visual data \(project metadata\)/i.test(text)) return false;

  return (
    /^article\s+(metadata|seo)\b/i.test(text) ||
    /^(open graph|seo\b)/i.test(text) ||
    /machine-readable block/i.test(text) ||
    /canonical url.*schema/i.test(text) ||
    /\bseo\s*[&:]/i.test(text) ||
    /metadata.*\bseo\b/i.test(text) ||
    /publishing metadata/i.test(text)
  );
}

function unlistLine(trimmed: string): string {
  return trimmed.replace(/^(?:[-*]\s+)+/, "").trim();
}

/** Factory editorial metadata lines — never show in article prose. */
function isSeoMetadataLine(trimmed: string): boolean {
  const line = unlistLine(trimmed);
  if (!line) return false;

  if (/^(search intent|primary keyphrase|secondary keyphrases?)\s*:/i.test(line)) return true;
  if (/^canonical(\s+url)?(\s*\([^)]*\))?\s*:/i.test(line)) return true;
  if (/^open graph(\s+(title|description|image|url|type|site_name|suggestion))?\s*:/i.test(line)) return true;
  if (/^article schema\b/i.test(line)) return true;
  if (/^og:/i.test(line)) return true;
  if (/^article:/i.test(line)) return true;
  if (/^primary_keyphrase:/i.test(line)) return true;
  if (/^<meta\s/i.test(line)) return true;

  if (/^[\[{]/.test(line)) return true;
  if (/^"@context"/.test(line)) return true;
  if (/^"@type"/.test(line)) return true;
  if (/^"[\w@]+"\s*:/.test(line)) return true;
  if (/^[\]},]\s*,?\s*$/.test(line)) return true;

  return false;
}

function isJsonLdCode(content: string, lang: string): boolean {
  return (lang === "json" || lang === "") && /"@context"/.test(content) && /schema\.org/i.test(content);
}

function isJsonLdHeadingText(text: string): boolean {
  return /^article schema/i.test(text) || (/json-ld/i.test(text) && /\bschema\b/i.test(text));
}

function isSeoSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("## ")) return false;
  const text = trimmed.slice(3).trim();
  return isSeoMetaHeadingText(text) || isJsonLdHeadingText(text);
}

function isSeoBlockStart(trimmed: string): boolean {
  if (isSeoSectionHeading(trimmed)) return true;
  if (/^article\s+(metadata|seo)\b/i.test(trimmed)) return true;
  if (/^seo\s*[&:]/i.test(trimmed)) return true;
  if (/^open graph\b/i.test(trimmed)) return true;
  return trimmed.startsWith("<!--") && /(?:seo|open graph|article schema|canonical|structured data|metadata|json-ld)/i.test(trimmed);
}

function isSeoBlockContinuation(trimmed: string): boolean {
  if (!trimmed) return true;
  if (trimmed === "---") return true;
  if (trimmed.startsWith("<!--")) return true;
  if (/^```json/.test(trimmed) || trimmed === "```") return true;
  return isSeoMetadataLine(trimmed);
}

function skipSeoBlock(lines: string[], startIndex: number): number {
  let i = startIndex;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith("## ") && !isSeoSectionHeading(lines[i])) break;
    if (!t) {
      i++;
      continue;
    }
    if (!isSeoBlockContinuation(t) && !isSeoSectionHeading(lines[i])) break;
    i++;
  }
  return i;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkAttrs(href: string): string {
  if (href.startsWith("#")) return "";
  return ' target="_blank" rel="noopener noreferrer"';
}

function autolinkUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s<>"']+)/g, (match) => {
    const trimmed = match.replace(/[),.;:\]]+$/, "");
    const trailing = match.slice(trimmed.length);
    return `<a href="${trimmed}"${linkAttrs(trimmed)}>${trimmed}</a>${trailing}`;
  });
}

function inline(text: string): string {
  let out = escapeHtml(text);
  const savedAnchors: string[] = [];
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = String(href).trim();
    if (/^https?:\/\//i.test(safeHref) || safeHref.startsWith("/") || safeHref.startsWith("#")) {
      return `<a href="${escapeHtml(safeHref)}"${linkAttrs(safeHref)}>${escapeHtml(label)}</a>`;
    }
    return escapeHtml(label);
  });
  out = out.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
    savedAnchors.push(anchor);
    return `\x00A${savedAnchors.length - 1}\x00`;
  });
  out = autolinkUrls(out);
  out = out.replace(/\x00A(\d+)\x00/g, (_m, index) => savedAnchors[Number(index)]);
  return out
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
