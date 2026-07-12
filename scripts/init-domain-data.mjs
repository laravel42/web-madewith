#!/usr/bin/env node
/**
 * Ensure every domain in domain-catalog.json has seed + src/data JSON so
 * `astro build` never breaks before the first scrape.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CATALOG = join(ROOT, "src", "config", "domain-catalog.json");
const SEED_DIR = join(__dirname, "seed");
const DATA_DIR = join(ROOT, "src", "data");

mkdirSync(SEED_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
let created = 0;

for (const entry of catalog) {
  const seedPath = join(SEED_DIR, `${entry.slug}.json`);
  const dataPath = join(DATA_DIR, `${entry.slug}.json`);

  if (!existsSync(seedPath)) {
    const payload = {
      slug: entry.slug,
      scrapedAt: new Date(0).toISOString(),
      source: "placeholder",
      totalRepos: 0,
      projects: [],
    };
    writeFileSync(seedPath, JSON.stringify(payload, null, 2));
    created++;
  }

  if (!existsSync(dataPath)) {
    copyFileSync(seedPath, dataPath);
    created++;
  }
}

console.log(`init-domain-data: ${catalog.length} domains checked, ${created} files created.`);
