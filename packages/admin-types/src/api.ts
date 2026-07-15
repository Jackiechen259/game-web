import { z } from "zod";
import {
  ASPECT_RATIO_REGEX,
  GAME_STATUSES,
  SEMVER_REGEX,
  changelogEntrySchema,
  gameConfigSchema,
  iframeConfigSchema,
  seoConfigSchema,
  type GameConfig,
  type GameMetadata,
  type GameStatus,
  type ValidationResult,
} from "@game-platform/game-schema";
import type { Role } from "./roles.ts";
import type { DeploymentJob, PreviewTokenResponse, PublishJob, PublishJobStatus, DeploymentStatus } from "./jobs.ts";
import type { AuditLog, AuditLogListResponse, AuditLogQuery } from "./audit.ts";

// ── Session & users ─────────────────────────────────────────────

export interface AdminUser {
  id: string;
  provider: string;
  providerUserId: string;
  login: string;
  role: Role;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionResponse {
  user: AdminUser | null;
}

// ── Games list / detail ─────────────────────────────────────────

export type BuildStatus = "unknown" | "pending" | "success" | "failure" | "skipped";

export interface GameListItem {
  id: string;
  title: string;
  version: string;
  status: GameStatus;
  featured: boolean;
  categories: string[];
  cover: string;
  updatedAt: string;
  configStatus: "clean" | "draft" | "validating" | "ready" | "publishing" | "published" | "failed";
  buildStatus: BuildStatus;
  configSha?: string;
}

export interface GameListQuery {
  q?: string;
  status?: GameStatus;
  category?: string;
  sort?: "title" | "updatedAt" | "displayOrder";
  page?: number;
  pageSize?: number;
}

export interface GameListResponse {
  games: GameListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GameDetailResponse {
  game: GameConfig;
  sha: string;
  configStatus: GameListItem["configStatus"];
  buildStatus: BuildStatus;
  previewUrl?: string;
}

// ── Write inputs (single source of truth for client + server) ───

export const createGameInputSchema = gameConfigSchema.omit({
  schemaVersion: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateGameInput = z.infer<typeof createGameInputSchema>;

export const updateGameInputSchema = z.object({
  expectedSha: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  version: z.string().regex(SEMVER_REGEX).optional(),
  status: z.enum(GAME_STATUSES).optional(),
  featured: z.boolean().optional(),
  entry: z.string().min(1).optional(),
  cover: z.string().min(1).optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  controls: z.array(z.string()).optional(),
  aspectRatio: z.string().regex(ASPECT_RATIO_REGEX).optional(),
  displayOrder: z.number().int().optional(),
  minimumPortalSdkVersion: z.string().regex(SEMVER_REGEX).optional(),
  seo: seoConfigSchema.optional(),
  iframe: iframeConfigSchema.optional(),
  changelog: z.array(changelogEntrySchema).optional(),
});
export type UpdateGameInput = z.infer<typeof updateGameInputSchema>;

export interface CommitResult {
  sha: string;
  commitUrl?: string;
  branch: string;
}

export interface CreateGameResponse {
  game: GameConfig;
  sha: string;
  branch: string;
}

export interface ArchiveResponse {
  game: GameConfig;
  sha: string;
}

export interface CoverUploadResponse {
  cover: string;
  sha: string;
}

// ── Validation ──────────────────────────────────────────────────

export type ValidateResponse = ValidationResult;

// ── Preview ─────────────────────────────────────────────────────

export type PreviewResponse = PreviewTokenResponse;

// ── Publishing ──────────────────────────────────────────────────

export interface PublishingStatusResponse {
  status: PublishJobStatus | "idle";
  publishJob?: PublishJob;
  validation?: ValidationResult;
}

export interface PrepareResponse {
  prepared: boolean;
  validation: ValidationResult;
}

export interface PublishResponse {
  publishJob: PublishJob;
}

// ── Deployments ─────────────────────────────────────────────────

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentsResponse {
  deployments: DeploymentJob[];
}

export interface DeploymentResponse {
  deployment: DeploymentJob;
}

export type { DeploymentJob, DeploymentStatus, PublishJob, PublishJobStatus };

// ── Releases & rollback ──────────────────────────────────────────

export interface Release {
  id: string;
  publishedAt: string;
  sourceCommit?: string;
  distCommit?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  portalRunId?: number;
  status: PublishJobStatus;
  deployment?: DeploymentJob;
}

export interface ReleasesResponse {
  releases: Release[];
}

export interface RollbackResponse {
  release: Release;
  rollbackPrUrl?: string;
  commitSha: string;
}

// ── Dashboard ───────────────────────────────────────────────────

export interface DashboardStats {
  total: number;
  published: number;
  beta: number;
  development: number;
  archived: number;
  drafts: number;
  recentReleases: Release[];
  recentDeployments: DeploymentJob[];
  failedBuilds: number;
  recentlyModified: GameListItem[];
}

// ── Settings ────────────────────────────────────────────────────

export interface SettingsResponse {
  settings: unknown;
}

// ── Re-exports ──────────────────────────────────────────────────

export type {
  AuditLog,
  AuditLogListResponse,
  AuditLogQuery,
  GameConfig,
  GameMetadata,
  GameStatus,
};
