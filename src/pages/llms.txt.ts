import type { APIRoute } from "astro";
import { buildNetworkLlmsTxt } from "../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const body = buildNetworkLlmsTxt(site ?? new URL("https://madewithwhat.net"));
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
