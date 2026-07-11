/** Deterministic category classification (workflow 04 is rule-based, not LLM by default). */
export const CATEGORIES = ["Dashboards", "E-commerce", "UI Kits", "Blogs", "DevTools", "Docs"] as const;
export type Category = (typeof CATEGORIES)[number];

const RULES: Array<[Category, string[]]> = [
  ["E-commerce", ["ecommerce", "e-commerce", "commerce", "shop", "store", "cart", "checkout", "stripe", "payment", "marketplace"]],
  ["Dashboards", ["dashboard", "admin", "analytics", "panel", "backoffice", "back-office", "metrics", "monitoring"]],
  ["Docs", ["docs", "documentation", "handbook", "knowledge", "wiki"]],
  ["Blogs", ["blog", "cms", "content", "markdown", "mdx", "publishing", "newsletter", "portfolio"]],
  ["UI Kits", ["ui", "component", "components", "design-system", "design", "kit", "tailwind", "css", "theme", "template", "starter", "boilerplate"]],
  ["DevTools", ["cli", "devtool", "developer", "tool", "tools", "monitor", "lint", "build", "bundler", "framework", "api", "sdk", "plugin", "generator"]],
];

export function classify(input: { topics?: string[]; description?: string | null; name?: string }): Category {
  const hay = `${(input.topics || []).join(" ")} ${input.description || ""} ${input.name || ""}`.toLowerCase();
  for (const [cat, kws] of RULES) if (kws.some((k) => hay.includes(k))) return cat;
  return "DevTools";
}
