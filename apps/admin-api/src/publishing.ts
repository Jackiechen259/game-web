import type { AppContext } from "./context.ts";
import type {
  PrepareResponse,
  PublishingStatusResponse,
  PublishJob,
} from "@game-platform/admin-types";
import { AppError } from "./app-error.ts";
import { validateCatalogAll } from "./validation.ts";

/** Current publishing status (active or most recent job). */
export function getPublishingStatus(ctx: AppContext): PublishingStatusResponse {
  const active = ctx.store.getActivePublishJob();
  if (active) return { status: active.status, publishJob: active };
  const recent = ctx.store.listRecentPublishJobs(1)[0];
  return { status: recent ? recent.status : "idle", publishJob: recent };
}

/** Validate all drafts; returns whether publishing would be allowed. */
export async function preparePublish(ctx: AppContext): Promise<PrepareResponse> {
  const validation = await validateCatalogAll(ctx);
  return { prepared: validation.valid, validation };
}

/** Create a publish (pull request by default) and trigger portal redeploy. */
export async function publish(ctx: AppContext, actorId: string, actorLogin: string): Promise<PublishJob> {
  const active = ctx.store.getActivePublishJob();
  if (active) {
    throw new AppError(409, "PUBLISH_IN_PROGRESS", "A publish is already in progress.", { publishJobId: active.id });
  }
  const validation = await validateCatalogAll(ctx);
  if (!validation.valid) {
    throw new AppError(422, "VALIDATION_FAILED", "Catalog validation failed; cannot publish.", { validation });
  }

  const job = ctx.store.createPublishJob({
    actorId,
    actorLogin,
    sourceBranch: ctx.config.draftBranch,
    status: "publishing",
  });

  try {
    const title = `Publish games (${new Date().toISOString()})`;
    const body = `Publish all draft game configurations from \`${ctx.config.draftBranch}\` into \`${ctx.config.sourceBranch}\`.`;
    const pr = await ctx.repo.createPublishPullRequest(
      ctx.config.draftBranch,
      ctx.config.sourceBranch,
      title,
      body,
      actorLogin,
    );
    ctx.store.updatePublishJob(job.id, {
      pullRequestNumber: pr.number,
      pullRequestUrl: pr.url,
      sourceCommit: pr.headBranch,
    });

    // Notify the portal to rebuild via repository_dispatch.
    await ctx.repo.triggerPortalDeployment({
      source_repository: ctx.config.gameLibraryRepo,
      source_commit: pr.headBranch,
      dist_commit: "",
      catalog_schema_version: 1,
    });

    if (ctx.config.repositoryBackend === "local") {
      // Local backend completes synchronously (no real CI).
      const distCommit = `local-${Date.now().toString(36)}`;
      ctx.store.createDeployment({
        publishJobId: job.id,
        repository: ctx.config.gameLibraryRepo,
        status: "success",
        stage: "games-library-build",
        startedAt: job.createdAt,
        completedAt: new Date().toISOString(),
      });
      ctx.store.createDeployment({
        publishJobId: job.id,
        repository: ctx.config.portalRepo,
        status: "success",
        stage: "portal-deploy",
        startedAt: job.createdAt,
        completedAt: new Date().toISOString(),
      });
      ctx.store.updatePublishJob(job.id, { status: "published", distCommit });
    } else {
      ctx.store.createDeployment({
        publishJobId: job.id,
        repository: ctx.config.gameLibraryRepo,
        status: "in_progress",
        stage: "games-library-build",
        startedAt: job.createdAt,
      });
    }
    return ctx.store.getPublishJob(job.id)!;
  } catch (err) {
    ctx.store.updatePublishJob(job.id, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function cancelPublish(ctx: AppContext): { cancelled: boolean } {
  const active = ctx.store.getActivePublishJob();
  if (!active) return { cancelled: false };
  ctx.store.updatePublishJob(active.id, { status: "cancelled" });
  return { cancelled: true };
}

/**
 * Best-effort refresh of deployment statuses from GitHub Actions (production
 * backend). Local backend is a no-op. The admin UI polls /deployments.
 */
export async function refreshDeployments(ctx: AppContext): Promise<void> {
  if (ctx.config.repositoryBackend !== "github") return;
  const inProgress = ctx.store.listDeployments(20).filter((d) => d.status === "in_progress");
  if (inProgress.length === 0) return;
  const runs = await ctx.repo.getWorkflowRuns(ctx.config.portalRepo, 10);
  const latest = runs[0];
  if (!latest) return;
  for (const dep of inProgress) {
    if (latest.conclusion === "success") {
      ctx.store.updateDeployment(dep.id, { status: "success", completedAt: latest.updatedAt, workflowRunId: latest.id, workflowRunUrl: latest.htmlUrl });
    } else if (latest.conclusion && latest.conclusion !== "success") {
      ctx.store.updateDeployment(dep.id, { status: "failure", completedAt: latest.updatedAt, errorMessage: `Workflow ${latest.conclusion}`, workflowRunId: latest.id, workflowRunUrl: latest.htmlUrl });
    }
  }
}
