import type { APIRoute } from "astro";
import { DOMAINS, type Theme } from "../../config/domains";
import { renderOgPng } from "../../lib/og-image";

export const prerender = true;

// One branded 1200×630 card per domain. Project and gallery pages reference their
// domain card so every catalog page ships a valid, non-SVG social image.
export function getStaticPaths() {
  return DOMAINS.map((theme) => ({ params: { domain: theme.slug }, props: { theme } }));
}

export const GET: APIRoute = async ({ props }) => {
  const theme = (props as { theme: Theme }).theme;
  const png = await renderOgPng({
    title: `Made with ${theme.techName}`,
    eyebrow: "Made with",
    subtitle: theme.seoDescription,
    accent: theme.accent,
    accentInk: theme.accentInk,
    bg: "#12161a",
    ink: "#ffffff",
    glyph: theme.techName.charAt(0),
    domain: theme.domain,
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
