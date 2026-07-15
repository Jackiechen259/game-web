import { existsSync, promises as fs, statSync } from "node:fs";
import * as path from "node:path";
import { validateCatalog } from "@game-platform/game-schema";
import { readConfig } from "./sync-lib.ts";

const config = readConfig();
const catalogFile = path.join(config.outputDir, "game-catalog.json");

if (!existsSync(catalogFile)) {
  console.warn(`No catalog found at ${catalogFile}; nothing to validate (run "pnpm sync:games" first).`);
  process.exit(0);
}

const raw = await fs.readFile(catalogFile, "utf8");
let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(`Catalog file is not valid JSON: ${catalogFile}`);
  process.exit(1);
}

const result = await validateCatalog(parsed, {
  fileExists: (p: string) => existsSync(path.join(config.outputDir, p)),
  fileSize: (p: string) => {
    try {
      return statSync(path.join(config.outputDir, p)).size;
    } catch {
      return undefined;
    }
  },
});

if (!result.valid) {
  console.error("Catalog validation failed:");
  for (const e of result.errors) {
    console.error(`  [${e.code}] ${e.path}: ${e.message}`);
  }
  process.exit(1);
}

const catalog = parsed as { games?: unknown[] };
const count = Array.isArray(catalog.games) ? catalog.games.length : 0;
console.log(`Catalog valid: ${count} game${count === 1 ? "" : "s"}`);
process.exit(0);
