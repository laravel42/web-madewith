import type { APIRoute } from "astro";
import { renderOgPng } from "../lib/og-image";

export const prerender = true;

// Network-level default social card, used by the homepage, blog, and any page
// without a more specific OG image.
export const GET: APIRoute = async () => {
  const png = await renderOgPng({
    title: "MadeWithWhat",
    eyebrow: "Made with",
    subtitle: "Open-source project galleries for every stack",
    accent: "#2F6FEB",
    accentInk: "#ffffff",
    bg: "#12161a",
    ink: "#ffffff",
    glyph: "M",
    domain: "madewithwhat.net",
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
