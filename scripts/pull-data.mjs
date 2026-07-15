#!/usr/bin/env node
/**
 * Build-time data hydration for src/data/*.json.
 *
 * Priority:
 * 1. Postgres (DATABASE_URL) — runs scraper/publish.py (ranked repos → JSON)
 * 2. Worker/R2 (MADEWITH_DATA_BASE_URL) — legacy remote fetch
 * 3. Committed src/data/*.json — always kept on failure (build never breaks)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "./lib/load-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "src", "data");
const CONFIG_DIR = join(DATA_DIR, "config");
const SCRAPER_DIR = join(ROOT, "scraper");
const YOUTUBE_DIR = join(ROOT, "youtube");

function databaseUrl() {
  return process.env.SCRAPE_DATABASE_URL || process.env.DATABASE_URL || "";
}

function workerBaseUrl() {
  return (process.env.MADEWITH_DATA_BASE_URL || "").replace(/\/+$/, "");
}

function publishPython() {
  const venv = join(SCRAPER_DIR, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

function valid(payload) {
  return payload && typeof payload.slug === "string";
}

function validDataset(payload) {
  return valid(payload) && Array.isArray(payload.projects) && payload.projects.length > 0;
}

async function runPythonScript(script, label) {
  if (!existsSync(script)) {
    console.log(`pull-data: ${label} — script not found, skipping`);
    return false;
  }
  return new Promise((resolve) => {
    const child = spawn(publishPython(), [script], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function hydrateFromPostgres() {
  console.log("pull-data: hydrating src/data/*.json from Postgres");
  const ok = await runPythonScript(join(SCRAPER_DIR, "publish.py"), "projects");
  if (ok) console.log("pull-data: project hydration complete");
  else console.log("pull-data: project hydration failed — keeping committed src/data/*.json");
  return ok;
}

async function hydrateVideosFromPostgres() {
  console.log("pull-data: hydrating src/data/videos/*.json from Postgres");
  const ok = await runPythonScript(join(YOUTUBE_DIR, "publish_videos.py"), "videos");
  if (ok) console.log("pull-data: video hydration complete");
  else console.log("pull-data: video hydration skipped or failed");
  return ok;
}

async function hydrateFromWorker(base) {
  await mkdir(CONFIG_DIR, { recursive: true });
  const slugs = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  let updated = 0;
  let configs = 0;

  for (const slug of slugs) {
    const url = `${base}/data/${slug}.json`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (!validDataset(payload)) throw new Error("invalid payload shape");
      await writeFile(join(DATA_DIR, `${slug}.json`), JSON.stringify(payload, null, 2));
      console.log(`pull-data: ✓ ${slug} (${payload.projects.length} projects, scraped ${payload.scrapedAt || "?"})`);
      updated++;
    } catch (err) {
      let local = null;
      try {
        local = JSON.parse(await readFile(join(DATA_DIR, `${slug}.json`), "utf8"));
      } catch {
        /* no/invalid local file */
      }
      console.log(`pull-data: • ${slug} kept committed data — ${err.message}${local ? "" : " (and no local fallback!)"}`);
    }

    const cfgUrl = `${base}/config/${slug}.json`;
    try {
      const res = await fetch(cfgUrl, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const payload = await res.json();
      if (!valid(payload)) continue;
      await writeFile(join(CONFIG_DIR, `${slug}.json`), JSON.stringify(payload, null, 2));
      console.log(`pull-data: ✓ config/${slug}.json`);
      configs++;
    } catch {
      /* optional — no admin overrides yet */
    }
  }

  console.log(`pull-data: ${updated}/${slugs.length} datasets refreshed from Worker, ${configs} domain configs.`);
  return updated > 0;
}

async function main() {
  loadEnv();

  if (databaseUrl()) {
    await hydrateFromPostgres();
    await hydrateVideosFromPostgres();
    return;
  }

  const base = workerBaseUrl();
  if (base) {
    console.log(`pull-data: hydrating src/data/*.json from ${base}`);
    await hydrateFromWorker(base);
    return;
  }

  console.log("pull-data: DATABASE_URL and MADEWITH_DATA_BASE_URL unset — using committed src/data/*.json");
}

main().catch((e) => {
  console.log(`pull-data: skipped — ${e.message}`);
});
