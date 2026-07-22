/**
 * Load the repo-root .env into process.env (KEY=VALUE lines; the real
 * environment always wins). Import this FIRST in every entrypoint
 * (server.ts, migrate.ts, refresh.ts) so daemons, migrations, and cron all
 * share one config file with zero env plumbing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* no .env — rely on the process environment */ }
