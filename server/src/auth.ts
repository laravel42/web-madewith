/**
 * App-level admin auth — replaces Cloudflare Access. Two ways in:
 *   1. Session cookie (`mw_admin`) issued by POST /admin/api/login after an
 *      ADMIN_PASSWORD check. HMAC-signed (SESSION_SECRET), HttpOnly, ~7 days.
 *   2. `Authorization: Bearer <ADMIN_TOKEN>` for automation.
 * Both yield an AdminIdentity, the same shape the routes expected from Access.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "./env";
import { json } from "./util";

export interface AdminIdentity {
  email: string;
}

const COOKIE = "mw_admin";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

const b64url = (b: Buffer) => b.toString("base64url");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

/** token = base64url(json).base64url(hmac) */
export function makeSession(email: string, env: AppEnv): string {
  const body = b64url(Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  return `${body}.${sign(body, env.sessionSecret)}`;
}

function readSession(token: string, env: AppEnv): AdminIdentity | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !env.sessionSecret) return null;
  if (!safeEqual(sig, sign(body, env.sessionSecret))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { email?: string; exp?: number };
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: claims.email || "admin" };
  } catch {
    return null;
  }
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Returns the verified admin identity, or null. */
export function requireAdmin(req: Request, env: AppEnv): AdminIdentity | null {
  const auth = req.headers.get("authorization");
  if (auth && env.adminToken) {
    const token = auth.replace(/^Bearer\s+/i, "");
    if (safeEqual(token, env.adminToken)) return { email: "token@automation" };
  }
  const session = cookie(req, COOKIE);
  if (session) return readSession(session, env);
  return null;
}

function setCookie(env: AppEnv, value: string, maxAge: number): string {
  const parts = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (env.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

/** POST /admin/api/login  { password } → sets the session cookie. */
export async function handleLogin(req: Request, env: AppEnv): Promise<Response> {
  if (!env.adminPassword) return json({ error: "admin login is not configured" }, 503);
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !safeEqual(password, env.adminPassword)) {
    return json({ error: "invalid password" }, 401);
  }
  const email = "admin";
  return json({ ok: true, email }, 200, { "set-cookie": setCookie(env, makeSession(email, env), SESSION_TTL) });
}

/** POST /admin/api/logout → clears the cookie. */
export function handleLogout(env: AppEnv): Response {
  return json({ ok: true }, 200, { "set-cookie": setCookie(env, "", 0) });
}
