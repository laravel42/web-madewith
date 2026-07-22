import type { AppEnv } from "./env";

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });

/** Client IP for rate limiting — behind nginx, the real IP is the first XFF hop. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "anon";
  return req.headers.get("x-real-ip") || "anon";
}

/** Best-effort rebuild trigger after a publish (replaces the Pages deploy hook). */
export async function triggerRebuild(env: AppEnv): Promise<void> {
  if (!env.rebuildHook) return;
  try {
    await fetch(env.rebuildHook, { method: "POST" });
    console.log("triggered rebuild hook");
  } catch (e) {
    console.log(`rebuild hook failed: ${(e as Error).message}`);
  }
}
