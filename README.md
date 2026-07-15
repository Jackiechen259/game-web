# Game Portal

A Web game portal with an admin backend, draft/publish flow, preview, deploy
status, and rollback. Games are synced at **build time** from an independent
GitHub games library; the browser never calls the GitHub API. Games run in
sandboxed iframes isolated from the portal.

This repo implements the plan in [`game-portal-codex-implementation-plan.md`](./game-portal-codex-implementation-plan.md).

## Architecture

```
Public Portal (React + Vite)         Admin SPA (/admin)
   │ reads /game-catalog.json           │ HTTPS + session
   ▼                                     ▼
Published static assets            Admin API (Express + node:sqlite)
   │                                     │ GitHub App
   │ build-time sync                     ▼
   ▼                                GitHub: web-games-library
scripts/sync-games.ts              (main: source, admin/drafts, dist)
```

### Monorepo layout

```
apps/
├── portal/        React + Vite (public portal + admin SPA)
└── admin-api/     Express API + node:sqlite (server runtime)
packages/
├── game-schema/    shared Zod schemas + validation (single source of truth)
├── game-sdk/       postMessage protocol for portal <-> game
└── admin-types/    API request/response types, roles, audit, jobs
scripts/
├── sync-games.ts          build-time game sync (safe extract + validate)
└── validate-game-catalog.ts
tests/fixtures/games-library-dist/   dev fixture (built games library)
docs/                      game-library-contract, admin-guide, publishing-flow, security-model
```

Packages export **TypeScript source** directly (no per-package build). The
admin API and sync scripts run on Node 23.6+'s native type-stripping; only the
portal gets a real Vite build.

## Quick start (local)

```bash
pnpm install
pnpm sync:games        # sync the dev fixture into apps/portal/public
pnpm dev:api &         # admin API on :4000 (dev auth enabled)
pnpm dev:portal        # Vite dev server on :5173 (proxies /api -> :4000)
```

Open `http://localhost:5173` for the public portal and `/admin` for the backend.

Default local login (dev provider):

```
AUTH_PROVIDER=dev
DEV_ADMIN_LOGIN=admin
DEV_ADMIN_PASSWORD=<set in .env>
ADMIN_GITHUB_USERS=admin
REPOSITORY_BACKEND=local
```

Copy `.env.example` to `.env` and fill in `DEV_ADMIN_PASSWORD` and `SESSION_SECRET`
for local dev. The local backend seeds two demo games (snake, tetris) from
`tests/fixtures/games-library-dist`.

## Environment variables

See [`.env.example`](./.env.example) for the full list. Highlights:

| Variable | Purpose |
| --- | --- |
| `AUTH_PROVIDER` | `github` (prod) or `dev` (local) |
| `SESSION_SECRET` | signs session cookies (server-only) |
| `ADMIN_GITHUB_USERS` | allowlist of GitHub logins |
| `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` | GitHub App creds (prod) |
| `GITHUB_GAME_LIBRARY_REPO` / `GITHUB_PORTAL_REPO` | repo targets |
| `ADMIN_PUBLISH_MODE` | `pull-request` (prod) or `direct` (dev) |
| `GAMES_REPO` / `GAMES_REF` / `GAMES_LOCAL_PATH` | build-time sync source |
| `DATABASE_URL` | sqlite path (defaults to `data/admin.sqlite`) |
| `REPOSITORY_BACKEND` | `local` (dev) or `github` (prod) |
| `ADMIN_ALLOWED_ORIGINS` | CORS/origin allowlist |
| `ADMIN_MAX_UPLOAD_MB` | cover upload size cap |

Secrets never use the `VITE_` prefix (that would inline them into the browser bundle).

## Running locally

### Portal

```bash
pnpm dev:portal          # Vite dev server with /api proxy to :4000
pnpm dev:no-sync         # skip game sync (use already-synced games)
pnpm build:portal        # production build -> apps/portal/dist
```

### Admin API

```bash
pnpm dev:api             # node apps/admin-api/src/server.ts  (port 4000)
```

### Tests, lint, typecheck, build

```bash
pnpm lint
pnpm typecheck
pnpm test                # vitest run (node + jsdom projects)
pnpm build               # sync:games -> validate:games -> build:portal
```

## Game sync

