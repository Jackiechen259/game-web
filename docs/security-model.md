# Security Model

## Trust boundaries

```
Browser (untrusted) ──HTTPS──> Admin API (trusted) ──GitHub App──> GitHub
   │                              │
   │ reads /game-catalog.json     │ reads/writes games library repo
   │ runs games in sandboxed      │ holds all secrets
   │ iframe (relative URLs only)  │
   ▼                              ▼
public static assets          server-side SQLite (operational state only)
```

The browser is untrusted. Game iframes are sandboxed. The admin API is the only
component that ever touches GitHub credentials.

## Secrets (never leave the server)

| Secret | Location |
| --- | --- |
| `GITHUB_APP_PRIVATE_KEY` | server env / file (`GITHUB_APP_PRIVATE_KEY_FILE`) |
| `GITHUB_OAUTH_CLIENT_SECRET` | server env |
| `SESSION_SECRET` | server env |
| `DATABASE_URL` | server env |
| `GITHUB_TOKEN` (sync) | CI secret / server env |

Rules (section 19, 32.4):

- No `VITE_*` variable ever holds a secret. `VITE_*` is inlined into the browser bundle.
- The admin API never returns tokens, installation tokens, private keys,
  Authorization headers, or DB connection strings in any response.
- Errors are sanitized: no stack traces, no internal auth info.
- Logs never print secrets (the sync script only logs repo, ref, commit, counts).
- The `dist` branch must not contain `.env`, credentials, dev deps, or source.

## Sessions

- Cookie `gp_admin_session` is `HttpOnly`, `Secure` (production), `SameSite=Lax`,
  with a bounded `maxAge` (default 8h).
- The cookie carries an opaque random token (stored as a SHA-256 hash in the DB)
  plus an HMAC tag over `SESSION_SECRET` for integrity.
- Tokens are revocable (`logout`, disable user) and expiring.
- CSRF uses a double-submit token: a non-HttpOnly `gp_admin_csrf` cookie echoed
  back via the `x-csrf-token` header on every mutating request. `/login` is exempt.

## Auth & roles

- GitHub OAuth (production) or dev credentials (local only).
- `ADMIN_GITHUB_USERS` is the allowlist; non-allowlisted GitHub users are
  rejected with an audit log entry.
- Three roles: Viewer, Editor, Admin (see [admin-guide.md](./admin-guide.md)).
- Every write endpoint calls `requireSession` + `requireRole`/`requirePermission`
  on the server. Frontend button-hiding is cosmetic, never the security boundary.
- Disabled admins' existing sessions are rejected (re-login required).

## Game isolation (iframe)

- Game `entry` is resolved to a **relative** path under `games/<id>/`. The portal
  never accepts an arbitrary external iframe URL.
- `iframe.allow` and `iframe.sandbox` tokens come from a server-side whitelist.
- `allow-scripts` + `allow-same-origin` are always present; the sandbox cannot be
  fully disabled.
- Game communication uses `postMessage` with origin + `source` + `gameId` +
  type validation (`@game-platform/game-sdk`). Unknown messages are ignored;
  payloads are never executed; URLs in payloads are never fetched.
- Third-party untrusted games should future-run on a separate subdomain.

## File handling (covers)

- Allowed: PNG, JPEG, WebP (verified by **magic bytes**, not extension/MIME).
- Max size `ADMIN_MAX_UPLOAD_MB` (default 5 MB).
- Filenames are regenerated; path traversal and cross-directory writes rejected.
- SVG is rejected by default (script-injection risk).

## Sync safety

- Archive download is size-capped and timed out.
- Tar extraction rejects `../`, absolute paths, Windows drive letters, and
  symlink/hardlink entries (section 13.3).
- Validation failure never overwrites the last good `public/games/`.
- Stale cache is opt-in (`GAMES_ALLOW_STALE_CACHE=false` by default) and clearly
  surfaced when used.

## API hardening (section 32.1)

- All writes require auth + role.
- `Origin` checked against `ADMIN_ALLOWED_ORIGINS`.
- Per-IP rate limit (`ADMIN_RATE_LIMIT_PER_MINUTE`).
- Request body size limited.
- Schema validation (shared Zod) on all inputs.
- Stable error codes; no internal stack in responses.
- Idempotent high-risk operations; duplicate-submit protection.

## What is explicitly not allowed

- The admin UI cannot edit GitHub Actions YAML or build commands.
- The admin UI cannot input an arbitrary external game URL.
- The admin UI cannot run `npm install` or arbitrary server commands.
- The portal CI does not build remote game source.
- The admin UI does not directly edit the `dist` branch.
