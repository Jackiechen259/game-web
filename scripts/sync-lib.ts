/**
 * Portal game synchronisation logic (section 13).
 *
 * Build-time only. The browser never calls GitHub. All functions are exported so
 * they can be unit-tested directly. The entrypoints in sync-games.ts and
 * validate-game-catalog.ts wrap these.
 */
import { existsSync, promises as fs, statSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import * as path from "node:path";
import { validateCatalog, type ValidationResult } from "@game-platform/game-schema";
import { extractTar } from "./tar.ts";

export interface SyncConfig {
  enabled: boolean;
  repo: string;
  ref: string;
  catalogPath: string;
  localPath: string | null;
  maxArchiveBytes: number;
  allowStaleCache: boolean;
  githubToken: string | null;
  outputDir: string;
  cacheDir: string;
  fixturePath: string;
  downloadTimeoutMs: number;
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export const defaultLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export type SyncSource = "local" | "fixture" | "remote" | "cache";

export interface SyncResult {
  ok: boolean;
  gameCount: number;
  source: SyncSource;
  sha: string;
  usingStaleCache: boolean;
  catalogVersion: number;
  error?: string;
  validation?: ValidationResult;
}

export class SyncValidationError extends Error {
  result: ValidationResult;
  constructor(result: ValidationResult) {
    super("Catalog validation failed");
    this.name = "SyncValidationError";
    this.result = result;
  }
}

const PLACEHOLDER_REPO = "owner/web-games-library";

export function isPlaceholderRepo(repo: string): boolean {
  return repo === PLACEHOLDER_REPO || !repo.includes("/");
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === "" ? NaN : parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env, repoRoot?: string): SyncConfig {
  const root = repoRoot ?? path.resolve(import.meta.dirname, "..");
  const outputDir = path.resolve(root, env.PORTAL_PUBLIC_DIR ?? "apps/portal/public");
  const cacheDir = path.resolve(root, ".cache", "games-sync");
  const localPathRaw = env.GAMES_LOCAL_PATH ?? "";
  return {
    enabled: bool(env.GAMES_SYNC_ENABLED, true),
    repo: env.GAMES_REPO ?? PLACEHOLDER_REPO,
    ref: env.GAMES_REF ?? "dist",
    catalogPath: env.GAMES_CATALOG_PATH ?? "catalog.json",
    localPath: localPathRaw ? path.resolve(localPathRaw) : null,
    maxArchiveBytes: int(env.GAMES_MAX_ARCHIVE_SIZE_MB, 500) * 1024 * 1024,
    allowStaleCache: bool(env.GAMES_ALLOW_STALE_CACHE, false),
    githubToken: env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 0 ? env.GITHUB_TOKEN : null,
    outputDir,
    cacheDir,
    fixturePath: path.resolve(root, "tests", "fixtures", "games-library-dist"),
    downloadTimeoutMs: int(env.GAMES_DOWNLOAD_TIMEOUT_MS, 60_000),
  };
}

// ── filesystem helpers ──────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(src: string, dest: string): Promise<number> {
  await fs.mkdir(dest, { recursive: true });
  let count = 0;
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
      count++;
    }
    // symlinks skipped intentionally
  }
  return count;
}

export async function findArchiveRoot(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(dir, entries[0].name);
  }
  return dir;
}

function buildFileExistsFn(root: string) {
  return (relPath: string): boolean => existsSync(path.join(root, relPath));
}

function buildFileSizeFn(root: string) {
  return (relPath: string): number | undefined => {
    try {
      return statSync(path.join(root, relPath)).size;
    } catch {
      return undefined;
    }
  };
}

export async function atomicWriteFile(srcFile: string, destFile: string): Promise<void> {
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  const tmp = `${destFile}.tmp-${randomBytes(4).toString("hex")}`;
  await fs.copyFile(srcFile, tmp);
  await fs.rename(tmp, destFile);
}

export async function atomicReplaceDir(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  const backup = `${destDir}.bak-${randomBytes(4).toString("hex")}`;
  let movedExisting = false;
  if (await pathExists(destDir)) {
    await fs.rename(destDir, backup);
    movedExisting = true;
  }
  try {
    await fs.rename(srcDir, destDir);
  } catch (err) {
    if (movedExisting) await fs.rename(backup, destDir);
    throw err;
  }
  if (movedExisting) await fs.rm(backup, { recursive: true, force: true });
}

// ── remote download ─────────────────────────────────────────────

const GH_HEADERS = {
  "User-Agent": "game-portal-sync",
  Accept: "application/vnd.github+json",
};

