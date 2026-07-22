/**
 * Public AI chat endpoint backing the site's ChatWidget
 * (POST /api/chat { sessionId, message } → SSE stream of {chunk}/{done}).
 *
 * Self-hosted RAG-lite, no chatbot vendor (replaces the broken Infobip
 * assistant): retrieval reads the site's own machine-readable exports
 * (per-domain llms-full.txt — one compact line per project), filters lines
 * against the question, and asks an LLM via OpenRouter to answer strictly
 * from that context. Env: OPENROUTER_API_KEY (required), CHAT_MODEL
 * (default google/gemini-2.5-flash), SITE_ORIGIN (where the built site is
 * served; default https://madewithwhat.net).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppEnv } from "./env";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MAX_MESSAGE = 1000;
const MAX_CONTEXT_CHARS = 24_000;

const encoder = new TextEncoder();
const sseEvent = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function sseOnce(obj: unknown): Response {
  return sseResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(sseEvent(obj));
        controller.close();
      },
    }),
  );
}

interface Tech { slug: string; techName: string; }
let techsCache: Tech[] | null = null;
function techs(): Tech[] {
  if (!techsCache) {
    const raw = readFileSync(join(REPO_ROOT, "src", "config", "domain-catalog.json"), "utf8");
    techsCache = (JSON.parse(raw) as Array<{ slug: string; techName: string }>).map((d) => ({
      slug: d.slug.toLowerCase(),
      techName: d.techName.toLowerCase(),
    }));
  }
  return techsCache;
}

function detectSlugs(message: string): string[] {
  const m = ` ${message.toLowerCase()} `;
  const hits: string[] = [];
  for (const t of techs()) {
    if (m.includes(` ${t.techName} `) || m.includes(` ${t.slug} `) || m.includes(`${t.slug}js`)) {
      hits.push(t.slug);
      if (hits.length === 2) break;
    }
  }
  return hits;
}

const STOP = new Set(["the","a","an","for","with","and","or","in","on","of","to","is","are","what","which","best","top","me","my","i","you","how","that","this","it","made","built","using","projects","project","open","source"]);
const keywords = (msg: string) =>
  (msg.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w));

const BLOG_WORDS = /\b(blog|article|articles|post|posts|read|guide|written|analysis|comparison)\b/i;
const VIDEO_WORDS = /\b(video|videos|watch|tutorial|tutorials|course|courses|talk|talks|transcript|transcripts|youtube|chapters?)\b/i;

/** Static site facts — always in context so newsletter/submission questions work. */
const SITE_FACTS = `## Site facts
- Newsletter: free; a network-wide list plus one per technology catalog. Sign up on /newsletter/ or any catalog's newsletter page with just an email.
- Submitting a project: every catalog has a /submit/ page; propose a public GitHub repository genuinely built with that technology. A moderator reviews it before publication. Private repos, unrelated projects, forks without original work, and content-only repos are rejected.
- Fixing project info: data mirrors GitHub daily — update the repository's description/topics/website and changes flow in automatically. For removal requests, use the catalog's /submit/ page with a note.
- Video pages include AI-generated chapters, a key-concepts summary, and a full literal transcription generated from captions (small errors possible).`;

async function buildContext(message: string): Promise<string> {
  const origin = (process.env.SITE_ORIGIN || "https://madewithwhat.net").replace(/\/+$/, "");
  const slugs = detectSlugs(message);
  const paths = slugs.length ? slugs.map((s) => `/${s}/llms-full.txt`) : ["/llms.txt"];
  if (BLOG_WORDS.test(message)) paths.push("/llms-blog.txt");
  if (VIDEO_WORDS.test(message)) paths.push("/llms-videos.txt");
  const words = keywords(message);
  const parts: string[] = [];

  for (const path of paths) {
    try {
      const res = await fetch(origin + path);
      if (!res.ok) continue;
      const lines = (await res.text()).split("\n");
      const head = lines.slice(0, 14).join("\n"); // title + About block
      const scored = lines
        .filter((l) => l.startsWith("- ["))
        .map((l) => ({ l, score: words.reduce((n, w) => n + (l.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score);
      const picked = [
        ...scored.filter((s) => s.score > 0).slice(0, 100),
        ...scored.filter((s) => s.score === 0).slice(0, 40),
      ].map((s) => s.l);
      parts.push(`${head}\n${picked.join("\n")}`);
    } catch { /* export unavailable — answer from what we have */ }
  }
  parts.push(SITE_FACTS);
  return parts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
}

const SYSTEM = `You are Watt, the MadeWithWhat assistant embedded on madewithwhat.net — a network of
"Made with [technology]" catalogs of open-source GitHub projects, curated video tutorials with
transcripts, and articles across 69 technologies.

Rules:
- Answer ONLY from the context provided. Never invent projects, star counts, or links.
- When you mention a project from the context, include its site link (markdown).
- Keep answers short: 1-3 sentences, or a bulleted list of max 5 items for "best/top" questions.
- Star counts refresh daily — present them as approximate.
- If the answer isn't in the context, say so and point to the closest page (/laravel/, /blog/, /video/).
- Technology names always mean the software (Express = Node framework, Astro = web framework).
- Friendly, precise, developer-to-developer. No hype, no emojis.
- Off-topic questions (politics, medical/legal advice, other websites): politely decline and steer
  back to the catalogs.`;

export async function handleChat(req: Request, env: AppEnv): Promise<Response> {
  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return sseOnce({ error: "Sorry, I couldn't read that request." });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return sseOnce({ error: "Please type a message first." });

  if (!env.openrouterApiKey) {
    return sseOnce({ error: "The assistant isn't configured yet. Set OPENROUTER_API_KEY on the server." });
  }

  const contextText = await buildContext(message);

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openrouterApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.CHAT_MODEL || "google/gemini-2.5-flash",
        stream: true,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Context from the catalogs:\n###\n${contextText}\n###\n\nVisitor question: **${message}**` },
        ],
      }),
    });
  } catch {
    return sseOnce({ error: "I couldn't reach the assistant right now. Please try again." });
  }

  if (upstream.status === 429) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": upstream.headers.get("Retry-After") ?? "30" },
    });
  }
  if (!upstream.ok || !upstream.body) {
    return sseOnce({ error: `The assistant returned an error (${upstream.status}). Please try again.` });
  }

  // Re-emit OpenRouter's SSE deltas in the widget's {chunk}/{done} shape.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return sseResponse(
    new ReadableStream({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const data = line.startsWith("data: ") ? line.slice(6).trim() : null;
              if (!data || data === "[DONE]") continue;
              try {
                const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) controller.enqueue(sseEvent({ chunk: delta }));
              } catch { /* keep-alive comments */ }
            }
          }
        } finally {
          controller.enqueue(sseEvent({ done: true }));
          controller.close();
        }
      },
    }),
  );
}
