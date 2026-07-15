import { randomUUID } from "node:crypto";
import type { Database } from "./db.ts";
import type {
  AdminUser,
  AuditLog,
  AuditLogQuery,
  DeploymentJob,
  DeploymentStatus,
  PreviewToken,
  PublishJob,
  PublishJobStatus,
  Role,
} from "@game-platform/admin-types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(): string {
  return randomUUID();
}

function toBool(n: number | undefined): boolean {
  return n === 1;
}

// ── AdminUser ────────────────────────────────────────────────────

interface UserRow {
  id: string;
  provider: string;
  provider_user_id: string;
  login: string;
  role: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function mapUser(r: UserRow): AdminUser {
  return {
    id: r.id,
    provider: r.provider,
    providerUserId: r.provider_user_id,
    login: r.login,
    role: r.role as Role,
    enabled: toBool(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── AuditLog ─────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_login: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before_json: string | null;
  after_json: string | null;
  result: string;
  error_code: string | null;
  commit_sha: string | null;
  pull_request_number: number | null;
  ip_hash: string | null;
  user_agent: string | null;
}

function mapAudit(r: AuditRow): AuditLog {
  return {
    id: r.id,
    timestamp: r.timestamp,
    actorId: r.actor_id,
    actorLogin: r.actor_login,
    actorRole: r.actor_role as "viewer" | "editor" | "admin",
    action: r.action,
    resourceType: r.resource_type as AuditLog["resourceType"],
    resourceId: r.resource_id,
    before: r.before_json ? JSON.parse(r.before_json) : undefined,
    after: r.after_json ? JSON.parse(r.after_json) : undefined,
    result: r.result as "success" | "failure",
    errorCode: r.error_code ?? undefined,
    commitSha: r.commit_sha ?? undefined,
    pullRequestNumber: r.pull_request_number ?? undefined,
    ipHash: r.ip_hash ?? undefined,
    userAgent: r.user_agent ?? undefined,
  };
}

// ── PublishJob / DeploymentJob ───────────────────────────────────

interface PublishRow {
  id: string;
  actor_id: string;
  actor_login: string;
  source_branch: string;
  source_commit: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  dist_commit: string | null;
  portal_run_id: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapPublish(r: PublishRow): PublishJob {
  return {
    id: r.id,
    actorId: r.actor_id,
    actorLogin: r.actor_login,
    sourceBranch: r.source_branch,
    sourceCommit: r.source_commit ?? undefined,
    pullRequestNumber: r.pull_request_number ?? undefined,
    pullRequestUrl: r.pull_request_url ?? undefined,
    distCommit: r.dist_commit ?? undefined,
    portalRunId: r.portal_run_id ?? undefined,
    status: r.status as PublishJobStatus,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface DeploymentRow {
  id: string;
  publish_job_id: string | null;
  repository: string;
  workflow_run_id: number | null;
  workflow_run_url: string | null;
  status: string;
  stage: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

function mapDeployment(r: DeploymentRow): DeploymentJob {
  return {
    id: r.id,
    publishJobId: r.publish_job_id ?? undefined,
    repository: r.repository,
    workflowRunId: r.workflow_run_id ?? undefined,
    workflowRunUrl: r.workflow_run_url ?? undefined,
    status: r.status as DeploymentStatus,
    stage: r.stage as DeploymentJob["stage"],
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    errorMessage: r.error_message ?? undefined,
  };
}

export class Store {
  database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  private get db() {
    return this.database.db;
  }

  // ── Users ──────────────────────────────────────────────────────

  getUserById(id: string): AdminUser | undefined {
    const row = this.db.prepare("SELECT * FROM admin_users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  getUserByProvider(provider: string, providerUserId: string): AdminUser | undefined {
    const row = this.db
      .prepare("SELECT * FROM admin_users WHERE provider = ? AND provider_user_id = ?")
      .get(provider, providerUserId) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  getUserByLogin(login: string): AdminUser | undefined {
    const row = this.db.prepare("SELECT * FROM admin_users WHERE login = ?").get(login) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  createUser(input: { provider: string; providerUserId: string; login: string; role: Role }): AdminUser {
    const id = randomId();
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO admin_users (id, provider, provider_user_id, login, role, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
      )
      .run(id, input.provider, input.providerUserId, input.login, input.role, now, now);
    return this.getUserById(id)!;
  }

  setUserEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE admin_users SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, nowIso(), id);
  }

  setUserRole(id: string, role: Role): void {
    this.db.prepare("UPDATE admin_users SET role = ?, updated_at = ? WHERE id = ?").run(role, nowIso(), id);
  }

  listUsers(): AdminUser[] {
    const rows = this.db.prepare("SELECT * FROM admin_users ORDER BY created_at ASC").all() as unknown as UserRow[];
    return rows.map(mapUser);
  }

  // ── Sessions ───────────────────────────────────────────────────

  createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    ipHash?: string;
    userAgent?: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(input.id, input.userId, input.tokenHash, nowIso(), input.expiresAt, input.ipHash ?? null, input.userAgent ?? null);
  }

  getSessionByToken(tokenHash: string): { id: string; userId: string; expiresAt: string; revokedAt: string | null } | undefined {
    const row = this.db
      .prepare("SELECT id, user_id, expires_at, revoked_at FROM admin_sessions WHERE token_hash = ?")
      .get(tokenHash) as
      | { id: string; user_id: string; expires_at: string; revoked_at: string | null }
      | undefined;
    if (!row) return undefined;
    return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, revokedAt: row.revoked_at };
  }

  revokeSession(id: string): void {
    this.db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), id);
  }

  revokeAllUserSessions(userId: string): void {
    this.db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(nowIso(), userId);
  }

  extendSession(id: string, expiresAt: string): void {
    this.db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE id = ?").run(expiresAt, id);
  }

  // ── Audit ──────────────────────────────────────────────────────

  insertAuditLog(log: Omit<AuditLog, "id" | "timestamp"> & { id?: string; timestamp?: string }): AuditLog {
    const id = log.id ?? randomId();
    const timestamp = log.timestamp ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO audit_logs
          (id, timestamp, actor_id, actor_login, actor_role, action, resource_type, resource_id, before_json, after_json, result, error_code, commit_sha, pull_request_number, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        timestamp,
        log.actorId,
        log.actorLogin,
        log.actorRole,
        log.action,
        log.resourceType,
        log.resourceId,
        log.before !== undefined ? JSON.stringify(log.before) : null,
        log.after !== undefined ? JSON.stringify(log.after) : null,
        log.result,
        log.errorCode ?? null,
        log.commitSha ?? null,
        log.pullRequestNumber ?? null,
        log.ipHash ?? null,
        log.userAgent ?? null,
      );
    return { ...log, id, timestamp } as AuditLog;
  }

  listAuditLogs(query: AuditLogQuery): { logs: AuditLog[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.action) {
      where.push("action = ?");
      params.push(query.action);
    }
    if (query.actorLogin) {
      where.push("actor_login = ?");
      params.push(query.actorLogin);
    }
    if (query.resourceType) {
      where.push("resource_type = ?");
      params.push(query.resourceType);
    }
    if (query.resourceId) {
      where.push("resource_id = ?");
      params.push(query.resourceId);
    }
    if (query.result) {
      where.push("result = ?");
      params.push(query.result);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...params) as { c: number }).c;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as unknown as AuditRow[];
    return { logs: rows.map(mapAudit), total };
  }

  // ── Publish jobs ───────────────────────────────────────────────

  createPublishJob(input: {
    actorId: string;
    actorLogin: string;
    sourceBranch: string;
    status: PublishJobStatus;
  }): PublishJob {
    const id = randomId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO publish_jobs (id, actor_id, actor_login, source_branch, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.actorId, input.actorLogin, input.sourceBranch, input.status, now, now);
    return this.getPublishJob(id)!;
  }

  getPublishJob(id: string): PublishJob | undefined {
    const row = this.db.prepare("SELECT * FROM publish_jobs WHERE id = ?").get(id) as PublishRow | undefined;
    return row ? mapPublish(row) : undefined;
  }

  updatePublishJob(id: string, fields: Partial<PublishJob>): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const map: Record<string, string> = {
      sourceCommit: "source_commit",
      pullRequestNumber: "pull_request_number",
      pullRequestUrl: "pull_request_url",
      distCommit: "dist_commit",
      portalRunId: "portal_run_id",
      status: "status",
      errorMessage: "error_message",
    };
    for (const key of Object.keys(map)) {
      const k = key as keyof PublishJob;
      if (fields[k] !== undefined) {
        sets.push(`${map[key]} = ?`);
        const value = fields[k];
        params.push(value === undefined ? null : (value as string | number | null));
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(nowIso());
    params.push(id);
    this.db.prepare(`UPDATE publish_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  listRecentPublishJobs(limit: number): PublishJob[] {
    const rows = this.db.prepare("SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as PublishRow[];
    return rows.map(mapPublish);
  }

  getActivePublishJob(): PublishJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM publish_jobs WHERE status IN ('preparing','validating','publishing') ORDER BY created_at DESC LIMIT 1")
      .get() as PublishRow | undefined;
    return row ? mapPublish(row) : undefined;
  }

  // ── Deployments ───────────────────────────────────────────────

  createDeployment(input: {
    publishJobId?: string;
    repository: string;
    status: DeploymentStatus;
    stage: DeploymentJob["stage"];
    startedAt?: string;
    completedAt?: string;
  }): DeploymentJob {
    const id = randomId();
    this.db
      .prepare(
        `INSERT INTO deployment_jobs (id, publish_job_id, repository, status, stage, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.publishJobId ?? null, input.repository, input.status, input.stage, input.startedAt ?? null, input.completedAt ?? null, nowIso());
    return this.getDeployment(id)!;
  }

  getDeployment(id: string): DeploymentJob | undefined {
    const row = this.db.prepare("SELECT * FROM deployment_jobs WHERE id = ?").get(id) as DeploymentRow | undefined;
    return row ? mapDeployment(row) : undefined;
  }

  updateDeployment(id: string, fields: Partial<DeploymentJob>): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const map: Record<string, string> = {
      workflowRunId: "workflow_run_id",
      workflowRunUrl: "workflow_run_url",
      status: "status",
      startedAt: "started_at",
      completedAt: "completed_at",
      errorMessage: "error_message",
    };
    for (const key of Object.keys(map)) {
      const k = key as keyof DeploymentJob;
      if (fields[k] !== undefined) {
        sets.push(`${map[key]} = ?`);
        const value = fields[k];
        params.push(value === undefined ? null : (value as string | number | null));
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE deployment_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  listDeployments(limit = 50): DeploymentJob[] {
    const rows = this.db.prepare("SELECT * FROM deployment_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as DeploymentRow[];
    return rows.map(mapDeployment);
  }

  listRecentDeployments(limit: number): DeploymentJob[] {
    return this.listDeployments(limit);
  }

  // ── Preview tokens ─────────────────────────────────────────────

  createPreviewToken(input: {
    tokenHash: string;
    gameId: string;
    commitSha: string;
    expiresAt: string;
  }): PreviewToken {
    const id = randomId();
    this.db
      .prepare(
        "INSERT INTO preview_tokens (id, token_hash, game_id, commit_sha, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.tokenHash, input.gameId, input.commitSha, input.expiresAt, nowIso());
    return this.getPreviewToken(id)!;
  }

  getPreviewToken(id: string): PreviewToken | undefined {
    const row = this.db.prepare("SELECT * FROM preview_tokens WHERE id = ?").get(id) as
      | {
          id: string;
          token_hash: string;
          game_id: string;
          commit_sha: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      tokenHash: row.token_hash,
      gameId: row.game_id,
      commitSha: row.commit_sha,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  getPreviewTokenByHash(tokenHash: string): PreviewToken | undefined {
    const row = this.db.prepare("SELECT * FROM preview_tokens WHERE token_hash = ?").get(tokenHash) as
      | {
          id: string;
          token_hash: string;
          game_id: string;
          commit_sha: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      tokenHash: row.token_hash,
      gameId: row.game_id,
      commitSha: row.commit_sha,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  revokePreviewToken(id: string): void {
    this.db.prepare("UPDATE preview_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), id);
  }
}
