import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import * as path from "node:path";
import type { CreateGameInput, UpdateGameInput } from "@game-platform/admin-types";
import {
  GAME_ID_REGEX,
  gameConfigSchema,
  parseGameConfig,
  parseSettings,
  settingsSchema,
  toCatalogEntry,
  type GameConfig,
  type GameMetadata,
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
import { AppError, ConflictError, InvalidFileTypeError, NotFoundError, ValidationError } from "./app-error.ts";

/** Compute a git-compatible blob SHA-1 for content. */
export function blobSha(content: Buffer | string): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`blob ${buf.length}\0`);
  return createHash("sha1").update(Buffer.concat([header, buf])).digest("hex");
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function configPath(repo: string, id: string): string {
  return path.join(repo, "catalog", "games", `${id}.json`);
}

function settingsPath(repo: string): string {
  return path.join(repo, "catalog", "settings.json");
}

function readJsonFile<T>(file: string): { data: T; sha: string } {
  const content = readFileSync(file, "utf8");
  return { data: JSON.parse(content) as T, sha: blobSha(content) };
}

function writeJson(file: string, value: unknown): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(file, content);
  return blobSha(content);
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

// ── Seed data ───────────────────────────────────────────────────

const SNAKE_CONFIG: GameConfig = {
  schemaVersion: 1,
  id: "snake",
  title: "贪吃蛇",
  description: "经典贪吃蛇小游戏，方向键控制移动。",
  version: "1.0.0",
  status: "published",
  featured: true,
  entry: "games/snake/index.html",
  cover: "games/snake/cover.png",
  categories: ["休闲"],
  tags: ["单人", "键盘"],
  controls: ["使用方向键控制移动", "按 P 暂停游戏"],
  aspectRatio: "16/9",
  displayOrder: 100,
  minimumPortalSdkVersion: "1.0.0",
  seo: { title: "在线贪吃蛇游戏", description: "在浏览器中游玩经典贪吃蛇。" },
  iframe: { allow: ["fullscreen", "autoplay", "gamepad"], sandbox: ["allow-scripts", "allow-same-origin", "allow-pointer-lock"] },
  createdAt: "2026-07-01",
  updatedAt: "2026-07-15",
  changelog: [{ version: "1.0.0", date: "2026-07-15", changes: ["首次发布"] }],
};

const TETRIS_CONFIG: GameConfig = {
  schemaVersion: 1,
  id: "tetris",
  title: "俄罗斯方块",
  description: "经典方块消除游戏。",
  version: "1.2.0",
  status: "beta",
  featured: false,
  entry: "games/tetris/index.html",
  cover: "games/tetris/cover.png",
  categories: ["益智"],
  tags: ["单人", "键盘"],
  controls: ["方向键移动", "上键旋转", "空格硬降"],
  aspectRatio: "10/16",
  displayOrder: 90,
  minimumPortalSdkVersion: "1.0.0",
  seo: { title: "在线俄罗斯方块", description: "在浏览器中游玩经典方块游戏。" },
  createdAt: "2026-07-02",
  updatedAt: "2026-07-14",
  changelog: [{ version: "1.2.0", date: "2026-07-14", changes: ["新增硬降功能"] }],
};

const SEED_SETTINGS: SiteSettings = {
  schemaVersion: 1,
  siteName: "Bohan's Web Games",
  siteDescription: "Small browser games made by Bohan",
  defaultLanguage: "zh-CN",
  gamesPerPage: 24,
  showBetaGames: true,
  showArchivedGamePages: true,
  enableSearch: true,
  enableCategories: true,
  enableRecentlyPlayed: true,
  enableFullscreen: true,
  enableGamepad: true,
  maintenanceMode: false,
  featuredGameIds: ["snake"],
  navigation: [
    { label: "首页", path: "/" },
    { label: "全部游戏", path: "/games" },
  ],
};

function seedRepo(repo: string, seedFrom: string): void {
  mkdirSync(path.join(repo, "catalog", "games"), { recursive: true });
  writeJson(configPath(repo, "snake"), SNAKE_CONFIG);
  writeJson(configPath(repo, "tetris"), TETRIS_CONFIG);
  writeJson(settingsPath(repo), SEED_SETTINGS);
  // Copy game assets from the dist fixture (already built games).
  const srcGames = path.join(seedFrom, "games");
  if (existsSync(srcGames)) {
    copyDirRecursive(srcGames, path.join(repo, "games"));
  } else {
    // Create minimal game directories so entry/cover resolve.
    for (const id of ["snake", "tetris"]) {
      mkdirSync(path.join(repo, "games", id), { recursive: true });
    }
  }
}

