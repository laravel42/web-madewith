import type { APIRoute } from "astro";
import { getArticles } from "../../lib/blog";
import { buildArticlesRssXml } from "../../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL("https://madewithwhat.net");
  const xml = buildArticlesRssXml(getArticles(), origin);
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
