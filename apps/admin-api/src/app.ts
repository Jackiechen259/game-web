import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import * as path from "node:path";
import type { ApiConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import type { Store } from "./store.ts";
import { SessionService, csrfGuard, type SessionCookieConfig } from "./auth/session.ts";
import { LocalRepositoryService } from "./local-repo.ts";
import { GitHubRepositoryService } from "./github-service.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { createGamesRouter } from "./routes/games.ts";
import { createPublishingRouter } from "./routes/publishing.ts";
import { createSystemRouter } from "./routes/system.ts";
import { originGuard, rateLimit } from "./auth/middleware.ts";
import { AppError, NotFoundError } from "./app-error.ts";
import { ApiErrorCode } from "@game-platform/admin-types";

export function createRepository(config: ApiConfig) {
  const seedFrom = path.join(config.repoRoot, "tests", "fixtures", "games-library-dist");
  if (config.repositoryBackend === "github") {
    return new GitHubRepositoryService(config);
  }
  return new LocalRepositoryService(config.localRepoPath, config.draftBranch, seedFrom);
}

export function buildContext(config: ApiConfig, store: Store): AppContext {
  const repo = createRepository(config);
  const cookieConfig: SessionCookieConfig = {
    secure: config.nodeEnv === "production",
    maxAgeSeconds: config.sessionMaxAgeSeconds,
  };
  const session = new SessionService(store, cookieConfig, config.sessionSecret);
  return { config, store, repo, session, startedAt: new Date().toISOString() };
}

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Body parsing (covers uploaded as base64 JSON need a generous limit).
  app.use(express.json({ limit: Math.max(ctx.config.maxUploadBytes * 2, 2 * 1024 * 1024) }));
  app.use(cookieParser());
  app.use(originGuard(ctx.config));

  const v1 = express.Router();
  v1.use(csrfGuard);
  v1.use("/", createAuthRouter(ctx));
  v1.use("/games", createGamesRouter(ctx));
  v1.use("/publishing", createPublishingRouter(ctx));
  v1.use("/", createSystemRouter(ctx)); // dashboard, catalog, settings, deployments, releases, audit, previews

  app.use("/api/admin/v1", rateLimit(ctx.config.rateLimitPerMinute), v1);

  app.get("/api/health", (_req, res) => res.json({ ok: true, startedAt: ctx.startedAt }));

  // 404 for everything else.
  app.use((_req, _res, next) => next(new NotFoundError("Route")));

  // Error handler: never leak secrets or internal stack traces.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      // Conflict (section 23) uses a flat shape.
      if (err.code === ApiErrorCode.CONFIG_CONFLICT && err.details) {
        const d = err.details as { currentSha: string; expectedSha: string };
        res.status(err.statusCode).json({
          code: err.code,
          message: err.message,
          currentSha: d.currentSha,
          expectedSha: d.expectedSha,
        });
        return;
      }
      const body = {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      };
      res.status(err.statusCode).json(body);
      return;
    }
    // Unknown errors: log server-side, return a generic message.
    console.error("[admin-api] unhandled error:", err);
    res.status(500).json({ error: { code: ApiErrorCode.INTERNAL, message: "An unexpected error occurred." } });
  });

  return app;
}
