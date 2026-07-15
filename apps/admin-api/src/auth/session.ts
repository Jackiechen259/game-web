import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Store } from "../store.ts";
import type { AdminUser } from "@game-platform/admin-types";
import { newId, randomToken, sha256hex } from "./crypto.ts";
import { CsrfError } from "../app-error.ts";

export const SESSION_COOKIE = "gp_admin_session";
export const CSRF_COOKIE = "gp_admin_csrf";

export interface SessionCookieConfig {
  secure: boolean;
  maxAgeSeconds: number;
}

export interface SessionMeta {
  ipHash?: string;
  userAgent?: string;
}

export interface ActiveSession {
  user: AdminUser;
  sessionId: string;
  expiresAt: string;
}

export interface CreatedSession {
  user: AdminUser;
  sessionId: string;
  csrfToken: string;
  cookieValue: string;
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Server-side session management. Session cookies carry an opaque random token
 * (looked up as a sha-256 hash in the DB) plus an HMAC tag derived from
 * SESSION_SECRET for integrity. Tokens are revocable and expiring.
 */
export class SessionService {
  private readonly store: Store;
  private readonly cookies: SessionCookieConfig;
  private readonly secret: string;

  constructor(store: Store, cookies: SessionCookieConfig, secret: string) {
    this.store = store;
    this.cookies = cookies;
    this.secret = secret;
  }

  private setCookie(res: Response, name: string, value: string, httpOnly: boolean): void {
    res.cookie(name, value, {
      httpOnly,
      secure: this.cookies.secure,
      sameSite: "lax",
      maxAge: this.cookies.maxAgeSeconds * 1000,
      path: "/",
    });
  }

  create(res: Response, user: AdminUser, meta: SessionMeta = {}): CreatedSession {
    const token = randomToken(32);
    const tokenHash = sha256hex(token);
    const id = newId();
    const expiresAt = new Date(Date.now() + this.cookies.maxAgeSeconds * 1000).toISOString();
    this.store.createSession({ id, userId: user.id, tokenHash, expiresAt, ipHash: meta.ipHash, userAgent: meta.userAgent });
    const base = `${id}.${token}`;
    const cookieValue = this.secret ? `${base}.${hmac(base, this.secret)}` : base;
    this.setCookie(res, SESSION_COOKIE, cookieValue, true);
    const csrfToken = randomToken(24);
    this.setCookie(res, CSRF_COOKIE, csrfToken, false);
    return { user, sessionId: id, csrfToken, cookieValue };
  }

  read(req: Request): ActiveSession | null {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!cookie) return null;
    const parts = cookie.split(".");
    let id: string;
    let token: string;
    if (this.secret) {
      if (parts.length !== 3) return null;
      id = parts[0];
      token = parts[1];
      const tag = parts[2];
      if (!id || !token || !tag) return null;
      if (!safeEqual(tag, hmac(`${id}.${token}`, this.secret))) return null;
    } else {
      if (parts.length !== 2) return null;
      id = parts[0];
      token = parts[1];
    }
    if (!id || !token) return null;
    const tokenHash = sha256hex(token);
    const session = this.store.getSessionByToken(tokenHash);
    if (!session || session.revokedAt) return null;
    if (session.id !== id) return null;
    const expiresAtMs = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return null;
    const user = this.store.getUserById(session.userId);
    if (!user || !user.enabled) return null;
    return { user, sessionId: session.id, expiresAt: session.expiresAt };
  }

  clear(res: Response, sessionId: string): void {
    this.store.revokeSession(sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(CSRF_COOKIE, { path: "/" });
  }
}

/** CSRF double-submit guard. Safe methods and the login path are exempt. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  // /login cannot present a CSRF token yet (the cookie is set during login).
  if (req.path === "/login") {
    return next();
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  const cookieToken = cookies?.[CSRF_COOKIE];
  const headerToken = req.header("x-csrf-token");
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new CsrfError());
  }
  next();
}
