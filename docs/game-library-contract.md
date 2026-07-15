# Game Library Contract

This document defines the contract between the **portal** and the
**web-games-library** repository. Both sides must agree on this contract; the
shared `@game-platform/game-schema` package is the single source of truth.

## Repositories

- `game-portal` (this repo) — public portal, admin frontend, admin API, game sync.
- `web-games-library` — game source, game metadata, build config, `dist` publish branch.

The portal **never** executes arbitrary code from the games library and **never**
builds remote game source. It only consumes the library's **build output**.

## Source structure (games library)

```
web-games-library/
├── catalog/
│   ├── settings.json          # site-level settings (non-secret)
│   └── games/
│       ├── snake.json         # one config per game (full GameConfig)
│       └── tetris.json
├── games/
│   ├── snake/                 # game source + build config (vite base: "./")
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── tetris/
├── scripts/
│   ├── build-all-games.mjs
│   ├── check-built-games.mjs
│   ├── generate-catalog.mjs
│   └── trigger-portal-deploy.mjs
├── package.json
└── pnpm-workspace.yaml
```

## Published structure (`dist` branch)

```
dist/
├── catalog.json               # aggregated GameCatalog (public subset)
├── settings.json              # site settings copy
└── games/
    ├── snake/
    │   ├── index.html         # must end with .html, under games/<id>/
    │   ├── cover.png
    │   └── assets/
    └── tetris/
```

The portal reads these at build time only. Games run at
`/games/<id>/index.html` relative to the portal origin.

## Per-game config (`catalog/games/<id>.json`)

Full `GameConfig` (see `@game-platform/game-schema`). Key rules enforced by the
shared validator:

| Rule | Constraint |
| --- | --- |
| `id` | `^[a-z0-9][a-z0-9-]*$`, unique across catalog |
| `version` | semver `x.y.z[-pre][+build]` |
| `status` | `development` \| `beta` \| `published` \| `archived` |
| `entry` | relative path, no `..`, ends `.html`, under `games/<id>/` |
| `cover` | relative path, no `..`, under `games/<id>/` |
| `aspectRatio` | `^\d+/\d+$` (e.g. `16/9`) |
| `createdAt` / `updatedAt` | `YYYY-MM-DD` |
| `iframe.allow` | whitelist: `fullscreen`, `autoplay`, `gamepad` |
| `iframe.sandbox` | whitelist, must include `allow-scripts` + `allow-same-origin` |
| Two games | may not reference the same `games/<dir>/` directory |

## Aggregated catalog (`dist/catalog.json`)

`GameCatalog`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-15T00:00:00Z",
  "games": [ /* GameMetadata entries (subset of GameConfig) */ ]
}
```

The portal public listing shows only `published` and (when `showBetaGames`)
`beta` games. `development` and `archived` are hidden from public lists;
archived detail pages may be retained when `showArchivedGamePages` is on.

## CI flow (games library)

```
source config / code change
  -> install
  -> validate schema (shared @game-platform/game-schema)
  -> build affected games (vite, base: "./")
  -> check each game has index.html + cover
  -> generate dist/catalog.json + dist/settings.json
  -> publish dist branch
  -> repository_dispatch to portal (event: games-library-updated)
```

## Portal sync flow

`pnpm sync:games` (build-time only):

1. Resolve ref -> commit SHA (cache key `games-<repo>-<sha>`).
2. Download tarball (size-capped, timed out), **safe** extract (rejects `..`,
   absolute, drive letters, symlinks).
3. Parse + validate `catalog.json` against the shared schema + file tree.
4. Copy `games/` + `catalog.json` + `settings.json` to a staging dir.
5. Atomically replace the portal's `public/games/` and write
   `public/game-catalog.json`, `public/site-settings.json`,
   `public/games-sync-info.json`.

On any failure the previous successful result is preserved.

## What the browser may and may not do

- ✅ fetch `/game-catalog.json`, `/site-settings.json`, `/games/<id>/...`
- ❌ call `api.github.com`
- ❌ read GitHub tokens
- ❌ fetch arbitrary external iframe URLs

## Secrets

GitHub App private key, OAuth client secret, session secret, DB URL and tokens
live **only** in server-side environment variables (or GitHub Actions secrets).
They never enter the portal bundle, the `dist` branch, client-visible cookies,
or logs. See [security-model.md](./security-model.md).
