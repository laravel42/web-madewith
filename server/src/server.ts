/** HTTP entry — the Ploi daemon runs this (`tsx src/server.ts`). */
import "./load-env";

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
