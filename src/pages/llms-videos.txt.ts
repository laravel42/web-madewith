import type { APIRoute } from "astro";
import { allVideoEntries } from "../lib/videos";
import { videoSlug } from "../lib/video-view";
import { videoDisplayTitle, videoDisplayDescription } from "../lib/preview-text";

/** Machine-readable video index — one line per curated video (AI crawlers + the chat bot). */
export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://madewithwhat.net");
  const entries = allVideoEntries();
  const lines = [
    "# MadeWithWhat videos — all curated tutorials",
    "",
    `- Video index: ${new URL("/video/", base).href}`,
    `- Videos: ${entries.length}`,
    "",
    ...entries.map((e) => {
      const v = e.video;
      const link = new URL(`/video/${videoSlug(v)}/`, base).href;
      const desc = (videoDisplayDescription(v.description ?? "", v.title) || "").slice(0, 180);
      return `- [${videoDisplayTitle(v.title, v.description ?? "")}](${link}): ${desc} (${e.techName}, ${v.duration}, ${v.views.toLocaleString()} views, by ${v.channel ?? "unknown"})`;
    }),
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
