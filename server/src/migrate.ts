/** Apply server/migrations/*.sql to Postgres. Idempotent (CREATE ... IF NOT EXISTS). */
import "./load-env";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main(): Promise<void> {
  const url = process.env.SCRAPE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url });
  try {
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS, f), "utf8");
      console.log(`applying ${f}`);
      await pool.query(sql);
    }
    console.log(`migrations applied (${files.length})`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
