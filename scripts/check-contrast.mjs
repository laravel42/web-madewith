/**
 * Contrast regression check.
 *
 * Scans the built site in dist/ for text/background pairs and grades them
 * against WCAG 2.1 AA. This catches the class of bug that keeps recurring here:
 * a per-tech brand accent (or a dark-theme grey) used as text on a surface it
 * was never measured against.
 *
 * Run after `npm run build`:  node scripts/check-contrast.mjs
 * Exits non-zero if any pair falls below its threshold.
 *
 * Scope, so the green tick is not read as more than it is: this only sees
 * INLINE `style="color:…"` declarations in the built HTML — which is where this
 * codebase puts most of its per-theme colour. Rules that live in <style> blocks
 * or in a .css file are not resolved here, and neither are :hover/:focus states.
 * It is a regression net for the accent-as-text bug, not a full audit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;

// ---------- colour maths ----------
const parse = (hex) => {
  const h = String(hex).trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const lum = (rgb) =>
  rgb
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    })
    .reduce((s, c, i) => s + [0.2126, 0.7152, 0.0722][i] * c, 0);
const ratio = (fg, bg) => {
  const [a, b] = [lum(parse(fg)), lum(parse(bg))];
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

// ---------- fallback surfaces ----------
// Used only when the declaration carries no background of its own. These are
// the PAGE and CARD surfaces, which is what un-backgrounded text actually sits
// on. Deliberately not including chip/panel tints (#f2f4f6, #f6f7f9, …): those
// always come with an explicit background, and assuming them here produced
// false positives on text that really sits on white.
const LIGHT_SURFACES = ["#ffffff", "#fbfcfb", "#f7f4ee"];
const DARK_SURFACES = ["#0c0f0e", "#080b0a", "#101410", "#0a0d0c", "#000000"];

/** A colour is "light text" if it is closer to white than to black. */
const isLight = (hex) => lum(parse(hex)) > 0.18;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Pull `color:#xxx` out of inline styles along with the font-size in the same
// declaration block, so we can apply the large-text threshold correctly.
const DECL = /style="([^"]*)"/g;

function auditFile(path) {
  const html = readFileSync(path, "utf8");
  const findings = [];
  let m;
  while ((m = DECL.exec(html))) {
    const decl = m[1];
    const color = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,8})/.exec(decl);
    if (!color) continue;
    const fg = color[1];
    const sizeMatch = /font-size:\s*([\d.]+)px/.exec(decl);
    const px = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
    const bold = /font-weight:\s*(600|700|800|900|bold)/.test(decl);
    const need = px >= 24 || (bold && px >= 18.66) ? 3.0 : 4.5;

    // An explicit background in the same block is the real surface; otherwise
    // grade against the worst plausible surface for that ink's polarity.
    const bgMatch = /background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/.exec(decl);
    let surfaces;
    if (bgMatch) surfaces = [bgMatch[1]];
    else surfaces = isLight(fg) ? DARK_SURFACES : LIGHT_SURFACES;

    // Worst case across the candidate surfaces.
    let worst = Infinity;
    let worstBg = null;
    for (const bg of surfaces) {
      const r = ratio(fg, bg);
      if (r < worst) { worst = r; worstBg = bg; }
    }
    if (worst < need) {
      findings.push({ fg, bg: worstBg, px, bold, ratio: +worst.toFixed(2), need });
    }
  }
  return findings;
}

const files = walk(DIST);
const byPair = new Map();
let total = 0;
for (const f of files) {
  for (const x of auditFile(f)) {
    total++;
    const key = `${x.fg}|${x.bg}|${x.px}|${x.bold}`;
    if (!byPair.has(key)) byPair.set(key, { ...x, count: 0, sample: f.replace(DIST, "") });
    byPair.get(key).count++;
  }
}

const rows = [...byPair.values()].sort((a, b) => a.ratio - b.ratio);
console.log(`scanned ${files.length} built pages`);
if (rows.length === 0) {
  console.log("✅ no inline text/background pair falls below WCAG AA");
  process.exit(0);
}
console.log(`❌ ${rows.length} distinct failing pairs (${total} occurrences):\n`);
for (const r of rows) {
  console.log(
    `  ${String(r.ratio).padStart(5)}:1 (need ${r.need})  ${r.fg} on ${r.bg}  ${r.px}px${r.bold ? " bold" : ""}` +
      `  ×${r.count}  e.g. ${r.sample}`
  );
}
process.exit(1);
