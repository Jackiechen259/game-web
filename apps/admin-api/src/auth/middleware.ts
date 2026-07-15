import type { NextFunction, Request, Response } from "express";
import type { AdminUser, Permission, Role } from "@game-platform/admin-types";
import { can, hasRole } from "@game-platform/admin-types";
import type { ApiConfig } from "../config.ts";
import type { SessionService } from "./session.ts";
import { BadOriginError, ForbiddenError, RateLimitError, UnauthorizedError } from "../app-error.ts";

// Augment Express Request with the authenticated admin user (core v5 uses the
// global Express.Request namespace as the merge target).
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
      sessionId?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export function requireSession(session: SessionService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const active = session.read(req);
    if (!active) return next(new UnauthorizedError());
    req.adminUser = active.user;
    req.sessionId = active.sessionId;
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.adminUser) return next(new UnauthorizedError());
    if (!hasRole(req.adminUser.role, role)) return next(new ForbiddenError());
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.adminUser) return next(new UnauthorizedError());
    if (!can(req.adminUser.role, permission)) return next(new ForbiddenError());
    next();
  };
}

export function originGuard(config: ApiConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (config.allowedOrigins.length === 0) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (!config.allowedOrigins.includes(origin)) return next(new BadOriginError());
    next();
  };
}

/** Simple in-memory per-IP rate limiter (section 32.1). */
export function rateLimit(perMinute: number) {
  const hits = new Map<string, number[]>();
  const windowMs = 60_000;
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = (req.ip || req.socket?.remoteAddress || "unknown") as string;
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= perMinute) {
      return next(new RateLimitError());
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}
