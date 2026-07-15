import { Router } from "express";
import type { AppContext } from "../context.ts";
import { AuditAction } from "@game-platform/admin-types";
import { audit } from "../audit.ts";
import { cancelPublish, getPublishingStatus, preparePublish, publish } from "../publishing.ts";
import { requirePermission, requireSession } from "../auth/middleware.ts";

export function createPublishingRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireSession(ctx.session));

  // GET /publishing/status
  router.get("/status", (_req, res) => {
    res.json(getPublishingStatus(ctx));
  });

  // POST /publishing/prepare (validate all drafts)
  router.post("/prepare", requirePermission("validate"), async (req, res, next) => {
    try {
      const result = await preparePublish(ctx);
      audit(ctx, req, { action: AuditAction.PUBLISH_PREPARE, resourceType: "release", resourceId: "catalog" });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /publishing/publish (admin)
  router.post("/publish", requirePermission("publish"), async (req, res, next) => {
    try {
      const job = await publish(ctx, req.adminUser!.id, req.adminUser!.login);
      audit(ctx, req, {
        action: AuditAction.PUBLISH_CREATE,
        resourceType: "release",
        resourceId: job.id,
        pullRequestNumber: job.pullRequestNumber,
        commitSha: job.distCommit,
      });
      res.json({ publishJob: job });
    } catch (err) {
      audit(ctx, req, {
        action: AuditAction.PUBLISH_CREATE,
        resourceType: "release",
        resourceId: "unknown",
        result: "failure",
        errorCode: err instanceof Error ? err.name : "ERROR",
      });
      next(err);
    }
  });

  // POST /publishing/cancel (admin)
  router.post("/cancel", requirePermission("publish"), (req, res, next) => {
    try {
      const result = cancelPublish(ctx);
      audit(ctx, req, { action: AuditAction.PUBLISH_CANCEL, resourceType: "release", resourceId: "active" });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
