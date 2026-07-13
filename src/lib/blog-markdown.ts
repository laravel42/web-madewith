/** Prepare factory article bodies for the site renderer. */
import { humanizeIsoTimestamps } from "./blog-dates";
export function prepareBlogBody(body: string, opts?: { heroImage?: string }): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length && !lines[i].trim()) i++;

  if (i < lines.length) {
    const cover = lines[i].trim().match(/^!\[[^\]]*\]\(\s*([^)]+)\s*\)$/);
    if (cover) {
      const src = cover[1].trim();
      if (!opts?.heroImage || src === opts.heroImage || /cover/i.test(src)) {
        i++;
        while (i < lines.length && !lines[i].trim()) i++;
      }
    }
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "Executive summary") {
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

    if (/^Article metadata and SEO fields/i.test(trimmed)) {
      break;
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

  const flushList = () => {
    if (!listBuf.length) return;
    const tag = listOrdered ? "ol" : "ul";
    out.push(`<${tag}>${listBuf.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    listBuf = [];
    listOrdered = false;
  };

  const flushCode = () => {
    if (!codeBuf.length) return;
    const lang = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    out.push(`<pre><code${lang}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
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
      flushList();
      const alt = escapeHtml(image[1].trim());
      const src = escapeHtml(image[2].trim());
      out.push(`<figure><img src="${src}" alt="${alt}" loading="lazy" decoding="async" />${alt ? `<figcaption>${alt}</figcaption>` : ""}</figure>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (!listOrdered && listBuf.length) flushList();
      listOrdered = true;
      listBuf.push(ordered[1]);
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (listOrdered && listBuf.length) flushList();
      listBuf.push(trimmed.slice(2));
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
    const id = slugify(text);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label: text });
  }

  return items;
}

function calloutLabel(type: string): string {
  if (type === "tip") return "Tip";
  if (type === "warning") return "Warning";
  return "Note";
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

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = String(href).trim();
    if (/^https?:\/\//i.test(safeHref) || safeHref.startsWith("/") || safeHref.startsWith("#")) {
      return `<a href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`;
    }
    return escapeHtml(label);
  });
  return out
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
