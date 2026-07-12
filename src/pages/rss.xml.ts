import type { APIRoute } from "astro";
import { buildNetworkRssXml } from "../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const xml = buildNetworkRssXml(site ?? new URL("https://madewithwhat.net"));
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
