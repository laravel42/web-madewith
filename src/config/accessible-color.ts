/**
 * Contrast-safe variants of a brand accent.
 *
 * Every domain in the network ships its own accent (src/config/engine-theme.ts).
 * Those are brand colours picked for fidelity, not legibility: Haystack lime
 * (#C6E42A) on white is 1.4:1, and white on OpenCart blue (#23A1D4) is 2.9:1.
 * Using them raw as text — or as the backdrop for text — fails WCAG AA badly.
 *
 * The rule of thumb across the codebase: the raw accent stays for fills,
 * borders, watermarks and gradient starts, where it never carries text. Anywhere
 * an accent meets a glyph, one of the helpers below derives a variant that is
 * guaranteed to clear 4.5:1 against the relevant surface.
 *
 * All four start from the tint the design already used and only move as far as
 * the threshold requires, so on accents that already passed the output is
 * unchanged (or nearly so).
 */

/** Darkest of the light surfaces text lands on (code chips, tab strips). */
const LIGHT_REF = "#f2f4f6";
/** Lightest of the dark surfaces text lands on (terminal input fields). */
const DARK_REF = "#121614";
const AA = 4.5;

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function mix(a: Rgb, b: Rgb, p: number): Rgb {
  return a.map((v, i) => v * p + b[i] * (1 - p)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string | Rgb, bg: string | Rgb): number {
  const a = luminance(typeof fg === "string" ? parse(fg) : fg);
  const b = luminance(typeof bg === "string" ? parse(bg) : bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Round to the 8-bit channels the colour will actually be emitted as. */
function quantize(rgb: Rgb): Rgb {
  return rgb.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Rgb;
}

/**
 * Walk `from` toward `toward` in 1% steps until it clears `target` against `bg`.
 * Each candidate is quantized first, so the colour that gets returned is the one
 * that was actually measured — rounding later would let a 4.4996 slip through.
 */
function pushUntil(from: Rgb, toward: Rgb, bg: string, target: number): Rgb {
  const start = quantize(from);
  if (contrast(start, bg) >= target) return start;
  for (let step = 1; step <= 100; step++) {
    const candidate = quantize(mix(toward, from, step / 100));
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return toward;
}

/**
 * Accent-coloured text on a light surface — nav links, tech labels, timecodes,
 * category names. Starts from the 45%-toward-ink tint the catalog already used
 * and darkens further only if that still falls short.
 */
export function readableOnLight(accent: string, target = AA): string {
  const base = mix(parse(accent), parse("#16202a"), 0.45);
  return toHex(pushUntil(base, [0, 0, 0], LIGHT_REF, target));
}

/**
 * `p`% of `color` over `base` — the hex equivalent of the `color-mix(in srgb,
 * C p%, base)` tints used for chip backgrounds. Needed because the contrast
 * maths has to run against a real colour, not a CSS function.
 */
export function tint(color: string, p: number, base = "#ffffff"): string {
  return toHex(mix(parse(color), parse(base), p / 100));
}

/**
 * A palette colour used as text on one specific known surface — category and
 * group chips, where the pill background is a tint of the same hue and the raw
 * colour lands around 2.5–4:1 on it. Darkens the colour just enough to clear AA
 * while keeping the hue, so the chip still reads as its category.
 */
export function readableOn(color: string, bg: string, target = AA): string {
  return toHex(pushUntil(parse(color), [0, 0, 0], bg, target));
}

/** As `readableOn`, but for a dark surface — lightens instead of darkening. */
export function readableOnSurfaceDark(color: string, bg: string, target = AA): string {
  return toHex(pushUntil(parse(color), [255, 255, 255], bg, target));
}

/**
 * Accent-coloured text on a dark (terminal) surface. Starts from the
 * 55%-toward-white tint the terminal variant already used.
 */
export function readableOnDark(accent: string, target = AA): string {
  const base = mix(parse(accent), parse("#ffffff"), 0.55);
  return toHex(pushUntil(base, [255, 255, 255], DARK_REF, target));
}

/**
 * A solid accent surface that carries `ink` text — primary buttons, logo tiles,
 * active pills, avatars. Shifts the accent away from the ink until the pair
 * clears AA, so the button keeps reading as the brand colour rather than
 * flipping the ink to black.
 */
export function solidSurface(accent: string, ink: string, target = AA): string {
  const a = parse(accent);
  if (contrast(a, ink) >= target) return toHex(a);
  // Move the surface away from the ink: darken under light ink, lighten under dark ink.
  const toward: Rgb = luminance(parse(ink)) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  return toHex(pushUntil(a, toward, ink, target));
}

/**
 * The light end of a cover/hero gradient that white text sits on (blog card
 * covers, article heroes, video hero). The dark end is already
 * `mix(accent, #111)`, so only this stop needs guarding.
 */
export function coverBase(accent: string, target = AA): string {
  return solidSurface(accent, "#ffffff", target);
}
