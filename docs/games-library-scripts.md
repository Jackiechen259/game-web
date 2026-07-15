# Games Library scripts (reference implementation)

> These scripts live in the **web-games-library** repository, not the portal.
> They are checked in here as a reference / contract so the portal and the
> library agree on how `catalog.json` and `dist` are produced. Copy them into
> the games library repo's `scripts/` directory.

The shared schema is published from this monorepo as `@game-platform/game-schema`.
The games library depends on it so that CI, the admin API and the portal all use
the **same** validation logic (no three separate copies).

## `scripts/build-all-games.mjs`

Builds every game under `games/<id>/` with its own `package.json` + `vite.config.ts`
(`base: "./"` for relative asset paths). Outputs to `dist/games/<id>/`.

```js
import { existsSync, readdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

rmSync("dist", { recursive: true, force: true });
for (const id of readdirSync("games", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)) {
  const dir = join("games", id);
  if (!existsSync(join(dir, "package.json"))) continue;
  console.log(`Building ${id}…`);
  execSync("pnpm install --frozen-lockfile", { cwd: dir, stdio: "inherit" });
  execSync("pnpm build", { cwd: dir, stdio: "inherit" });
  const out = join(dir, "dist");
  if (!existsSync(out)) throw new Error(`${id} did not produce a dist/`);
  cpSync(out, join("dist", "games", id), { recursive: true });
  // Copy cover if present alongside source.
  for (const cover of ["cover.png", "cover.jpg", "cover.webp"]) {
    if (existsSync(join(dir, cover))) cpSync(join(dir, cover), join("dist", "games", id, cover));
  }
}
```

## `scripts/check-built-games.mjs`

Verifies every published game has `index.html` and a cover.

```js
import { readFileSync, existsSync } from "node:fs";
const catalog = JSON.parse(readFileSync("catalog/settings.json", "utf8")); // not used
// Read each game config and check its entry + cover exist in dist/.
import { readdirSync } from "node:fs";
let ok = true;
for (const file of readdirSync("catalog/games")) {
  const config = JSON.parse(readFileSync(`catalog/games/${file}`, "utf8"));
  const entry = `dist/${config.entry}`;
  const cover = `dist/${config.cover}`;
  if (!existsSync(entry)) { console.error(`MISSING entry: ${entry}`); ok = false; }
  if (!existsSync(cover)) { console.error(`MISSING cover: ${cover}`); ok = false; }
}
process.exit(ok ? 0 : 1);
```

## `scripts/generate-catalog.mjs`

Aggregates every `catalog/games/<id>.json` into `dist/catalog.json` using the
shared schema's `toCatalogEntry`, and copies `catalog/settings.json` to
`dist/settings.json`.

```js
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { toCatalogEntry, validateCatalog } from "@game-platform/game-schema";
const games = [];
for (const file of readdirSync("catalog/games").filter((f) => f.endsWith(".json"))) {
  const config = JSON.parse(readFileSync(`catalog/games/${file}`, "utf8"));
  games.push(toCatalogEntry(config));
}
const catalog = { schemaVersion: 1, generatedAt: new Date().toISOString(), games };
const result = await validateCatalog(catalog, { fileExists: (p) => existsSync(`dist/${p}`) });
if (!result.valid) { console.error(result.errors); process.exit(1); }
writeFileSync("dist/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
if (existsSync("catalog/settings.json")) copyFileSync("catalog/settings.json", "dist/settings.json");
```

## `scripts/trigger-portal-deploy.mjs`

Sends a `repository_dispatch` to the portal repo (section 27).

```js
const [repo, eventType, sourceRepo, sourceCommit] = process.argv.slice(2);
const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
  body: JSON.stringify({
    event_type: eventType,
    client_payload: { source_repository: sourceRepo, source_commit: sourceCommit },
  }),
});
if (res.status !== 204) { console.error(`dispatch failed: ${res.status}`); process.exit(1); }
```
