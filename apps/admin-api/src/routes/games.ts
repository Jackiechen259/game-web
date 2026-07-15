import { Router } from "express";
import type { AppContext } from "../context.ts";
import { createGameInputSchema, updateGameInputSchema, ApiErrorCode, AuditAction, type BuildStatus, type GameListItem } from "@game-platform/admin-types";
import { AppError, NotFoundError, ValidationError } from "../app-error.ts";
import { audit } from "../audit.ts";
import { validateSingleGame } from "../validation.ts";
import { randomToken, sha256hex } from "../auth/crypto.ts";
import { requirePermission, requireRole, requireSession } from "../auth/middleware.ts";
import { z } from "zod";

function configStatusFor(status: string): GameListItem["configStatus"] {
  if (status === "published" || status === "archived") return "published";
  return "draft";
}

function globalBuildStatus(ctx: AppContext): BuildStatus {
  const recent = ctx.store.listRecentPublishJobs(1)[0];
  if (!recent) return "unknown";
  if (recent.status === "published") return "success";
  if (recent.status === "publishing" || recent.status === "validating" || recent.status === "preparing") return "pending";
  if (recent.status === "failed") return "failure";
  return "unknown";
}

const coverUploadSchema = z.object({
  base64: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
});

export function createGamesRouter(ctx: AppContext): Router {
  const router = Router();

  // All admin game routes require a session.
  router.use(requireSession(ctx.session));

  // GET /games
  router.get("/", async (req, res, next) => {
    try {
      const q = (req.query.q as string | undefined)?.toLowerCase().trim();
      const status = req.query.status as string | undefined;
      const category = req.query.category as string | undefined;
      const sort = (req.query.sort as string | undefined) ?? "updatedAt";
      const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? "50", 10) || 50));

      let configs = await ctx.repo.listGameConfigs();
      const buildStatus = globalBuildStatus(ctx);
      if (status) configs = configs.filter((c) => c.config.status === status);
      if (category) configs = configs.filter((c) => c.config.categories.includes(category));
      if (q) {
        configs = configs.filter(
          (c) =>
            c.config.title.toLowerCase().includes(q) ||
            c.config.id.toLowerCase().includes(q) ||
            c.config.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      switch (sort) {
        case "title":
          configs.sort((a, b) => a.config.title.localeCompare(b.config.title));
          break;
        case "displayOrder":
          configs.sort((a, b) => (a.config.displayOrder ?? 0) - (b.config.displayOrder ?? 0));
          break;
        case "updatedAt":
        default:
          configs.sort((a, b) => b.config.updatedAt.localeCompare(a.config.updatedAt));
          break;
      }
      const total = configs.length;
      const paged = configs.slice((page - 1) * pageSize, page * pageSize);
      const games: GameListItem[] = paged.map((f) => ({
        id: f.config.id,
        title: f.config.title,
        version: f.config.version,
        status: f.config.status,
        featured: f.config.featured,
        categories: f.config.categories,
        cover: f.config.cover,
        updatedAt: f.config.updatedAt,
        configStatus: configStatusFor(f.config.status),
        buildStatus,
        configSha: f.sha,
      }));
      res.json({ games, total, page, pageSize });
    } catch (err) {
      next(err);
    }
  });

  // GET /games/:id
  router.get("/:id", async (req, res, next) => {
    try {
      const game = await ctx.repo.getGame((req.params.id as string));
      if (!game) throw new NotFoundError(`Game ${(req.params.id as string)}`);
      res.json({
        game: game.config,
        sha: game.sha,
        configStatus: configStatusFor(game.config.status),
        buildStatus: globalBuildStatus(ctx),
        previewUrl: `/games/${game.config.id}`,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /games (editor+)
  router.post("/", requirePermission("write"), async (req, res, next) => {
    try {
      const parsed = createGameInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Invalid game input.", parsed.error.issues);
      const result = await ctx.repo.createGame(parsed.data, req.adminUser!.login);
      audit(ctx, req, {
        action: AuditAction.GAME_CREATE,
        resourceType: "game",
        resourceId: parsed.data.id,
        after: parsed.data,
        commitSha: result.sha,
      });
      res.status(201).json({ game: (await ctx.repo.getGame(parsed.data.id))!.config, sha: result.sha, branch: result.branch });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /games/:id (editor+)
  router.patch("/:id", requirePermission("write"), async (req, res, next) => {
    try {
      const parsed = updateGameInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Invalid update input.", parsed.error.issues);
      const before = await ctx.repo.getGame((req.params.id as string));
      const result = await ctx.repo.updateGame((req.params.id as string), parsed.data, parsed.data.expectedSha, req.adminUser!.login);
      audit(ctx, req, {
        action: AuditAction.GAME_UPDATE,
        resourceType: "game",
        resourceId: (req.params.id as string),
        before: before?.config,
        after: parsed.data,
        commitSha: result.sha,
      });
      res.json({ game: (await ctx.repo.getGame((req.params.id as string)))!.config, sha: result.sha, branch: result.branch });
    } catch (err) {
      next(err);
    }
  });

  // POST /games/:id/archive (editor+)
  router.post("/:id/archive", requirePermission("write"), async (req, res, next) => {
    try {
      const { expectedSha } = (req.body ?? {}) as { expectedSha?: string };
      if (!expectedSha) throw new ValidationError("expectedSha is required.");
      const before = await ctx.repo.getGame((req.params.id as string));
      const result = await ctx.repo.archiveGame((req.params.id as string), expectedSha, req.adminUser!.login);
      audit(ctx, req, { action: AuditAction.GAME_ARCHIVE, resourceType: "game", resourceId: (req.params.id as string), before: before?.config, commitSha: result.sha });
      res.json({ game: (await ctx.repo.getGame((req.params.id as string)))!.config, sha: result.sha });
    } catch (err) {
      next(err);
    }
  });

  // POST /games/:id/restore (editor+)
  router.post("/:id/restore", requirePermission("write"), async (req, res, next) => {
    try {
      const { expectedSha } = (req.body ?? {}) as { expectedSha?: string };
      if (!expectedSha) throw new ValidationError("expectedSha is required.");
      const before = await ctx.repo.getGame((req.params.id as string));
      const result = await ctx.repo.restoreGame((req.params.id as string), expectedSha, req.adminUser!.login);
      audit(ctx, req, { action: AuditAction.GAME_RESTORE, resourceType: "game", resourceId: (req.params.id as string), before: before?.config, commitSha: result.sha });
      res.json({ game: (await ctx.repo.getGame((req.params.id as string)))!.config, sha: result.sha });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /games/:id - permanent delete not opened in v1 (admin-only, not implemented)
  router.delete("/:id", requireRole("admin"), (_req, _res, next) => {
    next(new AppError(501, ApiErrorCode.NOT_IMPLEMENTED, "Permanent deletion is not enabled in this version. Archive games instead."));
  });

  // POST /games/:id/validate (editor+)
  router.post("/:id/validate", requirePermission("validate"), async (req, res, next) => {
    try {
      const result = await validateSingleGame(ctx, (req.params.id as string));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /games/:id/cover (editor+) - JSON {data: base64, filename, contentType}
  router.post("/:id/cover", requirePermission("upload"), async (req, res, next) => {
    try {
      const parsed = coverUploadSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Invalid cover upload.", parsed.error.issues);
      const data = Buffer.from(parsed.data.base64, "base64");
      if (data.length > ctx.config.maxUploadBytes) {
        throw new AppError(413, ApiErrorCode.FILE_TOO_LARGE, `Cover exceeds the maximum allowed size of ${ctx.config.maxUploadBytes / 1024 / 1024} MB.`);
      }
      const game = await ctx.repo.getGame((req.params.id as string));
      if (!game) throw new NotFoundError(`Game ${(req.params.id as string)}`);
      const result = await ctx.repo.uploadCover((req.params.id as string), data, parsed.data.filename, parsed.data.contentType, req.adminUser!.login);
      audit(ctx, req, { action: AuditAction.COVER_UPLOAD, resourceType: "game", resourceId: (req.params.id as string), after: { cover: result.cover }, commitSha: result.sha });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /games/:id/cover (editor+)
  router.delete("/:id/cover", requirePermission("upload"), async (req, res, next) => {
    try {
      const { cover, expectedSha } = (req.body ?? {}) as { cover?: string; expectedSha?: string };
      if (!cover) throw new ValidationError("cover path is required.");
      const result = await ctx.repo.deleteCover((req.params.id as string), cover, expectedSha ?? "", req.adminUser!.login);
      audit(ctx, req, { action: AuditAction.COVER_DELETE, resourceType: "game", resourceId: (req.params.id as string) });
      res.json({ ok: true, sha: result.sha });
    } catch (err) {
      next(err);
    }
  });

  // POST /games/:id/preview (editor+) - create a preview token
  router.post("/:id/preview", requirePermission("preview"), async (req, res, next) => {
    try {
      const game = await ctx.repo.getGame((req.params.id as string));
      if (!game) throw new NotFoundError(`Game ${(req.params.id as string)}`);
      const token = randomToken(32);
      const tokenHash = sha256hex(token);
      const expiresAt = new Date(Date.now() + ctx.config.previewTokenTtlSeconds * 1000).toISOString();
      const stored = ctx.store.createPreviewToken({ tokenHash, gameId: (req.params.id as string), commitSha: game.sha, expiresAt });
      audit(ctx, req, { action: "preview.create", resourceType: "preview", resourceId: stored.id });
      res.json({
        previewId: token,
        url: `/games/${(req.params.id as string)}`,
        commitSha: game.sha,
        expiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
