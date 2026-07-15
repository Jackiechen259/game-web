# Admin Guide

How to operate the `/admin` backend.

## Logging in

- **Dev**: set `AUTH_PROVIDER=dev`, `DEV_ADMIN_LOGIN`, `DEV_ADMIN_PASSWORD`.
  Log in at `/admin/login` with those credentials. Dev logins get the `admin`
  role by default. Never use `dev` in production.
- **Production**: `AUTH_PROVIDER=github` + GitHub OAuth. Your GitHub login must
  be in `ADMIN_GITHUB_USERS`. Visit `/admin/login/oauth` to start the OAuth flow.

## Roles (section 20)

| Role | Can | Cannot |
| --- | --- | --- |
| **Viewer** | read games, settings, publish/deploy status, audit | mutate anything |
| **Editor** | create/edit games, upload covers, save drafts, validate, preview | publish, rollback, edit settings, manage users |
| **Admin** | everything, incl. publish, rollback, settings, retry deploy | - |

Server-side role checks are authoritative. The UI only *hides* buttons that the
current role cannot use; it never replaces a server check.

## Managing games

- **List**: `/admin/games` - search, filter by status/category, sort, paginate.
- **Create**: `/admin/games/new`. The `id` is immutable after creation; renaming
  is a migration, not an edit.
- **Edit**: `/admin/games/:id`. Saving always writes a **draft** (not live).
  Each save is validated with the shared schema before commit.
- **Cover**: upload PNG/JPEG/WebP (real magic bytes checked, ≤ 5 MB). SVG is
  rejected by default.
- **Archive / restore**: archives hide a game from public lists but keep its
  detail page and Git history. Restore returns it to `development`.
- **Preview**: `/admin/games/:id/preview` creates a short-lived preview token.

## Drafts and publishing

Drafts are saved to the `admin/drafts` branch (or the local repo in dev). Each
edit carries an `expectedSha`; if another admin changed the file meanwhile, the
server returns **409 Conflict** with the current SHA. You reload the latest
version and re-apply your changes - the server never silently overwrites another
admin's work.

Publishing (Admin only):

1. `/admin/publishing` -> **校验草稿** validates the whole catalog.
2. **发布** creates a Pull Request (`admin/drafts` -> `main`) and triggers the
   portal to redeploy. In `pull-request` mode the PR must be merged (manually
   or auto) before the games library CI rebuilds `dist`.
3. Watch `/admin/deployments` for the games-library build and portal deploy.
   A green GitHub API call is **not** success - the workflow's final
   conclusion is tracked.
4. **取消** cancels an in-progress publish.

## Rollback

`/admin/releases` -> **回滚** creates a *reverse* commit or rollback PR against
`main`. Git history is never deleted. The rollback re-deploys the previous
`dist` once merged.

## Site settings

`/admin/settings` (Admin). Edit non-secret settings: site name/description,
games per page, featured ids, navigation, feature flags, maintenance mode.
Secrets (GitHub App key, OAuth secret, session secret, DB URL) are always
environment variables and are **not** editable here.

## Audit log

`/admin/audit` records every sensitive action with actor, role, before/after
state, commit SHA, PR number, result and a hashed IP. Secrets are never logged.

## Conflicts

When two admins edit the same game, the second save gets a 409 with a conflict
banner showing both SHAs. Use **重新加载最新版本**, merge your changes, and
re-save. Unsaved changes are protected by a browser `beforeunload` prompt.
