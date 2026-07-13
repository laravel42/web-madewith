import type { APIRoute } from "astro";
import { buildProjectsRssXml } from "../../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const xml = buildProjectsRssXml(site ?? new URL("https://madewithwhat.net"));
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
