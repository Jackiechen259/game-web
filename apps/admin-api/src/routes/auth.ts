import { Router } from "express";
import type { AppContext } from "../context.ts";
import { AuditAction } from "@game-platform/admin-types";
import { CSRF_COOKIE } from "../auth/session.ts";
import { sha256hex } from "../auth/crypto.ts";
import { exchangeCode, fetchGithubUser } from "../auth/oauth.ts";
import { AppError, ForbiddenError, UnauthorizedError } from "../app-error.ts";
import { audit } from "../audit.ts";

export function createAuthRouter(ctx: AppContext): Router {
  const router = Router();

  // GET /session
  router.get("/session", (req, res) => {
    const session = ctx.session.read(req);
    const csrfToken = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    res.json({ user: session ? session.user : null, csrfToken: csrfToken ?? null });
  });

  // POST /login (dev provider) - username/password
  router.post("/login", async (req, res, next) => {
    try {
      if (ctx.config.authProvider !== "dev") {
        throw new AppError(400, "VALIDATION_FAILED", "Dev login is not enabled. Set AUTH_PROVIDER=dev for local development.");
      }
      const { login, password } = (req.body ?? {}) as { login?: string; password?: string };
      if (!login || !password) throw new AppError(400, "VALIDATION_FAILED", "login and password are required.");
      if (login !== ctx.config.devAdminLogin || password !== ctx.config.devAdminPassword) {
        audit(ctx, req, { action: AuditAction.LOGIN_FAILURE, resourceType: "session", resourceId: login ?? "unknown", result: "failure" });
        throw new UnauthorizedError("Invalid credentials.");
      }
      let user = ctx.store.getUserByLogin(login);
      if (!user) {
        user = ctx.store.createUser({ provider: "dev", providerUserId: login, login, role: "admin" });
      } else if (!user.enabled) {
        throw new ForbiddenError("This account is disabled.");
      }
      const created = ctx.session.create(res, user, {
        ipHash: sha256hex(req.ip || ""),
        userAgent: req.headers["user-agent"],
      });
      audit(ctx, req, { action: AuditAction.LOGIN_SUCCESS, resourceType: "session", resourceId: user.id });
      res.json({ user: created.user, csrfToken: created.csrfToken });
    } catch (err) {
      next(err);
    }
  });

  // GET /login/oauth -> redirect to GitHub
  router.get("/login/oauth", (_req, res, next) => {
    try {
      if (ctx.config.authProvider !== "github") throw new AppError(400, "VALIDATION_FAILED", "GitHub OAuth is not enabled.");
      if (!ctx.config.githubOAuthClientId) throw new AppError(500, "INTERNAL", "GitHub OAuth client id is not configured.");
      const redirectUri = `${ctx.config.publicAdminUrl ?? ""}/api/admin/v1/login/callback`;
      const state = Math.random().toString(36).slice(2);
      const params = new URLSearchParams({
        client_id: ctx.config.githubOAuthClientId,
        redirect_uri: redirectUri,
        scope: "read:user",
        state,
      });
      res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    } catch (err) {
      next(err);
    }
  });

  // GET /login/callback -> exchange code, create session, redirect to admin
  router.get("/login/callback", async (req, res, next) => {
    try {
      const code = (req.query.code as string | undefined) ?? "";
      if (!code) throw new UnauthorizedError("Missing OAuth code.");
      if (!ctx.config.githubOAuthClientId || !ctx.config.githubOAuthClientSecret) {
        throw new AppError(500, "INTERNAL", "GitHub OAuth is not configured.");
      }
      const redirectUri = `${ctx.config.publicAdminUrl ?? ""}/api/admin/v1/login/callback`;
      const accessToken = await exchangeCode(code, ctx.config.githubOAuthClientId, ctx.config.githubOAuthClientSecret, redirectUri);
      const ghUser = await fetchGithubUser(accessToken);
      if (!ctx.config.adminGithubUsers.includes(ghUser.login)) {
        audit(ctx, req, { action: AuditAction.LOGIN_FAILURE, resourceType: "session", resourceId: ghUser.login, result: "failure", errorCode: "NOT_WHITELISTED" });
        throw new ForbiddenError(`GitHub user "${ghUser.login}" is not an administrator.`);
      }
      let user = ctx.store.getUserByProvider("github", String(ghUser.id));
      if (!user) {
        user = ctx.store.createUser({ provider: "github", providerUserId: String(ghUser.id), login: ghUser.login, role: "admin" });
      } else if (!user.enabled) {
        throw new ForbiddenError("This account is disabled.");
      }
      ctx.session.create(res, user, {
        ipHash: sha256hex(req.ip || ""),
        userAgent: req.headers["user-agent"],
      });
      audit(ctx, req, { action: AuditAction.LOGIN_SUCCESS, resourceType: "session", resourceId: user.id });
      res.redirect(ctx.config.publicAdminUrl ?? "/");
    } catch (err) {
      next(err);
    }
  });

  // POST /logout
  router.post("/logout", (req, res, next) => {
    try {
      const session = ctx.session.read(req);
      if (session) {
        ctx.session.clear(res, session.sessionId);
        audit(ctx, req, { action: AuditAction.LOGOUT, resourceType: "session", resourceId: session.user.id });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
