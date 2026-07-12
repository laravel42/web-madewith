import type { APIRoute } from "astro";
import { DOMAINS, type Theme } from "../../config/domains";
import { getCatalog } from "../../lib/catalog";
import { buildRssXml } from "../../lib/feed";

export function getStaticPaths() {
  return DOMAINS.map((theme) => ({ params: { domain: theme.slug }, props: { theme } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const theme = (props as { theme: Theme }).theme;
  const data = getCatalog(theme.slug);
  const xml = buildRssXml(theme, data, site ?? new URL("https://madewithwhat.net"));
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
