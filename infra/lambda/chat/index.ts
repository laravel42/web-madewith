/**
 * Streaming AI chat endpoint — same RAG-lite design as server/src/chat.ts,
 * ported to a Lambda Function URL with response streaming (API Gateway
 * buffers responses, so it can't carry SSE; a Function URL can).
 */
import type { Context } from "aws-lambda";
import { isRateLimited } from "../shared/rate-limit";
import catalog from "../../../src/config/domain-catalog.json" with { type: "json" };

declare const awslambda: {
  streamifyResponse: (
    handler: (event: any, responseStream: NodeJS.WritableStream, context: Context) => Promise<void>,
  ) => (event: any, context: Context) => Promise<void>;
  HttpResponseStream: {
    from: (responseStream: NodeJS.WritableStream, metadata: { statusCode: number; headers?: Record<string, string> }) => NodeJS.WritableStream;
  };
};

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://madewithwhat.net").replace(/\/+$/, "");
// The Function URL is public (AuthType NONE) — CloudFront OAC/SigV4 on a
// RESPONSE_STREAM Function URL never reached the function in testing (403
// before invocation despite a correct resource policy). This header, set by
// CloudFront as a custom origin header (workers/utils/cloudfront/
// add_api_origins.py) and never exposed to browsers, is the real gate.
const CHAT_ORIGIN_SECRET = process.env.CHAT_ORIGIN_SECRET;

const MAX_MESSAGE = 1000;
const MAX_CONTEXT_CHARS = 24_000;

interface Tech { slug: string; techName: string; }
const TECHS: Tech[] = (catalog as Array<{ slug: string; techName: string }>).map((d) => ({
  slug: d.slug.toLowerCase(),
  techName: d.techName.toLowerCase(),
}));

function detectSlugs(message: string): string[] {
  const m = ` ${message.toLowerCase()} `;
  const hits: string[] = [];
  for (const t of TECHS) {
    if (m.includes(` ${t.techName} `) || m.includes(` ${t.slug} `) || m.includes(`${t.slug}js`)) {
      hits.push(t.slug);
      if (hits.length === 2) break;
    }
  }
  return hits;
}

const STOP = new Set(["the", "a", "an", "for", "with", "and", "or", "in", "on", "of", "to", "is", "are", "what", "which", "best", "top", "me", "my", "i", "you", "how", "that", "this", "it", "made", "built", "using", "projects", "project", "open", "source"]);
const keywords = (msg: string) => (msg.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w));

const BLOG_WORDS = /\b(blog|article|articles|post|posts|read|guide|written|analysis|comparison)\b/i;
const VIDEO_WORDS = /\b(video|videos|watch|tutorial|tutorials|course|courses|talk|talks|transcript|transcripts|youtube|chapters?)\b/i;

const SITE_FACTS = `## Site facts
- Newsletter: free; a network-wide list plus one per technology catalog. Sign up on /newsletter/ or any catalog's newsletter page with just an email.
- Submitting a project: every catalog has a /submit/ page; propose a public GitHub repository genuinely built with that technology. A moderator reviews it before publication. Private repos, unrelated projects, forks without original work, and content-only repos are rejected.
- Fixing project info: data mirrors GitHub daily — update the repository's description/topics/website and changes flow in automatically. For removal requests, use the catalog's /submit/ page with a note.
- Video pages include AI-generated chapters, a key-concepts summary, and a full literal transcription generated from captions (small errors possible).`;

async function buildContext(message: string): Promise<string> {
  const slugs = detectSlugs(message);
  const paths = slugs.length ? slugs.map((s) => `/${s}/llms-full.txt`) : ["/llms.txt"];
  if (BLOG_WORDS.test(message)) paths.push("/llms-blog.txt");
  if (VIDEO_WORDS.test(message)) paths.push("/llms-videos.txt");
  const words = keywords(message);
  const parts: string[] = [];

  for (const path of paths) {
    try {
      const res = await fetch(SITE_ORIGIN + path);
      if (!res.ok) continue;
      const lines = (await res.text()).split("\n");
      const head = lines.slice(0, 14).join("\n");
      const scored = lines
        .filter((l) => l.startsWith("- ["))
        .map((l) => ({ l, score: words.reduce((n, w) => n + (l.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score);
      const picked = [
        ...scored.filter((s) => s.score > 0).slice(0, 100),
        ...scored.filter((s) => s.score === 0).slice(0, 40),
      ].map((s) => s.l);
      parts.push(`${head}\n${picked.join("\n")}`);
    } catch {
      /* export unavailable — answer from what we have */
    }
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

const encoder = new TextEncoder();
const sseLine = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

function clientIp(event: any): string {
  return event.requestContext?.http?.sourceIp || "anon";
}

async function handleRequest(event: any, stream: NodeJS.WritableStream): Promise<void> {
  const httpStream = (status: number) =>
    awslambda.HttpResponseStream.from(stream, {
      statusCode: status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });

  if (CHAT_ORIGIN_SECRET) {
    const provided = event.headers?.["x-chat-origin-secret"] ?? event.headers?.["X-Chat-Origin-Secret"];
    if (provided !== CHAT_ORIGIN_SECRET) {
      const s = awslambda.HttpResponseStream.from(stream, { statusCode: 403 });
      s.end();
      return;
    }
  }

  let body: { message?: unknown };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    const s = httpStream(200);
    s.write(encoder.encode(sseLine({ error: "Sorry, I couldn't read that request." })));
    s.end();
    return;
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  const out = httpStream(200);
  if (!message) {
    out.write(encoder.encode(sseLine({ error: "Please type a message first." })));
    out.end();
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  if (await isRateLimited(RATE_LIMIT_TABLE, "chat", clientIp(event), day, 60)) {
    out.write(encoder.encode(sseLine({ error: "Too many messages — please slow down and try again shortly." })));
    out.end();
    return;
  }

  if (!OPENAI_API_KEY) {
    out.write(encoder.encode(sseLine({ error: "The assistant isn't configured yet. Set OPENAI_API_KEY on the Lambda." })));
    out.end();
    return;
  }

  const contextText = await buildContext(message);

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        stream: true,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Context from the catalogs:\n###\n${contextText}\n###\n\nVisitor question: **${message}**` },
        ],
      }),
    });
  } catch {
    out.write(encoder.encode(sseLine({ error: "I couldn't reach the assistant right now. Please try again." })));
    out.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    out.write(encoder.encode(sseLine({ error: `The assistant returned an error (${upstream.status}). Please try again.` })));
    out.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
          if (typeof delta === "string" && delta) out.write(encoder.encode(sseLine({ chunk: delta })));
        } catch {
          /* keep-alive comments */
        }
      }
    }
  } finally {
    out.write(encoder.encode(sseLine({ done: true })));
    out.end();
  }
}

export const handler = awslambda.streamifyResponse(async (event, responseStream, _context) => {
  await handleRequest(event, responseStream);
});