// ── Service ─────────────────────────────────────────────────────

export class LocalRepositoryService implements GameRepositoryService {
  readonly defaultRef: string;
  private readonly repo: string;

  constructor(repoPath: string, defaultRef: string, seedFrom: string) {
    this.repo = repoPath;
    this.defaultRef = defaultRef;
    if (!existsSync(path.join(repoPath, "catalog", "games"))) {
      seedRepo(repoPath, seedFrom);
    }
  }

  async listGameConfigs(_ref?: string): Promise<GameFile[]> {
    const dir = path.join(this.repo, "catalog", "games");
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const result: GameFile[] = [];
    for (const file of files) {
      const id = file.replace(/\.json$/, "");
      const game = await this.getGame(id);
      if (game) result.push(game);
    }
    return result;
  }

  async getGame(id: string, _ref?: string): Promise<GameFile | undefined> {
    const file = configPath(this.repo, id);
    if (!existsSync(file)) return undefined;
    const { data, sha } = readJsonFile<unknown>(file);
    const parsed = parseGameConfig(data);
    if (!parsed.success || !parsed.data) {
      throw new ValidationError(`Game config for "${id}" is invalid.`, parsed.errors);
    }
    return { config: parsed.data, sha, path: `catalog/games/${id}.json` };
  }