Build-time only. `scripts/sync-games.ts` reads `GAMES_REPO@GAMES_REF` (or a
local path), safely extracts the archive, validates the catalog with the shared
schema, and atomically writes `apps/portal/public/{games/,game-catalog.json,site-settings.json,games-sync-info.json}`.

### Local mode

```bash
GAMES_LOCAL_PATH=../web-games-library/dist pnpm sync:games
pnpm dev:no-sync
```

### Remote mode

```bash
GAMES_REPO=owner/web-games-library GAMES_REF=dist pnpm sync:games
pnpm dev
```

On failure the previous good result is preserved. Stale cache is opt-in
(`GAMES_ALLOW_STALE_CACHE=true`) and clearly logged when used. See
[`docs/game-library-contract.md`](./docs/game-library-contract.md).

## Adding a new game

In the **web-games-library** repo:

1. Add `catalog/games/<id>.json` (full `GameConfig`; id matches `^[a-z0-9][a-z0-9-]*$`).
2. Add `games/<id>/` source + `vite.config.ts` with `base: "./"` and a `cover.png`.
3. Open a PR. Games-library CI validates, builds, generates `dist/catalog.json`,
   publishes `dist`, and dispatches `games-library-updated` to the portal.

The portal picks up the new game on its next build with **no portal source change**
(MVP #18). To configure the new game through the admin UI instead, use
`/admin/games/new`.

## GitHub App setup (production)

1. Create a GitHub App (org or user). Use **RS256 JWT** auth (the admin API
   signs JWTs from the private key).
2. Install it only on the `web-games-library` and `game-portal` repos.
3. Permissions (games library): Contents R/W, Pull requests R/W, Actions R,
   Checks R, Metadata R. Portal: Contents R, Actions R/W, Metadata R. Reduce
   further where possible.
4. Set `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and
   `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_APP_PRIVATE_KEY_FILE` pointing to the
   PEM). See [`docs/security-model.md`](./docs/security-model.md).

## Admin initialization

1. Set `AUTH_PROVIDER=github` and `ADMIN_GITHUB_USERS=your-login`.
2. Create a GitHub OAuth App; set `GITHUB_OAUTH_CLIENT_ID/SECRET`.
3. Visit `/admin` -> you are redirected to GitHub OAuth -> back to `/admin`.
4. The first allowlisted login is created as an `admin`.

For local dev: `AUTH_PROVIDER=dev`, set `DEV_ADMIN_LOGIN`/`DEV_ADMIN_PASSWORD`.

## Drafts, publishing, rollback, conflicts

See [`docs/admin-guide.md`](./docs/admin-guide.md) and
[`docs/publishing-flow.md`](./docs/publishing-flow.md). In short:

- Edits save drafts (`expectedSha` concurrency; 409 on conflict, never silent overwrite).
- Admin publishes -> PR -> games-library CI -> `dist` -> portal redeploy.
- Rollback creates a reverse PR; Git history is never deleted.
- Conflicts: reload latest, merge, re-save.

## Deploying the portal

The portal is a static SPA (`apps/portal/dist`). Deploy to any static host
(Cloudflare Pages, Netlify, Vercel, S3 + CloudFront, GitHub Pages). The
`.github/workflows/portal.yml` workflow builds and uploads the artifact; wire
the deploy step to your host. The admin API is deployed separately (Node host,
container, or serverless) behind HTTPS with the environment variables set.

## Recovering a failed sync

- A failed sync never deletes the last good `public/games/`.
- Re-run `pnpm sync:games` once the games library `dist` is healthy.
- If remote is down and you must ship, set `GAMES_ALLOW_STALE_CACHE=true` to use
  the last cached archive (the sync record and admin UI mark it as stale).
- Inspect `apps/portal/public/games-sync-info.json` for the synced commit/SHA.

## MVP acceptance

See section 37 of the plan. The implementation covers: secure admin login,
read/edit/draft/validate/preview/publish/deploy/rollback, build-time sync, iframe
isolation, shared schema, audit logging, conflict detection, and
typecheck/test/build passing.

## Not implemented (this phase)

Player accounts, comments, online leaderboards, cloud saves, payments, ads,
user-uploaded third-party games, an online code editor, multi-tenant admin,
arbitrary server-side command execution, and full CMS (section 38).
