import type { APIRoute } from "astro";
import { DOMAINS, type Theme } from "../../config/domains";
import { getCatalog } from "../../lib/catalog";
import { buildLlmsFullTxt } from "../../lib/feed";

export function getStaticPaths() {
  return DOMAINS.map((theme) => ({ params: { domain: theme.slug }, props: { theme } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const theme = (props as { theme: Theme }).theme;
  const data = getCatalog(theme.slug);
  const body = buildLlmsFullTxt(theme, data, site ?? new URL("https://madewithwhat.net"));
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