  async createGame(input: CreateGameInput, _actor: string, _ref?: string): Promise<CommitResult> {
    if (!GAME_ID_REGEX.test(input.id)) {
      throw new ValidationError("Game id must match ^[a-z0-9][a-z0-9-]*$.");
    }
    if (existsSync(configPath(this.repo, input.id))) {
      throw new AppError(409, ApiErrorCode.DUPLICATE_ID, `A game with id "${input.id}" already exists.`);
    }
    const today = todayDate();
    const config = { ...input, schemaVersion: 1, createdAt: today, updatedAt: today } as GameConfig;
    const parsed = gameConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ValidationError("Game config failed schema validation.", parsed.error.issues);
    }
    const sha = writeJson(configPath(this.repo, parsed.data.id), parsed.data);
    return { sha, branch: this.defaultRef, message: `Create game ${parsed.data.id}`, commitUrl: `local://${parsed.data.id}` };
  }

  async updateGame(id: string, input: UpdateGameInput, expectedSha: string, _actor: string, _ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    if (existing.sha !== expectedSha) {
      throw new ConflictError(existing.sha, expectedSha);
    }
    const merged: GameConfig = { ...existing.config };
    for (const [key, value] of Object.entries(input)) {
      if (key === "expectedSha") continue;
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
    merged.updatedAt = todayDate();
    const parsed = gameConfigSchema.safeParse(merged);
    if (!parsed.success) {
      throw new ValidationError("Updated game config failed schema validation.", parsed.error.issues);
    }
    const sha = writeJson(configPath(this.repo, id), parsed.data);
    return { sha, branch: this.defaultRef, message: `Update game ${id}`, commitUrl: `local://${id}` };
  }

  async archiveGame(id: string, expectedSha: string, actor: string, ref?: string): Promise<CommitResult> {
    return this.setStatus(id, expectedSha, "archived", actor, ref);
  }

  async restoreGame(id: string, expectedSha: string, _actor: string, ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    if (existing.sha !== expectedSha) throw new ConflictError(existing.sha, expectedSha);
    // Restore to a safe previous state (development) when archived.
    const status: GameConfig["status"] = existing.config.status === "archived" ? "development" : existing.config.status;
    return this.setStatus(id, expectedSha, status, _actor, ref);
  }

  private async setStatus(id: string, expectedSha: string, status: GameConfig["status"], _actor: string, _ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    if (existing.sha !== expectedSha) throw new ConflictError(existing.sha, expectedSha);
    const merged: GameConfig = { ...existing.config, status, updatedAt: todayDate() };
    const sha = writeJson(configPath(this.repo, id), merged);
    return { sha, branch: this.defaultRef, message: `Set game ${id} status to ${status}`, commitUrl: `local://${id}` };
  }

  async uploadCover(id: string, data: Buffer, _filename: string, _contentType: string, _actor: string, _ref?: string): Promise<CoverUploadResult> {
    const existing = await this.getGame(id);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    const ext = detectImageExtension(data);
    const coverRel = `games/${id}/cover.${ext}`;
    const coverFile = path.join(this.repo, coverRel);
    mkdirSync(path.dirname(coverFile), { recursive: true });
    writeFileSync(coverFile, data);
    // Update the game config's cover reference.
    const merged: GameConfig = { ...existing.config, cover: coverRel, updatedAt: todayDate() };
    const sha = writeJson(configPath(this.repo, id), merged);
    return { cover: coverRel, sha };
  }

  async deleteCover(id: string, coverPath: string, _expectedSha: string, _actor: string, _ref?: string): Promise<CommitResult> {
    const existing = await this.getGame(id);
    if (!existing) throw new NotFoundError(`Game ${id}`);
    const safeName = path.basename(coverPath);
    const file = path.join(this.repo, "games", id, safeName);
    if (existsSync(file)) rmSync(file, { force: true });
    return { sha: existing.sha, branch: this.defaultRef, message: `Delete cover for ${id}`, commitUrl: `local://${id}` };
  }

  async getSettings(_ref?: string): Promise<{ settings: SiteSettings; sha: string } | undefined> {
    const file = settingsPath(this.repo);
    if (!existsSync(file)) return undefined;
    const { data, sha } = readJsonFile<unknown>(file);
    const parsed = parseSettings(data);
    if (!parsed.success || !parsed.data) {
      throw new ValidationError("Settings file is invalid.", parsed.errors);
    }
    return { settings: parsed.data, sha };
  }

  async updateSettings(settings: SiteSettings, expectedSha: string, _actor: string, _ref?: string): Promise<CommitResult> {
    const existing = await this.getSettings();
    if (!existing) throw new NotFoundError("Settings");
    if (existing.sha !== expectedSha) throw new ConflictError(existing.sha, expectedSha);
    const parsed = settingsSchema.safeParse({ ...settings, schemaVersion: 1 });
    if (!parsed.success) throw new ValidationError("Settings failed schema validation.", parsed.error.issues);
    const sha = writeJson(settingsPath(this.repo), parsed.data);
    return { sha, branch: this.defaultRef, message: "Update settings", commitUrl: "local://settings" };
  }

  async fileExists(relPath: string, _ref?: string): Promise<boolean> {
    return existsSync(path.join(this.repo, relPath));
  }

  async listFiles(_ref?: string): Promise<string[]> {
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
        else if (entry.isFile()) files.push(rel);
      }
    };
    walk(this.repo, "");
    return files;
  }

  async createPublishPullRequest(headBranch: string, baseBranch: string, _title: string, _body: string, _actor: string): Promise<PullRequestResult> {
    // Local mode cannot create a real GitHub PR; return a deterministic stub.
    const number = Math.floor(Math.random() * 100000) + 1;
    return {
      number,
      url: `local://pull-requests/${number}`,
      headBranch,
      baseBranch,
    };
  }

  async getWorkflowRuns(_repo: string, _limit = 20): Promise<WorkflowRun[]> {
    return [];
  }

  async triggerPortalDeployment(_payload: Record<string, unknown>): Promise<void> {
    // No-op in local mode. The portal is rebuilt manually with `pnpm sync:games`.
  }

  async rollback(_targetCommitSha: string, _baseBranch: string, _actor: string): Promise<CommitResult> {
    const sha = randomBytes(20).toString("hex");
    return {
      sha,
      branch: this.defaultRef,
      message: "Rollback (local stub)",
      commitUrl: `local://rollback/${sha.slice(0, 7)}`,
    };
  }
}

/** Detect a real image format from magic bytes and return its extension. */
export function detectImageExtension(data: Buffer): "png" | "jpeg" | "webp" {
  if (data.length >= 12 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "jpeg";
  }
  if (
    data.length >= 12 &&
    data.slice(0, 4).toString("ascii") === "RIFF" &&
    data.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  throw new InvalidFileTypeError("Cover must be a real PNG, JPEG, or WebP image.");
}

export function listGamesAsMetadata(configs: GameFile[]): GameMetadata[] {
  return configs.map((f) => toCatalogEntry(f.config));
}
