/** HTTP entry — the Ploi daemon runs this (`tsx src/server.ts`). */
import { serve } from "@hono/node-server";
import { createRuntime } from "./env";
import { createApp } from "./app";

const rt = createRuntime();
const app = createApp(rt.env);

const server = serve({ fetch: app.fetch, port: rt.env.port }, (info) => {
  console.log(`madewith server listening on :${info.port} (data dir ${rt.env.dataDir})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down`);
    server.close();
    rt.close().finally(() => process.exit(0));
  });
}