export async function downloadToBuffer(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if (!res.body) throw new Error("No response body");
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          throw new Error(`Downloaded archive exceeds maximum size of ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCommitSha(repo: string, ref: string, token: string | null): Promise<string> {
  const headers = { ...GH_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Failed to resolve ref ${ref}: HTTP ${res.status}`);
    const data = (await res.json()) as { sha?: string };
    if (!data.sha) throw new Error("Commit response missing sha");
    return data.sha;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadArchive(
  repo: string,
  ref: string,
  token: string | null,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const headers = { ...GH_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const url = `https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref)}`;
  return downloadToBuffer(url, headers, maxBytes, timeoutMs);
}

export async function gunzipBuffer(input: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    const gunzip = createGunzip();
    const stream = Readable.from([input]).pipe(gunzip);
    stream.on("data", (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > maxBytes) {
        aborted = true;
        stream.destroy(new Error(`Decompressed archive exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    stream.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err: Error) => reject(err));
  });
}

// ── sync orchestration ───────────────────────────────────────────

interface PreparedSource {
  root: string;
  sha: string;
  source: SyncSource;
  usingStaleCache: boolean;
  /** For remote: the temp dir to clean up; for cache write-back. */
  tempDir?: string;
  writeToCache?: string;
}

async function mostRecentCache(cacheDir: string): Promise<string | null> {
  if (!(await pathExists(cacheDir))) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const name of await fs.readdir(cacheDir)) {
    const p = path.join(cacheDir, name);
    try {
      const st = await fs.stat(p);
      if (st.isDirectory() && (!best || st.mtimeMs > best.mtime)) {
        best = { path: p, mtime: st.mtimeMs };
      }
    } catch {
      // ignore
    }
  }
  return best?.path ?? null;
}

async function prepareSource(config: SyncConfig, logger: Logger): Promise<PreparedSource> {
  // Local path takes precedence.
  if (config.localPath) {
    if (!(await pathExists(config.localPath))) {
      throw new Error(`GAMES_LOCAL_PATH does not exist: ${config.localPath}`);
    }
    logger.info(`Synchronising games from local path ${config.localPath}`);
    return { root: config.localPath, sha: "local", source: "local", usingStaleCache: false };
  }

  // Dev fixture fallback when the repo is still the placeholder.
  if (isPlaceholderRepo(config.repo)) {
    if (await pathExists(config.fixturePath)) {
      logger.info(`Synchronising games from dev fixture ${config.fixturePath}`);
      logger.warn("GAMES_REPO is the placeholder (owner/web-games-library); using the bundled dev fixture.");
      return { root: config.fixturePath, sha: "dev-fixture", source: "fixture", usingStaleCache: false };
    }
    throw new Error(
      "GAMES_REPO is the placeholder and no GAMES_LOCAL_PATH is set. Set GAMES_REPO to your games library or GAMES_LOCAL_PATH to a local dist directory.",
    );
  }

  // Remote mode.
  const sha = await fetchCommitSha(config.repo, config.ref, config.githubToken);
  const cachePath = path.join(config.cacheDir, sha);
  if (await pathExists(cachePath)) {
    logger.info(`Synchronising games from ${config.repo}@${config.ref} (commit ${sha.slice(0, 7)})`);
    logger.info("Using cached archive (commit unchanged)");
    return { root: cachePath, sha, source: "cache", usingStaleCache: false };
  }

  logger.info(`Synchronising games from ${config.repo}@${config.ref} (commit ${sha.slice(0, 7)})`);
  const tempDir = await fs.mkdtemp(path.join(path.dirname(config.cacheDir), "staging-"));
  try {
    logger.info("Downloading repository archive");
    const archive = await downloadArchive(config.repo, config.ref, config.githubToken, config.maxArchiveBytes, config.downloadTimeoutMs);
    logger.info("Decompressing archive");
    const tar = await gunzipBuffer(archive, config.maxArchiveBytes * 4);
    await extractTar(tar, tempDir);
    const root = await findArchiveRoot(tempDir);
    return {
      root,
      sha,
      source: "remote",
      usingStaleCache: false,
      tempDir,
      writeToCache: cachePath,
    };
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true });
    if (config.allowStaleCache) {
      const stale = await mostRecentCache(config.cacheDir);
      if (stale) {
        logger.warn(`Remote download failed; using stale cache because GAMES_ALLOW_STALE_CACHE=true`);
        return { root: stale, sha: `${sha} (stale)`, source: "cache", usingStaleCache: true };
      }
    }
    throw err;
  }
}

export interface SyncOptions {
  logger?: Logger;
  now?: () => Date;
}

export async function syncGames(config: SyncConfig, opts: SyncOptions = {}): Promise<SyncResult> {
  const logger = opts.logger ?? defaultLogger;
  const now = opts.now ?? (() => new Date());

  if (!config.enabled) {
    logger.info("Game synchronisation is disabled (GAMES_SYNC_ENABLED=false)");
    return { ok: true, gameCount: 0, source: "local", sha: "disabled", usingStaleCache: false, catalogVersion: 1 };
  }

  // Ensure the cache/staging base exists so mkdtemp can create temp dirs.
  await fs.mkdir(path.dirname(config.cacheDir), { recursive: true });

  let prepared: PreparedSource;
  try {
    prepared = await prepareSource(config, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Game synchronisation failed: ${message}`);
    return {
      ok: false,
      gameCount: 0,
      source: "remote",
      sha: "",
      usingStaleCache: false,
      catalogVersion: 1,
      error: message,
    };
  }

  try {
    // Validate the catalog against the prepared source root.
    const catalogFile = path.join(prepared.root, config.catalogPath);
    if (!(await pathExists(catalogFile))) {
      throw new Error(`Catalog file not found: ${config.catalogPath}`);
    }
    const raw = await fs.readFile(catalogFile, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Catalog file is not valid JSON: ${config.catalogPath}`);
    }
    const validation = await validateCatalog(parsed, {
      fileExists: buildFileExistsFn(prepared.root),
      fileSize: buildFileSizeFn(prepared.root),
      requireNonEmpty: false,
    });
    if (!validation.valid) {
      logger.error("Catalog validation failed:");
      for (const e of validation.errors) {
        logger.error(`  [${e.code}] ${e.path}: ${e.message}`);
      }
      throw new SyncValidationError(validation);
    }
    for (const w of validation.warnings) {
      logger.warn(`  [${w.code}] ${w.path}: ${w.message}`);
    }

    const catalog = parsed as { schemaVersion: number; games: unknown[] };
    const gameCount = Array.isArray(catalog.games) ? catalog.games.length : 0;
    logger.info(`Validated ${gameCount} game${gameCount === 1 ? "" : "s"}`);

    // Build output in a temp dir on the same filesystem as the destination.
    const outDir = await fs.mkdtemp(path.join(path.dirname(config.cacheDir), "sync-out-"));
    const gamesSrc = path.join(prepared.root, "games");
    if (await pathExists(gamesSrc)) {
      await copyDir(gamesSrc, path.join(outDir, "games"));
    } else {
      await fs.mkdir(path.join(outDir, "games"), { recursive: true });
    }
    await fs.copyFile(catalogFile, path.join(outDir, "game-catalog.json"));

    // Optional site settings (games library dist may include settings.json).
    const settingsFile = path.join(prepared.root, "settings.json");
    if (await pathExists(settingsFile)) {
      await fs.copyFile(settingsFile, path.join(outDir, "site-settings.json"));
    }

    const syncInfo = {
      repository: config.repo,
      ref: config.ref,
      commit: prepared.sha,
      catalogVersion: catalog.schemaVersion,
      gameCount,
      syncedAt: now().toISOString(),
      source: prepared.source,
      usingStaleCache: prepared.usingStaleCache,
    };
    await fs.writeFile(path.join(outDir, "games-sync-info.json"), `${JSON.stringify(syncInfo, null, 2)}\n`);

    // Atomically publish to the destination. Failures here do not corrupt the
    // previous successful result.
    await atomicReplaceDir(path.join(outDir, "games"), path.join(config.outputDir, "games"));
    await atomicWriteFile(path.join(outDir, "game-catalog.json"), path.join(config.outputDir, "game-catalog.json"));
    await atomicWriteFile(path.join(outDir, "games-sync-info.json"), path.join(config.outputDir, "games-sync-info.json"));
    if (await pathExists(path.join(outDir, "site-settings.json"))) {
      await atomicWriteFile(path.join(outDir, "site-settings.json"), path.join(config.outputDir, "site-settings.json"));
    }

    logger.info(`Copied ${gameCount} game${gameCount === 1 ? "" : "s"} to ${config.outputDir}/games`);
    logger.info("Game synchronisation completed");

    // Write back to cache for remote sources.
    if (prepared.writeToCache) {
      try {
        await fs.mkdir(config.cacheDir, { recursive: true });
        await copyDir(prepared.root, prepared.writeToCache);
      } catch {
        logger.warn("Failed to write sync cache (non-fatal)");
      }
    }

    return {
      ok: true,
      gameCount,
      source: prepared.source,
      sha: prepared.sha,
      usingStaleCache: prepared.usingStaleCache,
      catalogVersion: catalog.schemaVersion,
      validation,
    };
  } catch (err) {
    if (err instanceof SyncValidationError) {
      return {
        ok: false,
        gameCount: 0,
        source: prepared.source,
        sha: prepared.sha,
        usingStaleCache: prepared.usingStaleCache,
        catalogVersion: 1,
        error: "Catalog validation failed",
        validation: err.result,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Game synchronisation failed: ${message}`);
    return {
      ok: false,
      gameCount: 0,
      source: prepared.source,
      sha: prepared.sha,
      usingStaleCache: prepared.usingStaleCache,
      catalogVersion: 1,
      error: message,
    };
  } finally {
    if (prepared.tempDir) {
      await fs.rm(prepared.tempDir, { recursive: true, force: true });
    }
  }
}
