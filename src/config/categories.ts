/** The six catalog categories, shared across every domain. */
export const CATEGORY_META: Record<string, { blurb: string }> = {
  "Dashboards": { blurb: "Admin panels, analytics & internal tools." },
  "E-commerce": { blurb: "Storefronts, carts & checkout flows." },
  "UI Kits": { blurb: "Component libraries & design systems." },
  "Blogs": { blurb: "Content sites & publishing engines." },
  "DevTools": { blurb: "CLIs, monitors & developer utilities." },
  "Docs": { blurb: "Documentation & knowledge bases." },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_META);

/** Tag filter order (categories prefixed with the "All" pill). */
export const TAG_ORDER = ["All", ...CATEGORY_ORDER];
