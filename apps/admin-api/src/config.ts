import { readFileSync } from "node:fs";
import * as path from "node:path";

export type AuthProvider = "github" | "dev";
export type RepositoryBackend = "local" | "github";
export type PublishMode = "pull-request" | "direct";

export interface ApiConfig {
  port: number;
  nodeEnv: string;
  authProvider: AuthProvider;
  githubOAuthClientId: string | null;
  githubOAuthClientSecret: string | null;
  sessionSecret: string;
  adminGithubUsers: string[];
  sessionMaxAgeSeconds: number;
  devAdminLogin: string | null;
  devAdminPassword: string | null;
  repositoryBackend: RepositoryBackend;
  githubAppId: string | null;
  githubAppInstallationId: string | null;
  githubAppPrivateKey: string | null;
  githubToken: string | null;
  gameLibraryRepo: string;
  portalRepo: string;
  sourceBranch: string;
  draftBranch: string;
  distBranch: string;
  publishBranchPrefix: string;
  publishMode: PublishMode;
  portalDispatchEvent: string;
  databasePath: string;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  maxUploadBytes: number;
  previewTokenTtlSeconds: number;
  localRepoPath: string;
  publicSiteUrl: string | null;
  publicAdminUrl: string | null;
  repoRoot: string;
}

export function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  const n = v === undefined || v === "" ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function list(env: NodeJS.ProcessEnv, key: string): string[] {
  const v = env[key] ?? "";
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readPrivateKey(env: NodeJS.ProcessEnv): string | null {
  const file = env.GITHUB_APP_PRIVATE_KEY_FILE;
  if (file) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  const key = env.GITHUB_APP_PRIVATE_KEY;
  if (!key) return null;
  // Support newline-escaped PEMs in env files.
  return key.replace(/\\n/g, "\n");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const repoRoot = env.GAME_PLATFORM_REPO_ROOT ?? path.resolve(import.meta.dirname, "..", "..", "..");
  const databasePath = env.DATABASE_URL && env.DATABASE_URL.length > 0
    ? env.DATABASE_URL.replace(/^sqlite:\/\//, "")
    : path.join(repoRoot, "data", "admin.sqlite");
  return {
    port: int(env, "PORT", 4000),
    nodeEnv: env.NODE_ENV ?? "development",
    authProvider: (env.AUTH_PROVIDER === "dev" ? "dev" : "github") as AuthProvider,
    githubOAuthClientId: env.GITHUB_OAUTH_CLIENT_ID || null,
    githubOAuthClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET || null,
    sessionSecret: env.SESSION_SECRET ?? "",
    adminGithubUsers: list(env, "ADMIN_GITHUB_USERS"),
    sessionMaxAgeSeconds: int(env, "ADMIN_SESSION_MAX_AGE_SECONDS", 28800),
    devAdminLogin: env.DEV_ADMIN_LOGIN || null,
    devAdminPassword: env.DEV_ADMIN_PASSWORD || null,
    repositoryBackend: (env.REPOSITORY_BACKEND === "github" ? "github" : "local") as RepositoryBackend,
    githubAppId: env.GITHUB_APP_ID || null,
    githubAppInstallationId: env.GITHUB_APP_INSTALLATION_ID || null,
    githubAppPrivateKey: readPrivateKey(env),
    githubToken: env.GITHUB_TOKEN || null,
    gameLibraryRepo: env.GITHUB_GAME_LIBRARY_REPO || "owner/web-games-library",
    portalRepo: env.GITHUB_PORTAL_REPO || "owner/game-portal",
    sourceBranch: env.GITHUB_SOURCE_BRANCH || "main",
    draftBranch: env.GITHUB_DRAFT_BRANCH || "admin/drafts",
    distBranch: env.GITHUB_DIST_BRANCH || "dist",
    publishBranchPrefix: env.GITHUB_PUBLISH_BRANCH_PREFIX || "admin/publish-",
    publishMode: (env.ADMIN_PUBLISH_MODE === "direct" ? "direct" : "pull-request") as PublishMode,
    portalDispatchEvent: env.PORTAL_DISPATCH_EVENT || "games-library-updated",
    databasePath,
    allowedOrigins: list(env, "ADMIN_ALLOWED_ORIGINS"),
    rateLimitPerMinute: int(env, "ADMIN_RATE_LIMIT_PER_MINUTE", 60),
    maxUploadBytes: int(env, "ADMIN_MAX_UPLOAD_MB", 5) * 1024 * 1024,
    previewTokenTtlSeconds: int(env, "PREVIEW_TOKEN_TTL_SECONDS", 3600),
    localRepoPath: env.LOCAL_REPO_PATH || path.join(repoRoot, "data", "local-repo"),
    publicSiteUrl: env.PUBLIC_SITE_URL || null,
    publicAdminUrl: env.PUBLIC_ADMIN_URL || null,
    repoRoot,
  };
}
