/** Job, publish and preview domain types (sections 22, 25, 29). */

/** Per-game configuration publish state (section 22). */
export const CONFIG_PUBLISH_STATUSES = [
  "clean",
  "draft",
  "validating",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;
export type ConfigPublishStatus = (typeof CONFIG_PUBLISH_STATUSES)[number];

/** Publish job lifecycle (drafts -> validate -> publish PR -> dist -> portal deploy). */
export const PUBLISH_JOB_STATUSES = [
  "preparing",
  "validating",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
export type PublishJobStatus = (typeof PUBLISH_JOB_STATUSES)[number];

export interface PublishJob {
  id: string;
  actorId: string;
  actorLogin: string;
  sourceBranch: string;
  sourceCommit?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  distCommit?: string;
  portalRunId?: number;
  status: PublishJobStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEPLOYMENT_STATUSES = [
  "queued",
  "in_progress",
  "success",
  "failure",
  "cancelled",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export interface DeploymentJob {
  id: string;
  publishJobId?: string;
  repository: string;
  workflowRunId?: number;
  workflowRunUrl?: string;
  status: DeploymentStatus;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  /** Which stage this deployment represents. */
  stage: "games-library-build" | "portal-build" | "portal-deploy";
}

export interface PreviewToken {
  id: string;
  tokenHash: string;
  gameId: string;
  commitSha: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

export interface PreviewTokenResponse {
  previewId: string;
  url: string;
  commitSha: string;
  expiresAt: string;
}
