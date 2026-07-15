import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

/**
 * SQLite database connection (built-in `node:sqlite`).
 *
 * The database only holds operational state (sections 2.4, 29): admin users,
 * sessions, publish/deployment jobs, audit logs and preview tokens. Game config
 * and published files live in the games library repository, never here.
 */
export class Database {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        login TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider, provider_user_id)
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        ip_hash TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_login TEXT NOT NULL,
        source_branch TEXT NOT NULL,
        source_commit TEXT,
        pull_request_number INTEGER,
        pull_request_url TEXT,
        dist_commit TEXT,
        portal_run_id INTEGER,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deployment_jobs (
        id TEXT PRIMARY KEY,
        publish_job_id TEXT,
        repository TEXT NOT NULL,
        workflow_run_id INTEGER,
        workflow_run_url TEXT,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (publish_job_id) REFERENCES publish_jobs(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_login TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        result TEXT NOT NULL,
        error_code TEXT,
        commit_sha TEXT,
        pull_request_number INTEGER,
        ip_hash TEXT,
        user_agent TEXT
      );

      CREATE TABLE IF NOT EXISTS preview_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        game_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_publish_created ON publish_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deployment_created ON deployment_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON admin_sessions(token_hash);
    `);
  }

  close(): void {
    this.db.close();
  }
}
