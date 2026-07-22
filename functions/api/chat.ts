/**
 * Public AI chat endpoint (Cloudflare Pages Function) backing the site's
 * astro-chat-widget (`<ChatWidget />` → endpoint="/api/chat").
 *
 * The widget POSTs { sessionId, message, timestamp, lang } and expects a
 * Server-Sent Events stream back (data: {"chunk": "..."} … data: {"done": true}).
 * Infobip's AI Assistant "query" API is synchronous JSON, so we call it and
 * re-emit its answer as SSE. Credentials stay server-side — the browser never
 * sees the Infobip API key.
 *
 * Infobip API: POST {baseUrl}/ai/1/aiassistants/{assistantId}/query
 *   headers: Authorization: App <API_KEY>, Content-Type: application/json
 *   body:    { message, sessionId?, useSharedHistory? }
 *   200:     { response: string, context?: {...} }
 *
 * Required Pages env (Settings → Environment variables, or .dev.vars locally):
 *   INFOBIP_API_KEY   – Infobip App API key (secret)
 *   INFOBIP_BASE_URL  – account base host, e.g. https://xxxxx.api.infobip.com
 * Optional:
 *   INFOBIP_ASSISTANT_ID – defaults to the MadeWithWhat assistant below
 */

interface Env {
  INFOBIP_API_KEY?: string;
  INFOBIP_BASE_URL?: string;
  INFOBIP_ASSISTANT_ID?: string;
}

const DEFAULT_ASSISTANT_ID = "1014612c-95ad-4488-9ab6-b05c8f538b08";
const MAX_MESSAGE = 1000;

const encoder = new TextEncoder();
const sseEvent = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

/** One-shot SSE stream (used for handled errors so the widget can display them). */
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

/** Infobip keys use the "App <key>" scheme; respect an explicit scheme if given. */
function authHeader(key: string): string {
  return /^(App|Basic|Bearer|IBSSO)\s/i.test(key) ? key : `App ${key}`;
}

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;

  // --- parse the widget's payload ---
  let body: { message?: unknown; sessionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return sseOnce({ error: "Sorry, I couldn't read that request." });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  if (!message) {
    return sseOnce({ error: "Please type a message first." });
  }

  // --- config guard ---
  const apiKey = env.INFOBIP_API_KEY;
  const baseUrl = env.INFOBIP_BASE_URL;
  const assistantId = env.INFOBIP_ASSISTANT_ID || DEFAULT_ASSISTANT_ID;
  if (!apiKey || !baseUrl) {
    return sseOnce({
      error:
        "The assistant isn't configured yet. Set INFOBIP_API_KEY and INFOBIP_BASE_URL on the Pages project.",
    });
  }

  const url = `${normalizeBase(baseUrl)}/ai/1/aiassistants/${assistantId}/query`;

  // --- call Infobip (synchronous) ---
  let ib: Response;
  try {
    ib = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(apiKey),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: message.slice(0, MAX_MESSAGE),
        sessionId,
        useSharedHistory: true,
      }),
    });
  } catch {
    return sseOnce({ error: "I couldn't reach the assistant right now. Please try again." });
  }

  // Let the widget's built-in rate-limit UX handle 429s.
  if (ib.status === 429) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": ib.headers.get("Retry-After") ?? "30" },
    });
  }

  if (!ib.ok) {
    return sseOnce({ error: `The assistant returned an error (${ib.status}). Please try again.` });
  }

  let data: { response?: unknown };
  try {
    data = await ib.json();
  } catch {
    return sseOnce({ error: "The assistant sent a response I couldn't read." });
  }

  const answer =
    typeof data.response === "string" && data.response.trim()
      ? data.response.trim()
      : "Sorry, I don't have an answer for that one.";

  // --- re-emit as SSE, paragraph by paragraph (safe markdown boundaries) ---
  const parts = answer.split(/\n{2,}/).filter((p) => p.length > 0);
  const stream = new ReadableStream({
    start(controller) {
      parts.forEach((part, i) => {
        controller.enqueue(sseEvent({ chunk: i === 0 ? part : `\n\n${part}` }));
      });
      controller.enqueue(sseEvent({ done: true }));
      controller.close();
    },
  });
  return sseResponse(stream);
};
