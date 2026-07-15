/**
 * Minimal .env loader (no dependency). Real environment variables always take
 * precedence over values from the file. Only used for local development.
 */
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";

export function loadDotenv(dir?: string): void {
  const file = path.join(dir ?? path.resolve(import.meta.dirname, "..", "..", ".."), ".env");
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
