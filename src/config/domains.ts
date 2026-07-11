/**
 * Per-domain theme configuration — the whole "replicate per domain" model lives
 * here. Every MadeWith… site shares one engine (components, data pipeline, four
 * screens) and differs only by the tokens below: colour, logo letter, fonts,
 * shape language and a hero treatment. Cloning a domain = adding one entry.
 */

export type Variant = "light" | "terminal";
export type HeroId = "nuxt" | "node" | "next" | "ionic" | "statamic" | "twill";

export interface Theme {
  /** URL/data slug, e.g. "nuxt" → /nuxt and src/data/nuxt.json */
  slug: string;
  /** Display name, e.g. "Nuxt" */
  techName: string;
  /** The live domain this site ships to. */
  domain: string;
  /** Brand accent + readable ink on top of it. */
  accent: string;
  accentInk: string;
  /** Layout system. "light" covers minimal + editorial; "terminal" is Node. */
  variant: Variant;
  /** Editorial sub-mode of the light variant (masthead + ranked borderless grid). */
  editorial: boolean;
  /** Which bespoke hero to render. */
  heroId: HeroId;
  /** Font family CSS values. */
  dispFont: string;
  bodyFont: string;
  /** Google Fonts stylesheet href for this domain. */
  fontHref: string;
  /** Corner radius (px) for cards, inputs, buttons. */
  radius: number;
  /** Page background + base ink. */
  bg: string;
  ink: string;
  /** Sticky-header chrome (a signature identity element per domain). */
  headerBg: string;
  headerBorder: string;
  /** Footer chrome. */
  footerBg: string;
  footerBorder: string;
  /** Copy. */
  eyebrow: string;
  heroTitle: string;
  /** Editorial-only oversized headline (rendered as-is, may contain <br>). */
  heroHeadline?: string;
  /** Tint the card category chip with the brand accent (else neutral grey). */
  chipAccent?: boolean;
  tagline: string;
  /** SEO. */
  seoTitle: string;
  seoDescription: string;
}

const FONTS = {
  nuxt: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap",
  node: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
  next: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=swap",
  ionic: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap",
  statamic: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap",
  twill: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700;6..72,800&display=swap",
};

