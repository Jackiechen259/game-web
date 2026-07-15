import { createSign } from "node:crypto";
import * as path from "node:path";
import type { CreateGameInput, UpdateGameInput } from "@game-platform/admin-types";
import {
  GAME_ID_REGEX,
  gameConfigSchema,
  parseGameConfig,
  parseSettings,
  settingsSchema,
  type GameConfig,
  type SiteSettings,
} from "@game-platform/game-schema";
import { ApiErrorCode } from "@game-platform/admin-types";
import type {
  CommitResult,
  CoverUploadResult,
  GameFile,
  GameRepositoryService,
  PullRequestResult,
  WorkflowRun,
} from "./repository.ts";
import type { ApiConfig } from "./config.ts";
import { AppError, ConflictError, GitHubUnavailableError, NotFoundError, ValidationError } from "./app-error.ts";

const API_BASE = "https://api.github.com";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64decodeStd(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf8");
}

/** Sign a GitHub App JWT (RS256) with the app private key. */
function signAppJwt(privateKeyPem: string, appId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: String(appId) };
  const header = { alg: "RS256", typ: "JWT" };
  const enc = (o: unknown) => base64url(Buffer.from(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const sig = sign.sign(privateKeyPem);
  return `${signingInput}.${base64url(sig)}`;
}

interface GhResponse {
  status: number;
  body: unknown;
}

async function ghRequest(
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<GhResponse> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "game-portal-admin-api",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

/**
 * GitHub App repository service (production). All access uses short-lived
 * installation tokens; the private key never leaves the server and is never
 * logged or returned to the browser.
 */
export class GitHubRepositoryService implements GameRepositoryService {
  readonly defaultRef: string;
  private readonly config: ApiConfig;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: ApiConfig) {
    this.config = config;
    this.defaultRef = config.draftBranch;
  }

  private repo(): string {
    return this.config.gameLibraryRepo;
  }

  private async installToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }
    if (!this.config.githubAppPrivateKey || !this.config.githubAppId || !this.config.githubAppInstallationId) {
      throw new GitHubUnavailableError("GitHub App credentials are not configured on the server.");
    }
    const jwt = signAppJwt(this.config.githubAppPrivateKey, this.config.githubAppId);
    const res = await ghRequest(jwt, "POST", `/app/installations/${this.config.githubAppInstallationId}/access_tokens`);
    if (res.status !== 201) {
      throw new GitHubUnavailableError(`Failed to obtain installation token (HTTP ${res.status}).`);
    }
    const body = res.body as { token: string; expires_at: string };
    this.cachedToken = { token: body.token, expiresAt: new Date(body.expires_at).getTime() };
    return body.token;
  }

  private async call(method: string, urlPath: string, body?: unknown): Promise<GhResponse> {
    const token = await this.installToken();
    return ghRequest(token, method, urlPath, body);
  }

  async listGameConfigs(ref?: string): Promise<GameFile[]> {
    const r = ref ?? this.defaultRef;
    const res = await this.call("GET", `/repos/${this.repo()}/contents/catalog/games?ref=${encodeURIComponent(r)}`);
    if (res.status === 404) return [];
    if (res.status !== 200) throw new GitHubUnavailableError(`listGameConfigs failed (HTTP ${res.status})`);
    const entries = res.body as Array<{ name: string; sha: string }>;
    const result: GameFile[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(/\.json$/, "");
      const game = await this.getGame(id, r);
      if (game) result.push(game);
    }
    return result;
  }

  async getGame(id: string, ref?: string): Promise<GameFile | undefined> {
    const r = ref ?? this.defaultRef;
    const res = await this.call("GET", `/repos/${this.repo()}/contents/catalog/games/${id}.json?ref=${encodeURIComponent(r)}`);
    if (res.status === 404) return undefined;
    if (res.status !== 200) throw new GitHubUnavailableError(`getGame failed (HTTP ${res.status})`);
    const body = res.body as { content: string; sha: string; path: string };
    const json = base64decodeStd(body.content.replace(/\n/g, ""));
    const parsed = parseGameConfig(JSON.parse(json));
    if (!parsed.success || !parsed.data) {
      throw new ValidationError(`Game config for "${id}" is invalid.`, parsed.errors);
    }
    return { config: parsed.data, sha: body.sha, path: body.path };
  }

  async createGame(input: CreateGameInput, actor: string, ref?: string): Promise<CommitResult> {
    if (!GAME_ID_REGEX.test(input.id)) {
      throw new ValidationError("Game id must match ^[a-z0-9][a-z0-9-]*$.");
    }
    const existing = await this.getGame(input.id, ref);
    if (existing) {
      throw new AppError(409, ApiErrorCode.DUPLICATE_ID, `A game with id "${input.id}" already exists.`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const config = { ...input, schemaVersion: 1, createdAt: today, updatedAt: today } as GameConfig;
    const parsed = gameConfigSchema.safeParse(config);
    if (!parsed.success) throw new ValidationError("Game config failed schema validation.", parsed.error.issues);
    const content = Buffer.from(JSON.stringify(parsed.data, null, 2) + "\n").toString("base64");
    const res = await this.call("PUT", `/repos/${this.repo()}/contents/catalog/games/${input.id}.json`, {
      message: `Create game ${input.id}`,
      content,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status === 201 || res.status === 200) {
      const body = res.body as { content: { sha: string; html_url: string } };
      return { sha: body.content.sha, commitUrl: body.content.html_url, branch: ref ?? this.defaultRef, message: `Create game ${input.id}` };
    }
    throw new GitHubUnavailableError(`createGame failed (HTTP ${res.status})`);
  }

  async updateGame(id: string, input: UpdateGameInput, expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id, ref);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    if (existing.sha !== expectedSha) throw new ConflictError(existing.sha, expectedSha);
    const merged: GameConfig = { ...existing.config };
    for (const [key, value] of Object.entries(input)) {
      if (key === "expectedSha") continue;
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
    merged.updatedAt = new Date().toISOString().slice(0, 10);
    const parsed = gameConfigSchema.safeParse(merged);
    if (!parsed.success) throw new ValidationError("Updated game config failed schema validation.", parsed.error.issues);
    const content = Buffer.from(JSON.stringify(parsed.data, null, 2) + "\n").toString("base64");
    const res = await this.call("PUT", `/repos/${this.repo()}/contents/catalog/games/${id}.json`, {
      message: `Update game ${id}`,
      content,
      sha: expectedSha,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status === 200) {
      const body = res.body as { content: { sha: string; html_url: string }; commit: { sha: string; html_url: string } };
      return { sha: body.content.sha, commitUrl: body.commit.html_url, branch: ref ?? this.defaultRef, message: `Update game ${id}` };
    }
    if (res.status === 409) {
      throw new ConflictError(existing.sha, expectedSha, "The file was modified concurrently on GitHub.");
    }
    throw new GitHubUnavailableError(`updateGame failed (HTTP ${res.status})`);
  }

  async setStatus(id: string, expectedSha: string, status: GameConfig["status"], actor: string, ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id, ref);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    if (existing.sha !== expectedSha) throw new ConflictError(existing.sha, expectedSha);
    const merged: GameConfig = { ...existing.config, status, updatedAt: new Date().toISOString().slice(0, 10) };
    const content = Buffer.from(JSON.stringify(merged, null, 2) + "\n").toString("base64");
    const res = await this.call("PUT", `/repos/${this.repo()}/contents/catalog/games/${id}.json`, {
      message: `Set game ${id} status to ${status}`,
      content,
      sha: expectedSha,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status === 200) {
      const body = res.body as { content: { sha: string }; commit: { html_url: string } };
      return { sha: body.content.sha, commitUrl: body.commit.html_url, branch: ref ?? this.defaultRef, message: `Set ${id} status ${status}` };
    }
    throw new GitHubUnavailableError(`setStatus failed (HTTP ${res.status})`);
  }

  async archiveGame(id: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    return this.setStatus(id, expectedSha, "archived", actor, ref);
  }

  async restoreGame(id: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id, ref);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    const status: GameConfig["status"] = existing.config.status === "archived" ? "development" : existing.config.status;
    return this.setStatus(id, expectedSha, status, actor, ref);
  }

  async uploadCover(id: string, data: Buffer, _filename: string, _contentType: string, actor: string, ref?: string): Promise<CoverUploadResult> {
    const ext = detectImageExtensionGitHub(data);
    const coverRel = `games/${id}/cover.${ext}`;
    const content = data.toString("base64");
    const res = await this.call("PUT", `/repos/${this.repo()}/contents/games/${id}/cover.${ext}`, {
      message: `Upload cover for ${id}`,
      content,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new GitHubUnavailableError(`uploadCover failed (HTTP ${res.status})`);
    }
    // Update the game config's cover reference.
    const existing = await this.getGame(id, ref);
    if (existing) {
      await this.updateGame(id, { expectedSha: existing.sha, cover: coverRel }, existing.sha, actor, ref);
    }
    return { cover: coverRel, sha: existing?.sha ?? "" };
  }

  async deleteCover(id: string, coverPath: string, _expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    const safeName = path.basename(coverPath);
    const res = await this.call("DELETE", `/repos/${this.repo()}/contents/games/${id}/${safeName}`, {
      message: `Delete cover for ${id}`,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status !== 200) throw new GitHubUnavailableError(`deleteCover failed (HTTP ${res.status})`);
    const body = res.body as { commit: { sha: string; html_url: string } };
    return { sha: body.commit.sha, commitUrl: body.commit.html_url, branch: ref ?? this.defaultRef, message: `Delete cover ${id}` };
  }

  async getSettings(ref?: string): Promise<{ settings: SiteSettings; sha: string } | undefined> {
    const r = ref ?? this.defaultRef;
    const res = await this.call("GET", `/repos/${this.repo()}/contents/catalog/settings.json?ref=${encodeURIComponent(r)}`);
    if (res.status === 404) return undefined;
    if (res.status !== 200) throw new GitHubUnavailableError(`getSettings failed (HTTP ${res.status})`);
    const body = res.body as { content: string; sha: string };
    const parsed = parseSettings(JSON.parse(base64decodeStd(body.content.replace(/\n/g, ""))));
    if (!parsed.success || !parsed.data) throw new ValidationError("Settings file is invalid.", parsed.errors);
    return { settings: parsed.data, sha: body.sha };
  }

  async updateSettings(settings: SiteSettings, expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    const parsed = settingsSchema.safeParse({ ...settings, schemaVersion: 1 });
    if (!parsed.success) throw new ValidationError("Settings failed schema validation.", parsed.error.issues);
    const content = Buffer.from(JSON.stringify(parsed.data, null, 2) + "\n").toString("base64");
    const res = await this.call("PUT", `/repos/${this.repo()}/contents/catalog/settings.json`, {
      message: "Update site settings",
      content,
      sha: expectedSha,
      branch: ref ?? this.defaultRef,
      committer: { name: actor, email: `${actor}@users.noreply.github.com` },
    });
    if (res.status === 200) {
      const body = res.body as { commit: { sha: string; html_url: string } };
      return { sha: body.commit.sha, commitUrl: body.commit.html_url, branch: ref ?? this.defaultRef, message: "Update settings" };
    }
    if (res.status === 409) throw new ConflictError("", expectedSha);
    throw new GitHubUnavailableError(`updateSettings failed (HTTP ${res.status})`);
  }

  async fileExists(relPath: string, ref?: string): Promise<boolean> {
    const r = ref ?? this.defaultRef;
    const res = await this.call("GET", `/repos/${this.repo()}/contents/${relPath}?ref=${encodeURIComponent(r)}`);
    return res.status === 200;
  }

  async listFiles(ref?: string): Promise<string[]> {
    const r = ref ?? this.defaultRef;
    const res = await this.call("GET", `/repos/${this.repo()}/git/trees/${encodeURIComponent(r)}?recursive=1`);
    if (res.status !== 200) return [];
    const body = res.body as { tree: Array<{ path: string; type: string }> };
    return body.tree.filter((t) => t.type === "blob").map((t) => t.path);
  }

  async createPublishPullRequest(headBranch: string, baseBranch: string, title: string, body: string, _actor: string): Promise<PullRequestResult> {
    const res = await this.call("POST", `/repos/${this.repo()}/pulls`, {
      title,
      head: headBranch,
      base: baseBranch,
      body,
    });
    if (res.status !== 201) {
      throw new GitHubUnavailableError(`createPullRequest failed (HTTP ${res.status})`);
    }
    const pr = res.body as { number: number; html_url: string };
    return { number: pr.number, url: pr.html_url, headBranch, baseBranch };
  }

  async getWorkflowRuns(repo: string, limit = 20): Promise<WorkflowRun[]> {
    const res = await this.call("GET", `/repos/${repo}/actions/runs?per_page=${limit}`);
    if (res.status !== 200) return [];
    const body = res.body as {
      workflow_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        head_sha: string;
        created_at: string;
        updated_at: string;
      }>;
    };
    return body.workflow_runs.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      htmlUrl: r.html_url,
      headSha: r.head_sha,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async triggerPortalDeployment(payload: Record<string, unknown>): Promise<void> {
    const res = await this.call("POST", `/repos/${this.config.portalRepo}/dispatches`, {
      event_type: this.config.portalDispatchEvent,
      client_payload: payload,
    });
    if (res.status !== 204) {
      throw new GitHubUnavailableError(`triggerPortalDeployment failed (HTTP ${res.status})`);
    }
  }

  async rollback(targetCommitSha: string, baseBranch: string, actor: string): Promise<CommitResult> {
    // Create a rollback PR (section 24.9): never delete Git history.
    const shortSha = targetCommitSha.slice(0, 7);
    const branch = `${this.config.publishBranchPrefix}rollback-${shortSha}`;
    // Create branch from base.
    await this.call("POST", `/repos/${this.repo()}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: baseBranch,
    }).catch(() => undefined);
    const pr = await this.createPublishPullRequest(
      branch,
      baseBranch,
      `Rollback to ${shortSha}`,
      `Reverts changes back to ${targetCommitSha}. Requested by ${actor}.`,
      actor,
    );
    return {
      sha: targetCommitSha,
      commitUrl: pr.url,
      branch,
      message: `Rollback to ${shortSha}`,
    };
  }
}

function detectImageExtensionGitHub(data: Buffer): "png" | "jpeg" | "webp" {
  if (data.length >= 12 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "jpeg";
  }
  if (data.length >= 12 && data.slice(0, 4).toString("ascii") === "RIFF" && data.slice(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  throw new ValidationError("Cover must be a real PNG, JPEG, or WebP image.");
}
