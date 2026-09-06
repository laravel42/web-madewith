/**
 * Scrape → publish for every domain. `refreshAll` is the core (shared with the
 * HTTP /refresh route); running this file directly is the cron entry (Ploi
 * scheduler) that the Worker's scheduled() handler used to be.
 */
import "./load-env";
import { pathToFileURL } from "node:url";
import { GitHub } from "./github";
import { DOMAINS } from "./domains";
import { scrapeAndPublish } from "./publish";
import { kvEtagStore } from "./kv";
import { triggerRebuild } from "./util";
import { createRuntime, type AppEnv } from "./env";

export async function refreshAll(env: AppEnv): Promise<Array<{ slug: string; published?: number; total?: number; error?: string }>> {
  const gh = new GitHub({ token: env.githubToken, etags: kvEtagStore(env.kv), log: (m) => console.log(m) });
  const now = Date.now();
  const summary: Array<{ slug: string; published?: number; total?: number; error?: string }> = [];
  for (const domain of DOMAINS) {
    try {
      const ds = await scrapeAndPublish(gh, env.store, env.db, domain, now, {
        kv: env.kv,
        openaiApiKey: env.openaiApiKey,
        openaiModel: env.openaiClassifyModel,
      });
      summary.push({ slug: domain.slug, published: ds.projects.length, total: ds.totalRepos });
    } catch (e) {
      // One domain failing (GitHub hiccup, etc.) must not abort the whole run.
      console.error(`scheduled scrape failed for ${domain.slug}: ${(e as Error).message}`);
      summary.push({ slug: domain.slug, error: (e as Error).message });
    }
  }
  await env.kv.put("meta:lastRun", JSON.stringify({ at: new Date(now).toISOString(), summary }));
  await triggerRebuild(env); // ping the Ploi deploy webhook → rebuild + swap dist/
  return summary;
}

async function main(): Promise<void> {
  const rt = createRuntime();
  try {
    const summary = await refreshAll(rt.env);
    console.log("refresh complete", JSON.stringify(summary));
  } finally {
    await rt.close();
  }
}

// Only run the CLI when executed directly — not when imported by the HTTP app.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
