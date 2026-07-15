import { Router } from "express";
import { z } from "zod";
import { settingsSchema, type SiteSettings } from "@game-platform/game-schema";
import type { AppContext } from "../context.ts";
import {
  ApiErrorCode,
  AuditAction,
  type DashboardStats,
  type GameListItem,
  type AuditLogQuery,
  type Release,
} from "@game-platform/admin-types";
import { AppError, NotFoundError, ValidationError } from "../app-error.ts";
import { audit } from "../audit.ts";
import { validateCatalogAll } from "../validation.ts";
import { refreshDeployments } from "../publishing.ts";
import { requirePermission, requireRole, requireSession } from "../auth/middleware.ts";
import { sha256hex } from "../auth/crypto.ts";

function configStatusFor(status: string): GameListItem["configStatus"] {
  return status === "published" || status === "archived" ? "published" : "draft";
}

function toRelease(job: {
  id: string;
  createdAt: string;
  sourceCommit?: string;
  distCommit?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  portalRunId?: number;
  status: Release["status"];
}): Release {
  return {
    id: job.id,
    publishedAt: job.createdAt,
    sourceCommit: job.sourceCommit,
    distCommit: job.distCommit,
    pullRequestNumber: job.pullRequestNumber,
    pullRequestUrl: job.pullRequestUrl,
    portalRunId: job.portalRunId,
    status: job.status,
  };
}

const settingsUpdateSchema = z.object({
  expectedSha: z.string().min(1),
  settings: settingsSchema,
});