export const DOMAINS: Theme[] = [
  {
    slug: "nuxt",
    techName: "Nuxt",
    domain: "madewithnuxt.com",
    accent: "#00DC82",
    accentInk: "#04231a",
    variant: "light",
    editorial: false,
    heroId: "nuxt",
    dispFont: "'Sora', sans-serif",
    bodyFont: "'Hanken Grotesk', sans-serif",
    fontHref: FONTS.nuxt,
    radius: 14,
    bg: "radial-gradient(1100px 460px at 72% -10%, #cffbe9 0%, rgba(207,251,233,0) 62%), #fbfcfb",
    ink: "#16201b",
    headerBg: "rgba(251,252,251,.85)",
    headerBorder: "1px solid #ebeeec",
    footerBg: "#fff",
    footerBorder: "1px solid #ebeeec",
    eyebrow: "The Nuxt showcase",
    heroTitle: "Discover the best apps & sites built with Nuxt",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars.",
    seoTitle: "Made with Nuxt — the showcase of apps & sites built with Nuxt",
    seoDescription: "A curated, daily-updated gallery of the best open-source projects built with Nuxt, ranked by GitHub stars. Discover dashboards, UI kits, e-commerce, blogs and dev tools.",
  },
  {
    slug: "node",
    techName: "Node",
    domain: "madewithnode.com",
    accent: "#5FA04E",
    accentInk: "#04231a",
    variant: "terminal",
    editorial: false,
    heroId: "node",
    dispFont: "'Space Grotesk', sans-serif",
    bodyFont: "'JetBrains Mono', monospace",
    fontHref: FONTS.node,
    radius: 10,
    bg: "#0c0f0e",
    ink: "#c7d0ca",
    headerBg: "rgba(12,15,14,.88)",
    headerBorder: "1px solid #1c211e",
    footerBg: "#0a0d0c",
    footerBorder: "1px solid #1c211e",
    eyebrow: "// open-source projects indexed",
    heroTitle: "Real apps shipped with Node",
    tagline: "Indexed nightly from GitHub. Filter by category & stars — discover production repos worth reading.",
    seoTitle: "made-with-node — production apps & tools built with Node.js",
    seoDescription: "A nightly-indexed directory of real open-source projects built with Node.js, ranked by GitHub stars. Grep the ecosystem for dashboards, dev tools, UI kits and more.",
  },
  {
    slug: "next",
    techName: "Next",
    domain: "madewithnext.com",
    accent: "#0a0a0a",
    accentInk: "#ffffff",
    variant: "light",
    editorial: true,
    heroId: "next",
    dispFont: "'Bricolage Grotesque', sans-serif",
    bodyFont: "'Hanken Grotesk', sans-serif",
    fontHref: FONTS.next,
    radius: 2,
    bg: "#ffffff",
    ink: "#0a0a0a",
    headerBg: "rgba(255,255,255,.92)",
    headerBorder: "2px solid #0a0a0a",
    footerBg: "#fff",
    footerBorder: "1px solid #e8e8e8",
    eyebrow: "The Next showcase",
    heroTitle: "The definitive index of Next.js sites & apps in production",
    heroHeadline: "MADE WITH<br>NEXT.JS",
    tagline: "The definitive index of sites & apps in production, ranked by GitHub stars and shipped weekly.",
    seoTitle: "Made with Next.js — the definitive index of Next.js sites & apps",
    seoDescription: "The definitive, ranked index of production sites and apps built with Next.js. Browse the editorial gallery of the highest-starred open-source Next.js projects on GitHub.",
  },
  {
    slug: "ionic",
    techName: "Ionic",
    domain: "madewithionic.com",
    accent: "#3880FF",
    accentInk: "#ffffff",
    variant: "light",
    editorial: false,
    heroId: "ionic",
    dispFont: "'Poppins', sans-serif",
    bodyFont: "'Poppins', sans-serif",
    fontHref: FONTS.ionic,
    radius: 22,
    bg: "#fbfcfb",
    ink: "#16201b",
    headerBg: "rgba(244,248,255,.9)",
    headerBorder: "1px solid #e3ecfb",
    footerBg: "#fff",
    footerBorder: "1px solid #e3ecfb",
    eyebrow: "The Ionic showcase",
    heroTitle: "Discover the best apps built with Ionic",
    tagline: "A hand-curated, daily-updated gallery of open-source apps. Browse the ecosystem, ranked by GitHub stars.",
    seoTitle: "Made with Ionic — the showcase of mobile apps built with Ionic",
    seoDescription: "A curated, daily-updated gallery of the best open-source mobile & web apps built with Ionic, ranked by GitHub stars. Discover UI kits, dev tools and production apps.",
  },
  {
    slug: "statamic",
    techName: "Statamic",
    domain: "madewithstatamic.com",
    accent: "#7C3AED",
    accentInk: "#ffffff",
    variant: "light",
    editorial: false,
    heroId: "statamic",
    chipAccent: true,
    dispFont: "'Instrument Serif', serif",
    bodyFont: "'Manrope', sans-serif",
    fontHref: FONTS.statamic,
    radius: 10,
    bg: "radial-gradient(1000px 440px at 78% -10%, #ece3ff 0%, rgba(236,227,255,0) 60%), #fbfcfb",
    ink: "#16201b",
    headerBg: "rgba(251,250,255,.88)",
    headerBorder: "1px solid #ece7f6",
    footerBg: "#fff",
    footerBorder: "1px solid #ece7f6",
    eyebrow: "The Statamic showcase",
    heroTitle: "Discover the best sites built with Statamic",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Statamic — the showcase of sites built with Statamic",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and add-ons built with Statamic, ranked by GitHub stars. Discover CMS builds, UI kits and dev tools.",
  },
  {
    slug: "twill",
    techName: "Twill",
    domain: "madewithtwill.com",
    accent: "#F4503C",
    accentInk: "#ffffff",
    variant: "light",
    editorial: false,
    heroId: "twill",
    dispFont: "'Newsreader', serif",
    bodyFont: "'Hanken Grotesk', sans-serif",
    fontHref: FONTS.twill,
    radius: 5,
    bg: "#f7f4ee",
    ink: "#211d16",
    headerBg: "rgba(247,244,238,.92)",
    headerBorder: "2px solid #17140f",
    footerBg: "#f2efe7",
    footerBorder: "2px solid #17140f",
    eyebrow: "The Twill showcase",
    heroTitle: "Discover the best sites built with Twill",
    tagline: "A hand-curated, daily-updated gallery of open-source projects. Browse the ecosystem, ranked by GitHub stars — and find your next stack.",
    seoTitle: "Made with Twill — the showcase of sites built with Twill CMS",
    seoDescription: "A curated, daily-updated gallery of the best open-source sites and packages built with Twill, the Laravel CMS, ranked by GitHub stars. Discover CMS builds and dev tools.",
  },
];

export const DOMAIN_MAP: Record<string, Theme> = Object.fromEntries(DOMAINS.map((d) => [d.slug, d]));

export function getTheme(slug: string): Theme {
  const t = DOMAIN_MAP[slug];
  if (!t) throw new Error(`Unknown domain slug: ${slug}`);
  return t;
}
