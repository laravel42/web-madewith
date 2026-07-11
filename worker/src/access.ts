/**
 * Cloudflare Access JWT verification.
 *
 * Access sits in front of the /admin routes and injects a signed
 * `Cf-Access-Jwt-Assertion` header. We verify it against the team's public
 * JWKS (RS256), checking audience, issuer and expiry, and return the caller's
 * identity. This is the Worker's authorization gate for every admin action.
 *
 * Env: ACCESS_TEAM_DOMAIN (e.g. "team.cloudflareaccess.com"), ACCESS_AUD (the
 * Access application AUD tag).
 */

export interface AccessIdentity {
  email: string;
  sub: string;
}

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string; }

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

async function loadKeys(teamDomain: string, kv: KVNamespace): Promise<Jwk[]> {
  const cacheKey = `jwks:${teamDomain}`;
  const cached = await kv.get(cacheKey, "json");
  if (cached) return cached as Jwk[];
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  await kv.put(cacheKey, JSON.stringify(keys), { expirationTtl: 3600 });
  return keys;
}

/** Returns the verified identity, or null if the token is missing/invalid. */
export async function verifyAccess(req: Request, env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; STATE: KVNamespace }): Promise<AccessIdentity | null> {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null; // misconfigured → deny

  const token = req.headers.get("cf-access-jwt-assertion") || cookie(req, "CF_Authorization");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header: any, payload: any;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch { return null; }

  // Claims.
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  // Signature.
  let keys: Jwk[];
  try { keys = await loadKeys(team, env.STATE); } catch { return null; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
  } catch { return null; }

  return { email: payload.email || "unknown", sub: payload.sub || "" };
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
