import type { CreateGameInput, UpdateGameInput } from "@game-platform/admin-types";
import type { GameConfig, SiteSettings } from "@game-platform/game-schema";

export interface GameFile {
  config: GameConfig;
  /** Current blob SHA of the config file (used for optimistic concurrency). */
  sha: string;
  path: string;
}

export interface CommitResult {
  sha: string;
  commitUrl?: string;
  branch: string;
  message: string;
}

export interface PullRequestResult {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
}

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

export interface CoverUploadResult {
  cover: string;
  sha: string;
}

/**
 * Game repository service (section 21.3). All GitHub access is centralised here.
 * Two implementations: `LocalRepositoryService` (dev) and `GitHubRepositoryService`
 * (production via GitHub App). Routes never call the GitHub API directly.
 */
export interface GameRepositoryService {
  readonly defaultRef: string;
  listGameConfigs(ref?: string): Promise<GameFile[]>;
  getGame(id: string, ref?: string): Promise<GameFile | undefined>;
  createGame(input: CreateGameInput, actor: string, ref?: string): Promise<CommitResult>;
  updateGame(id: string, input: UpdateGameInput, expectedSha: string, actor: string, ref?: string): Promise<CommitResult>;
  archiveGame(id: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult>;
  restoreGame(id: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult>;
  uploadCover(id: string, data: Buffer, filename: string, contentType: string, actor: string, ref?: string): Promise<CoverUploadResult>;
  deleteCover(id: string, coverPath: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult>;
  getSettings(ref?: string): Promise<{ settings: SiteSettings; sha: string } | undefined>;
  updateSettings(settings: SiteSettings, expectedSha: string, actor: string, ref?: string): Promise<CommitResult>;
  fileExists(relPath: string, ref?: string): Promise<boolean>;
  listFiles(ref?: string): Promise<string[]>;
  createPublishPullRequest(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    actor: string,
  ): Promise<PullRequestResult>;
  getWorkflowRuns(repo: string, limit?: number): Promise<WorkflowRun[]>;
  triggerPortalDeployment(payload: Record<string, unknown>): Promise<void>;
  rollback(targetCommitSha: string, baseBranch: string, actor: string): Promise<CommitResult>;
}
