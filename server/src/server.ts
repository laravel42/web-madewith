/** HTTP entry — the Ploi daemon runs this (`tsx src/server.ts`). */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (KEY=VALUE lines; real environment wins) so the
// daemon needs no env plumbing beyond that file.
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* no .env — rely on the process environment */ }

const { serve } = await import("@hono/node-server");
const { createRuntime } = await import("./env");
const { createApp } = await import("./app");

const rt = createRuntime();
const app = createApp(rt.env);

// Only the local nginx proxy should reach this — never bind publicly unless
// HOST is set explicitly.
const hostname = process.env.HOST || "127.0.0.1";
const server = serve({ fetch: app.fetch, port: rt.env.port, hostname }, (info) => {
  console.log(`madewith server listening on ${hostname}:${info.port} (data dir ${rt.env.dataDir})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down`);
    server.close();
    rt.close().finally(() => process.exit(0));
  });
}
