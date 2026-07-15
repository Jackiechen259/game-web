/** Audit log shapes (section 30). */

export const AuditAction = {
  LOGIN_SUCCESS: "login.success",
  LOGIN_FAILURE: "login.failure",
  LOGOUT: "logout",
  GAME_CREATE: "game.create",
  GAME_UPDATE: "game.update",
  GAME_ARCHIVE: "game.archive",
  GAME_RESTORE: "game.restore",
  COVER_UPLOAD: "cover.upload",
  COVER_DELETE: "cover.delete",
  SETTINGS_UPDATE: "settings.update",
  DRAFT_SAVE: "draft.save",
  PUBLISH_PREPARE: "publish.prepare",
  PUBLISH_CREATE: "publish.create",
  PUBLISH_MERGE: "publish.merge",
  PUBLISH_CANCEL: "publish.cancel",
  DEPLOY_TRIGGER: "deploy.trigger",
  DEPLOY_RETRY: "deploy.retry",
  ROLLBACK: "rollback",
  ROLE_CHANGE: "role.change",
  HIGH_RISK_FAILURE: "high_risk.failure",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export type AuditResourceType = "game" | "settings" | "release" | "deployment" | "session" | "preview";

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  actorLogin: string;
  actorRole: "viewer" | "editor" | "admin";
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  commitSha?: string;
  pullRequestNumber?: number;
  ipHash?: string;
  userAgent?: string;
  result: "success" | "failure";
  errorCode?: string;
}

export interface AuditLogQuery {
  action?: string;
  actorLogin?: string;
  resourceType?: AuditResourceType;
  resourceId?: string;
  result?: "success" | "failure";
  page?: number;
  pageSize?: number;
}

export interface AuditLogListResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}
