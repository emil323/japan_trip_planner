#!/usr/bin/env node
// Re-fetches the 47 Japanese prefecture flag SVGs from Wikimedia Commons
// into public/flags/<key>.svg. Idempotent: skips files that already exist
// and have non-trivial size. Throttled to be polite to Wikimedia.
//
// Usage: node scripts/fetch-flags.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "public", "flags");
const japanTs = path.join(repoRoot, "app", "lib", "japan.ts");

const src = fs.readFileSync(japanTs, "utf8");
const block = src.match(/PREFECTURE_FLAG_FILES[^{]*\{([\s\S]*?)\n\};/);
if (!block) throw new Error("Could not find PREFECTURE_FLAG_FILES in japan.ts");
const map = {};
for (const line of block[1].split("\n")) {
  const m = line.trim().match(/^(\w+):\s*"([^"]+)"/);
  if (m) map[m[1]] = m[2];
}

fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [key, file] of Object.entries(map)) {
  const dest = path.join(outDir, `${key}.svg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) {
    console.log(key, "have");
    continue;
  }
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${file}`;
  let ok = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "japan-trip-planner/1.0 (offline cache)" },
    });
    if (r.ok) {
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      console.log(key, "ok");
      ok = true;
      break;
    }
    await sleep(2000 + 1000 * attempt);
  }
  if (!ok) console.log(key, "FAIL");
  await sleep(700);
}
