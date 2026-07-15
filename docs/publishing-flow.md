# Publishing Flow

End-to-end path from a draft edit to a live game on the public portal.

```
 Admin edits game config (draft)
        │  expectedSha
        ▼
 Admin API validates schema ───── commit to admin/drafts branch
        │
        ▼
 Admin clicks 发布 (Admin role)
        │
        ▼
 Admin API: createPublishPullRequest(admin/drafts -> main)
        │
        ▼
 GitHub Actions (games library):
   validate schema → build affected games → check index.html + cover
   → generate dist/catalog.json + dist/settings.json → publish dist branch
        │
        ▼
 games-library CI: repository_dispatch -> portal (event: games-library-updated)
        │  { source_repository, source_commit, dist_commit }
        ▼
 GitHub Actions (portal):
   checkout → install → pnpm sync:games → pnpm validate:games
   → lint → typecheck → test → build → deploy
        │
        ▼
 Portal live (static): /games/<id>/index.html, refreshed /game-catalog.json
```

## Publish modes

- `ADMIN_PUBLISH_MODE=pull-request` (production default): a PR is created and
  must be merged before `dist` is rebuilt. This keeps an auditable review step.
- `ADMIN_PUBLISH_MODE=direct` (dev/test only): commits land directly; use only
  for throwaway environments.

## Status tracking

The admin API stores `publish_jobs` and `deployment_jobs` (section 29). The UI
at `/admin/publishing` and `/admin/deployments` shows:

- source commit, draft branch
- PR number + URL
- games-library workflow run + conclusion
- `dist` commit
- portal workflow run + conclusion
- started/completed timestamps, failed step, log link, retry button

A successful GitHub API call (e.g. dispatch accepted) is **not** treated as
deploy success. The workflow's final `conclusion` must be `success`.

## Rollback

`/admin/releases` lists past releases with their `dist` commit. Rolling back:

1. Creates a new branch `admin/publish-rollback-<sha>` from `main`.
2. Opens a rollback PR (reverse changes back to the target commit).
3. Once merged, games-library CI rebuilds `dist` at the prior state and
   re-dispatches the portal.

Git history is never deleted or force-pushed.

## Concurrency

- Only one active publish at a time (`PUBLISH_IN_PROGRESS` if another is
  running).
- Duplicate clicks do not create duplicate jobs.
- Every edit uses `expectedSha`; concurrent edits return 409.

## Local (dev) backend

With `REPOSITORY_BACKEND=local`, the admin API uses an on-disk repo under
`data/local-repo/` seeded from `tests/fixtures/games-library-dist`. Publish
completes synchronously (no real CI) so you can exercise the full flow locally.
Switch to `REPOSITORY_BACKEND=github` with the GitHub App configured for
production.
