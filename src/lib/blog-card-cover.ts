export type BlogCardCoverInput = {
  tech: { accent: string; accentInk: string };
  primaryTechnology: string;
  category: string;
  title: string;
};

export function escapeHtmlForCard(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function blogCardCoverHtml(
  item: BlogCardCoverInput,
  opts?: { size?: "related" | "domain" | "featured" | "article"; variant?: 0 | 1 | 2 },
): string {
  const sizeClass = opts?.size && opts.size !== "featured" ? ` blog-card-cover-${opts.size}` : opts?.size === "featured" ? " blog-card-cover-featured" : "";
  const variantClass = opts?.variant === 1 ? " blog-card-cover--b" : opts?.variant === 2 ? " blog-card-cover--c" : "";
  const tech = escapeHtmlForCard(item.primaryTechnology);
  const category = escapeHtmlForCard(item.category);
  const title = escapeHtmlForCard(item.title);
  return `<div class="blog-card-cover${sizeClass}${variantClass}" style="--cover-accent:${item.tech.accent}; --cover-ink:${item.tech.accentInk};"><span class="blog-card-cover-tech">${tech}</span><span class="blog-card-cover-category">${category}</span><span class="blog-card-cover-title">${title}</span></div>`;
}
