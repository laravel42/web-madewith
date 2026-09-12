import type { Theme } from "../config/domains";
import { readableOnDark, readableOnLight, solidSurface } from "../config/accessible-color";

/**
 * The per-gallery wrapper class + CSS custom properties every themed component
 * (cards, buttons, pills) reads. CatalogLayout puts these on one page-level
 * wrapper; the network-wide author page puts them on each card individually,
 * because its cards come from different galleries.
 */
export function themeWrapperClass(theme: Theme): string {
  return `mw v-${theme.variant}${theme.editorial ? " is-editorial" : ""}`;
}

/** Token declarations only — no background/color, so a caller can decide
 *  whether the wrapper paints a surface (gallery page) or not (author page). */
export function themeTokens(theme: Theme): string {
  // soft accent tint differs between light (white base) and terminal (dark base)
  const softMix = theme.variant === "terminal" ? "22%, #0c0f0e" : "13%, #ffffff";
  // Bright brand colors (Haystack lime, React cyan, …) need darkening as text on
  // light UI — and lightening on the dark shells.
  const accentText = theme.darkShell ? readableOnDark(theme.accent) : readableOnLight(theme.accent);
  // Solid accent surfaces that carry --accentInk text (buttons, logo tile, active pills).
  const accentSolid = solidSurface(theme.accent, theme.accentInk);
  return (
    `--accent:${theme.accent}; --accentInk:${theme.accentInk}; --accent-text:${accentText}; ` +
    `--accent-solid:${accentSolid}; --radius:${theme.radius}px; --disp:${theme.dispFont}; ` +
    `--body:${theme.bodyFont}; --softMix:${softMix};`
  );
}

/** Tokens plus the gallery's own page surface — what CatalogLayout applies. */
export function themeWrapperStyle(theme: Theme): string {
  return `${themeTokens(theme)} background:${theme.bg}; color:${theme.ink};`;
}
