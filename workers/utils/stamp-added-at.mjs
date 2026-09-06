#!/usr/bin/env node
/**
 * Stamp each published project with `addedAt` — when it first entered the
 * catalog. The scrape pipeline only knows a repo's push date; feed readers
 * need "new in THIS catalog" to surface newcomers, which is what the RSS
 * feeds sort by.
 *
 * Previous state comes from git (HEAD's version of each dataset), so the
 * stamp survives republishes without a sidecar database:
 *   - project present at HEAD → keep its addedAt (or, if HEAD predates this
 *     script, backfill with HEAD's scrapedAt: "was already there last publish")
 *   - genuinely new project → stamped with the fresh dataset's scrapedAt
 *
 * Runs after every publish (projects:publish). Idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function headVersion(relPath) {
  try {
    const out = execFileSync("git", ["show", `HEAD:${relPath}`], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out);
  } catch {
    return null; // new file, or no git available (CI tarball) — stamp fresh
  }
}

const catalog = JSON.parse(readFileSync(join(ROOT, "src/config/domain-catalog.json"), "utf8"));
let stamped = 0, kept = 0, backfilled = 0;

for (const d of catalog) {
  const rel = `src/data/${d.slug}.json`;
  const path = join(ROOT, rel);
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const prev = headVersion(rel);
  const prevByName = new Map((prev?.projects ?? []).map((p) => [p.fullName, p]));

  let changed = false;
  for (const p of data.projects) {
    const before = p.addedAt;
    const old = prevByName.get(p.fullName);
    if (old?.addedAt) {
      p.addedAt = old.addedAt;
      kept++;
    } else if (old) {
      p.addedAt = p.addedAt ?? prev.scrapedAt; // pre-script era: at least "last publish"
      backfilled++;
    } else {
      p.addedAt = p.addedAt ?? data.scrapedAt;
      stamped++;
    }
    if (p.addedAt !== before) changed = true;
  }
  if (changed) writeFileSync(path, JSON.stringify(data, null, 2));
}
console.log(`addedAt — new: ${stamped}, kept: ${kept}, backfilled: ${backfilled}`);
