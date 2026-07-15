import type { Request } from "express";
import type { AppContext } from "./context.ts";
import type { AuditResourceType } from "@game-platform/admin-types";
import { sha256hex } from "./auth/crypto.ts";

export interface AuditInput {
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  result?: "success" | "failure";
  errorCode?: string;
  commitSha?: string;
  pullRequestNumber?: number;
}

/** Record an audit log entry derived from the authenticated request. */
export function audit(ctx: AppContext, req: Request, input: AuditInput): void {
  const user = req.adminUser;
  const ip = req.ip || req.socket?.remoteAddress || "";
  ctx.store.insertAuditLog({
    actorId: user?.id ?? "anonymous",
    actorLogin: user?.login ?? "anonymous",
    actorRole: user?.role ?? "viewer",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before,
    after: input.after,
    result: input.result ?? "success",
    errorCode: input.errorCode,
    commitSha: input.commitSha,
    pullRequestNumber: input.pullRequestNumber,
    ipHash: ip ? sha256hex(ip) : undefined,
    userAgent: req.headers["user-agent"],
  });
}
