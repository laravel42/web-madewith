import type { APIRoute } from "astro";
import { getArticles } from "../lib/blog";

/** Machine-readable blog index — one line per article (AI crawlers + the chat bot). */
export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://madewithwhat.net");
  const lines = [
    "# MadeWithWhat blog — all articles",
    "",
    `- Blog: ${new URL("/blog/", base).href}`,
    `- Articles: ${getArticles().length}`,
    "",
    ...getArticles()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((a) => {
        const link = new URL(`/blog/${a.slug}/`, base).href;
        const techs = [a.primaryTechnology, a.secondaryTechnology].filter(Boolean).join(", ");
        return `- [${a.title}](${link}): ${a.description} (${a.date}, ${techs || a.category})`;
      }),
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
