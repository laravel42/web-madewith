#!/usr/bin/env node
/**
 * Build-time blog hydration.
 *
 * Copies factory editorial output into the Astro content tree:
 *   workers/posts/output/articles/**  →  src/content/blog/**
 *   workers/posts/output/assets/**    →  public/assets/**
 *
 * Resilient by design: if workers/posts/output is missing, exit 0 and keep any
 * committed content under src/content/blog and public/assets.
 */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Must track content_factory's CONTENT_OUTPUT_DIR, or generate writes to one
// directory while hydrate reads another and silently syncs nothing.
const OUT_DIR = process.env.CONTENT_OUTPUT_DIR || "output";
const FACTORY_OUT = OUT_DIR.startsWith("/")
  ? OUT_DIR
  : join(ROOT, "workers", "posts", OUT_DIR);
const ARTICLES_SRC = join(FACTORY_OUT, "articles");
const ASSETS_SRC = join(FACTORY_OUT, "assets");
const ARTICLES_DEST = join(ROOT, "src", "content", "blog");
const ASSETS_DEST = join(ROOT, "public", "assets");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function copyIfChanged(src, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const srcStat = await stat(src);
  let destStat = null;
  try {
    destStat = await stat(dest);
  } catch {
    /* dest missing */
  }
  if (!destStat || srcStat.mtimeMs > destStat.mtimeMs || srcStat.size !== destStat.size) {
    await cp(src, dest);
    return true;
  }
  return false;
}

async function syncTree(srcRoot, destRoot, filter) {
  let copied = 0;
  let unchanged = 0;
  const files = (await walk(srcRoot)).filter(filter);
  for (const src of files) {
    const rel = relative(srcRoot, src);
    const dest = join(destRoot, rel);
    if (await copyIfChanged(src, dest)) copied++;
    else unchanged++;
  }
  return { total: files.length, copied, unchanged };
}

async function main() {
  try {
    await stat(ARTICLES_SRC);
  } catch {
    console.log("hydrate-blog: workers/posts/output/articles not found — using committed src/content/blog");
    return;
  }

  const articles = await syncTree(ARTICLES_SRC, ARTICLES_DEST, (f) => f.endsWith(".md"));
  let assets = { total: 0, copied: 0, unchanged: 0 };
  try {
    await stat(ASSETS_SRC);
    assets = await syncTree(ASSETS_SRC, ASSETS_DEST, () => true);
  } catch {
    console.log("hydrate-blog: workers/posts/output/assets not found — skipping asset sync");
  }

  console.log(
    `hydrate-blog: ${articles.copied}/${articles.total} articles synced` +
      ` (${articles.unchanged} unchanged), ` +
      `${assets.copied}/${assets.total} assets synced` +
      ` (${assets.unchanged} unchanged).`,
  );
}

main().catch((err) => {
  console.log(`hydrate-blog: skipped — ${err.message}`);
});
