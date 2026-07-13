import sharp from "sharp";

export interface OgImageOptions {
  /** Big headline, e.g. "Made with Nuxt". */
  title: string;
  /** One-line supporting copy under the title. */
  subtitle?: string;
  /** Small eyebrow above the title. */
  eyebrow?: string;
  /** Brand accent colour (hex or css color). */
  accent?: string;
  /** Ink colour for the accent chip. */
  accentInk?: string;
  /** Page background. */
  bg?: string;
  /** Foreground text colour. */
  ink?: string;
  /** Single glyph shown in the brand chip (defaults to first letter of title). */
  glyph?: string;
  /** Footer domain label, e.g. "madewithnuxt.com". */
  domain?: string;
}

const WIDTH = 1200;
const HEIGHT = 630;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Truncate to a sensible single-line length for the OG canvas. */
function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function buildSvg(o: OgImageOptions): string {
  const accent = o.accent || "#2F6FEB";
  const accentInk = o.accentInk || "#ffffff";
  const bg = o.bg || "#12161a";
  const ink = o.ink || "#ffffff";
  const glyph = (o.glyph || o.title.replace(/^made with\s+/i, "").charAt(0) || "M").toUpperCase();
  const eyebrow = o.eyebrow ? esc(clamp(o.eyebrow, 42)).toUpperCase() : "";
  const title = esc(clamp(o.title, 30));
  const subtitle = o.subtitle ? esc(clamp(o.subtitle, 78)) : "";
  const domain = o.domain ? esc(clamp(o.domain, 40)) : "madewithwhat.net";
  const sub = ink === "#ffffff" || ink.toLowerCase() === "#fff" ? "rgba(255,255,255,0.66)" : "rgba(20,22,26,0.6)";

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="88%" cy="8%" r="70%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${bg}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${WIDTH}" height="10" fill="${accent}"/>
  <g font-family="Helvetica, Arial, sans-serif">
    <rect x="80" y="86" width="78" height="78" rx="18" fill="${accent}"/>
    <text x="119" y="141" font-size="44" font-weight="700" fill="${accentInk}" text-anchor="middle">${esc(glyph)}</text>
    ${eyebrow ? `<text x="176" y="118" font-size="22" font-weight="700" letter-spacing="3" fill="${accent}">${eyebrow}</text>` : ""}
    <text x="176" y="150" font-size="24" font-weight="600" fill="${sub}">${domain}</text>
    <text x="80" y="360" font-size="96" font-weight="800" fill="${ink}" letter-spacing="-3">${title}</text>
    ${subtitle ? `<text x="80" y="430" font-size="34" font-weight="500" fill="${sub}">${subtitle}</text>` : ""}
    <text x="80" y="560" font-size="24" font-weight="600" fill="${sub}">The MadeWithWhat network · Updated daily · Ranked by GitHub stars</text>
  </g>
</svg>`;
}

/** Render a 1200×630 PNG OG card as a Buffer. */
export async function renderOgPng(o: OgImageOptions): Promise<Buffer> {
  const svg = buildSvg(o);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
