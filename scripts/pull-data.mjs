#!/usr/bin/env node
/**
 * Build-time data hydration.
 *
 * In production the Cloudflare Worker scrapes GitHub on a cron and writes each
 * domain's dataset to R2, exposed at `${MADEWITH_DATA_BASE_URL}/data/<slug>.json`.
 * This prebuild step pulls those into `src/data/` so `astro build` renders the
 * freshest data as static HTML.
 *
 * Resilient by design: if the base URL is unset (local dev) or any fetch/parse
 * fails, we keep the committed `src/data/*.json` and exit 0 — the build never
 * breaks and always has data.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const CONFIG_DIR = join(DATA_DIR, "config");
const BASE = (process.env.MADEWITH_DATA_BASE_URL || "").replace(/\/+$/, "");

function valid(payload) {
  return payload && typeof payload.slug === "string";
}

function validDataset(payload) {
  return valid(payload) && Array.isArray(payload.projects) && payload.projects.length > 0;
}

async function main() {
  if (!BASE) {
    console.log("pull-data: MADEWITH_DATA_BASE_URL not set — using committed src/data/*.json");
    return;
  }
  await mkdir(CONFIG_DIR, { recursive: true });
  const slugs = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  let updated = 0;
  let configs = 0;
  for (const slug of slugs) {
    const url = `${BASE}/data/${slug}.json`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (!validDataset(payload)) throw new Error("invalid payload shape");
      await writeFile(join(DATA_DIR, `${slug}.json`), JSON.stringify(payload, null, 2));
      console.log(`pull-data: ✓ ${slug} (${payload.projects.length} projects, scraped ${payload.scrapedAt || "?"})`);
      updated++;
    } catch (err) {
      // A malformed local file must not abort the whole hydration loop.
      let local = null;
      try { local = JSON.parse(await readFile(join(DATA_DIR, `${slug}.json`), "utf8")); } catch { /* no/invalid local file */ }
      console.log(`pull-data: • ${slug} kept committed data — ${err.message}${local ? "" : " (and no local fallback!)"}`);
    }

    const cfgUrl = `${BASE}/config/${slug}.json`;
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
  console.log(`pull-data: ${updated}/${slugs.length} datasets refreshed, ${configs} domain configs from R2.`);
}

main().catch((e) => {
  // Never fail the build over data hydration.
  console.log(`pull-data: skipped — ${e.message}`);
});
