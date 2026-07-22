/**
 * Public AI chat endpoint backing the site's astro-chat-widget
 * (`<ChatWidget />` → endpoint="/api/chat"). Ported from the Cloudflare Pages
 * Function. The widget POSTs { sessionId, message } and expects an SSE stream;
 * Infobip's AI Assistant query API is synchronous JSON, so we call it and
 * re-emit its answer as SSE. Credentials stay server-side.
 *
 * Infobip: POST {baseUrl}/ai/1/aiassistants/{assistantId}/query
 *   headers: Authorization: App <key>, Content-Type: application/json
 *   body:    { message, sessionId?, useSharedHistory? }   → 200 { response }
 */
import type { AppEnv } from "./env";

const MAX_MESSAGE = 1000;
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

function authHeader(key: string): string {
  return /^(App|Basic|Bearer|IBSSO)\s/i.test(key) ? key : `App ${key}`;
}

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function handleChat(req: Request, env: AppEnv): Promise<Response> {
  let body: { message?: unknown; sessionId?: unknown };
  try {
    body = (await req.json()) as { message?: unknown; sessionId?: unknown };
  } catch {
    return sseOnce({ error: "Sorry, I couldn't read that request." });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  if (!message) return sseOnce({ error: "Please type a message first." });

  const apiKey = env.infobipApiKey;
  const baseUrl = env.infobipBaseUrl;
  if (!apiKey || !baseUrl) {
    return sseOnce({ error: "The assistant isn't configured yet. Set INFOBIP_API_KEY and INFOBIP_BASE_URL." });
  }

  const url = `${normalizeBase(baseUrl)}/ai/1/aiassistants/${env.infobipAssistantId}/query`;

  let ib: Response;
  try {
    ib = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader(apiKey), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message: message.slice(0, MAX_MESSAGE), sessionId, useSharedHistory: true }),
    });
  } catch {
    return sseOnce({ error: "I couldn't reach the assistant right now. Please try again." });
  }

  if (ib.status === 429) {
    return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": ib.headers.get("Retry-After") ?? "30" } });
  }
  if (!ib.ok) return sseOnce({ error: `The assistant returned an error (${ib.status}). Please try again.` });

  let data: { response?: unknown };
  try {
    data = (await ib.json()) as { response?: unknown };
  } catch {
    return sseOnce({ error: "The assistant sent a response I couldn't read." });
  }

  const answer =
    typeof data.response === "string" && data.response.trim()
      ? data.response.trim()
      : "Sorry, I don't have an answer for that one.";

  const parts = answer.split(/\n{2,}/).filter((p) => p.length > 0);
  const stream = new ReadableStream({
    start(controller) {
      parts.forEach((part, i) => controller.enqueue(sseEvent({ chunk: i === 0 ? part : `\n\n${part}` })));
      controller.enqueue(sseEvent({ done: true }));
      controller.close();
    },
  });
  return sseResponse(stream);
}
