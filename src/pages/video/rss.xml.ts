import type { APIRoute } from "astro";
import { buildVideosRssXml } from "../../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const xml = buildVideosRssXml(site ?? new URL("https://madewithwhat.net"));
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