export function createSystemRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireSession(ctx.session));

  // GET /dashboard
  router.get("/dashboard", async (_req, res, next) => {
    try {
      const configs = await ctx.repo.listGameConfigs();
      const count = (s: string) => configs.filter((c) => c.config.status === s).length;
      const recentDeployments = ctx.store.listRecentDeployments(5);
      const failedBuilds = ctx.store.listDeployments(100).filter((d) => d.status === "failure").length;
      const recentlyModified = [...configs]
        .sort((a, b) => b.config.updatedAt.localeCompare(a.config.updatedAt))
        .slice(0, 5)
        .map<GameListItem>((f) => ({
          id: f.config.id,
          title: f.config.title,
          version: f.config.version,
          status: f.config.status,
          featured: f.config.featured,
          categories: f.config.categories,
          cover: f.config.cover,
          updatedAt: f.config.updatedAt,
          configStatus: configStatusFor(f.config.status),
          buildStatus: "unknown",
          configSha: f.sha,
        }));
      const stats: DashboardStats = {
        total: configs.length,
        published: count("published"),
        beta: count("beta"),
        development: count("development"),
        archived: count("archived"),
        drafts: count("development") + count("beta"),
        recentReleases: ctx.store.listRecentPublishJobs(5).map(toRelease),
        recentDeployments,
        failedBuilds,
        recentlyModified,
      };
      res.json(stats);
    } catch (err) {
      next(err);
    }
  });

  // POST /catalog/validate
  router.post("/catalog/validate", requirePermission("validate"), async (_req, res, next) => {
    try {
      const result = await validateCatalogAll(ctx);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /settings
  router.get("/settings", async (_req, res, next) => {
    try {
      const settings = await ctx.repo.getSettings();
      if (!settings) throw new NotFoundError("Settings");
      res.json({ settings: settings.settings, sha: settings.sha });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /settings (admin)
  router.patch("/settings", requireRole("admin"), async (req, res, next) => {
    try {
      const parsed = settingsUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Invalid settings input.", parsed.error.issues);
      const existing = await ctx.repo.getSettings();
      if (!existing) throw new NotFoundError("Settings");
      const result = await ctx.repo.updateSettings(parsed.data.settings as SiteSettings, parsed.data.expectedSha, req.adminUser!.login);
      audit(ctx, req, { action: AuditAction.SETTINGS_UPDATE, resourceType: "settings", resourceId: "site", before: existing.settings, after: parsed.data.settings, commitSha: result.sha });
      res.json({ ok: true, sha: result.sha });
    } catch (err) {
      next(err);
    }
  });

  // GET /deployments
  router.get("/deployments", async (_req, res, next) => {
    try {
      await refreshDeployments(ctx).catch(() => undefined);
      const deployments = ctx.store.listDeployments(50);
      res.json({ deployments });
    } catch (err) {
      next(err);
    }
  });

  // GET /deployments/:id
  router.get("/deployments/:id", (req, res, next) => {
    try {
      const deployment = ctx.store.getDeployment((req.params.id as string));
      if (!deployment) throw new NotFoundError("Deployment");
      res.json({ deployment });
    } catch (err) {
      next(err);
    }
  });

  // POST /deployments/retry (admin) - re-trigger portal deployment
  router.post("/deployments/retry", requireRole("admin"), async (req, res, next) => {
    try {
      await ctx.repo.triggerPortalDeployment({ retry: true, triggered_by: req.adminUser!.login });
      const deployment = ctx.store.createDeployment({
        repository: ctx.config.portalRepo,
        status: ctx.config.repositoryBackend === "local" ? "success" : "in_progress",
        stage: "portal-deploy",
        startedAt: new Date().toISOString(),
      });
      audit(ctx, req, { action: AuditAction.DEPLOY_RETRY, resourceType: "deployment", resourceId: deployment.id });
      res.json({ deployment });
    } catch (err) {
      next(err);
    }
  });

  // GET /releases
  router.get("/releases", (_req, res) => {
    const jobs = ctx.store.listRecentPublishJobs(50);
    res.json({ releases: jobs.map(toRelease) });
  });

  // POST /releases/:id/rollback (admin)
  router.post("/releases/:id/rollback", requireRole("admin"), async (req, res, next) => {
    try {
      const job = ctx.store.getPublishJob((req.params.id as string));
      if (!job) throw new NotFoundError("Release");
      const target = job.distCommit ?? job.sourceCommit ?? "";
      if (!target) throw new ValidationError("Release has no commit to roll back to.");
      const result = await ctx.repo.rollback(target, ctx.config.sourceBranch, req.adminUser!.login);
      audit(ctx, req, {
        action: AuditAction.ROLLBACK,
        resourceType: "release",
        resourceId: job.id,
        commitSha: result.sha,
        result: "success",
      });
      res.json({
        release: toRelease(job),
        rollbackPrUrl: result.commitUrl,
        commitSha: result.sha,
      });
    } catch (err) {
      audit(ctx, req, { action: AuditAction.ROLLBACK, resourceType: "release", resourceId: (req.params.id as string), result: "failure", errorCode: err instanceof Error ? err.name : "ERROR" });
      next(err);
    }
  });

  // GET /audit
  router.get("/audit", (req, res, next) => {
    try {
      const query: AuditLogQuery = {
        action: req.query.action as string | undefined,
        actorLogin: req.query.actorLogin as string | undefined,
        resourceType: req.query.resourceType as AuditLogQuery["resourceType"],
        resourceId: req.query.resourceId as string | undefined,
        result: req.query.result as "success" | "failure" | undefined,
        page: parseInt((req.query.page as string) ?? "1", 10) || 1,
        pageSize: parseInt((req.query.pageSize as string) ?? "50", 10) || 50,
      };
      const result = ctx.store.listAuditLogs(query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /previews/:previewId - token metadata
  router.get("/previews/:previewId", (req, res, next) => {
    try {
      const tokenHash = sha256hex((req.params.previewId as string));
      const token = ctx.store.getPreviewTokenByHash(tokenHash);
      if (!token) throw new NotFoundError("Preview");
      if (token.revokedAt || new Date(token.expiresAt).getTime() < Date.now()) {
        throw new AppError(410, ApiErrorCode.PREVIEW_EXPIRED, "Preview token has expired or been revoked.");
      }
      res.json({
        previewId: token.id,
        gameId: token.gameId,
        commitSha: token.commitSha,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
