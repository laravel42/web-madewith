import type { Env } from "./env";

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra },
  });

/** Trigger a Cloudflare Pages rebuild (best-effort). */
export async function triggerDeploy(env: Env): Promise<void> {
  if (!env.PAGES_DEPLOY_HOOK) return;
  try {
    await fetch(env.PAGES_DEPLOY_HOOK, { method: "POST" });
    console.log("triggered Pages deploy hook");
  } catch (e) {
    console.log(`deploy hook failed: ${(e as Error).message}`);
  }
}
