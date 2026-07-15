import { z } from "zod";
import {
  ALLOW_PERMISSIONS,
  DEFAULT_IFRAME_CONFIG,
  REQUIRED_SANDBOX_TOKENS,
  SANDBOX_TOKENS,
  gameConfigSchema,
  type GameConfig,
  type GameMetadata,
} from "./game.ts";
import { gameCatalogSchema, SUPPORTED_CATALOG_SCHEMA_VERSION, type GameCatalog } from "./catalog.ts";
import { settingsSchema, SUPPORTED_SETTINGS_SCHEMA_VERSION, type SiteSettings } from "./settings.ts";
import {
  ValidationErrorCode as C,
  type ValidationIssue,
  type ValidationResult,
  okResult,
  resultFromIssues,
  warning,
  error as makeError,
} from "./errors.ts";

/**
 * Path & security helpers. Shared so the sync script, admin API and CI all
 * resolve entry/cover paths the same way.
 */

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isRelativePath(p: string): boolean {
  const n = normalizePath(p);
  if (n === "") return false;
  if (n.startsWith("/")) return false; // absolute unix
  if (/^[A-Za-z]:[\\/]/.test(p)) return false; // windows drive
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(n)) return false; // URL scheme (http://, git://, ...)
  return true;
}

export function containsTraversal(p: string): boolean {
  return normalizePath(p)
    .split("/")
    .some((segment) => segment === "..");
}

export function gameDirectory(id: string): string {
  return `games/${id}`;
}

export function isUnderDirectory(p: string, dir: string): boolean {
  const n = normalizePath(p);
  const d = normalizePath(dir).replace(/\/$/, "");
  return n === d || n.startsWith(`${d}/`);
}

/** Directory portion of a relative path, e.g. "games/snake/index.html" -> "games/snake". */
export function dirname(p: string): string {
  const n = normalizePath(p);
  const idx = n.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return n.slice(0, idx);
}

/** Resolve the portal-relative URL for a game entry, defending against bad paths. */
export function resolveEntryUrl(entry: string): string {
  const cleaned = normalizePath(entry).replace(/^\/+/, "");
  return `/${cleaned}`.replace(/\/{2,}/g, "/");
}

// ── Validation context ──────────────────────────────────────────

export interface ValidationContext {
  /** Return true if a file exists at the repo-relative path. If omitted, file-existence checks are skipped. */
  fileExists?: (relPath: string) => boolean | Promise<boolean>;
  /** Return byte size of a file, for the large-cover warning. Optional. */
  fileSize?: (relPath: string) => number | undefined;
}

const LARGE_COVER_BYTES = 300 * 1024; // 300 KiB soft warning threshold

// ── Zod error mapping ───────────────────────────────────────────

function joinPath(path: (string | number)[]): string {
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .reduce<string>((acc, segment, index) => {
      if (typeof segment === "number") return `${acc}${segment}`;
      return index === 0 ? String(segment) : `${acc}.${segment}`;
    }, "");
}

function codeForField(path: (string | number)[]): string {
  const last = path[path.length - 1];
  switch (last) {
    case "version":
    case "minimumPortalSdkVersion":
      return C.INVALID_VERSION;
    case "status":
      return C.INVALID_STATUS;
    case "aspectRatio":
      return C.INVALID_ASPECT_RATIO;
    case "createdAt":
    case "updatedAt":
    case "date":
    case "generatedAt":
      return C.INVALID_DATE;
    case "id":
      return C.INVALID_GAME_ID;
    case "schemaVersion":
      return C.UNSUPPORTED_SCHEMA_VERSION;
    default:
      return C.INVALID_SETTINGS;
  }
}

function zodIssuesToErrors(err: z.ZodError): ValidationIssue[] {
  return err.issues.map((issue) => ({
    path: joinPath(issue.path) || "(root)",
    code: codeForField(issue.path),
    message: issue.message,
  }));
}

// ── Parse helpers ───────────────────────────────────────────────

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors: ValidationIssue[];
}

export function parseGameConfig(input: unknown): ParseResult<GameConfig> {
  const result = gameConfigSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return { success: false, errors: zodIssuesToErrors(result.error) };
}

export function parseCatalog(input: unknown): ParseResult<GameCatalog> {
  const result = gameCatalogSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return { success: false, errors: zodIssuesToErrors(result.error) };
}

export function parseSettings(input: unknown): ParseResult<SiteSettings> {
  const result = settingsSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return { success: false, errors: zodIssuesToErrors(result.error) };
}

// ── Per-game cross-field validation ─────────────────────────────

/** Validate a parsed game config's cross-field + file rules. */
export async function validateGameConfig(config: GameConfig, ctx: ValidationContext = {}): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const dir = gameDirectory(config.id);

  for (const field of ["entry", "cover"] as const) {
    const value = config[field];
    const pathPrefix = `${config.id}.${field}`;
    if (!isRelativePath(value)) {
      errors.push(makeError(pathPrefix, C.PATH_NOT_RELATIVE, `${field} must be a relative path.`));
      continue;
    }
    if (containsTraversal(value)) {
      errors.push(makeError(pathPrefix, C.PATH_TRAVERSAL, `${field} must not contain "..".`));
      continue;
    }
    if (!isUnderDirectory(value, dir)) {
      errors.push(
        makeError(pathPrefix, C.GAME_DIR_MISMATCH, `${field} must be located under ${dir}/.`),
      );
    }
  }

  if (!/\.html$/i.test(config.entry)) {
    errors.push(makeError(`${config.id}.entry`, C.ENTRY_NOT_HTML, "entry must end with .html"));
  }

  // iframe permission whitelist
  const iframe = config.iframe ?? DEFAULT_IFRAME_CONFIG;
  for (const token of iframe.allow) {
    if (!(ALLOW_PERMISSIONS as readonly string[]).includes(token)) {
      errors.push(
        makeError(`${config.id}.iframe.allow`, C.IFRAME_PERMISSION_NOT_ALLOWED, `iframe permission "${token}" is not allowed.`),
      );
    }
  }
  for (const token of iframe.sandbox) {
    if (!(SANDBOX_TOKENS as readonly string[]).includes(token)) {
      errors.push(
        makeError(`${config.id}.iframe.sandbox`, C.IFRAME_PERMISSION_NOT_ALLOWED, `sandbox token "${token}" is not allowed.`),
      );
    }
  }
  for (const required of REQUIRED_SANDBOX_TOKENS) {
    if (!iframe.sandbox.includes(required)) {
      errors.push(
        makeError(
          `${config.id}.iframe.sandbox`,
          C.SANDBOX_DISABLED,
          `sandbox must include "${required}" and cannot be fully disabled.`,
        ),
      );
    }
  }

  // file existence
  if (ctx.fileExists) {
    if (!(await ctx.fileExists(config.entry))) {
      errors.push(makeError(`${config.id}.entry`, C.ENTRY_NOT_FOUND, "The configured entry file does not exist."));
    }
    if (!(await ctx.fileExists(config.cover))) {
      errors.push(makeError(`${config.id}.cover`, C.COVER_NOT_FOUND, "The configured cover file does not exist."));
    }
  }
  if (ctx.fileSize) {
    const size = ctx.fileSize(config.cover);
    if (typeof size === "number" && size > LARGE_COVER_BYTES) {
      warnings.push(
        warning(`${config.id}.cover`, C.LARGE_COVER, "The cover image is larger than recommended (300 KiB)."),
      );
    }
  }

  return resultFromIssues(errors, warnings);
}

/** Validate a parsed catalog entry (subset of full config rules that still apply). */
export async function validateCatalogEntry(entry: GameMetadata, ctx: ValidationContext = {}): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const dir = gameDirectory(entry.id);

  for (const field of ["entry", "cover"] as const) {
    const value = entry[field];
    const pathPrefix = `${entry.id}.${field}`;
    if (!isRelativePath(value)) {
      errors.push(makeError(pathPrefix, C.PATH_NOT_RELATIVE, `${field} must be a relative path.`));
      continue;
    }
    if (containsTraversal(value)) {
      errors.push(makeError(pathPrefix, C.PATH_TRAVERSAL, `${field} must not contain "..".`));
      continue;
    }
    if (!isUnderDirectory(value, dir)) {
      errors.push(makeError(pathPrefix, C.GAME_DIR_MISMATCH, `${field} must be located under ${dir}/.`));
    }
  }
  if (!/\.html$/i.test(entry.entry)) {
    errors.push(makeError(`${entry.id}.entry`, C.ENTRY_NOT_HTML, "entry must end with .html"));
  }
  if (ctx.fileExists) {
    if (!(await ctx.fileExists(entry.entry))) {
      errors.push(makeError(`${entry.id}.entry`, C.ENTRY_NOT_FOUND, "The configured entry file does not exist."));
    }
    if (!(await ctx.fileExists(entry.cover))) {
      errors.push(makeError(`${entry.id}.cover`, C.COVER_NOT_FOUND, "The configured cover file does not exist."));
    }
  }
  return resultFromIssues(errors);
}

// ── Catalog-level validation ────────────────────────────────────

export interface CatalogValidationContext extends ValidationContext {
  /** If true, an empty games list is an error (default: warn). */
  requireNonEmpty?: boolean;
}

/** Parse and fully validate a raw catalog document (shape + cross-game + files). */
export async function validateCatalog(input: unknown, ctx: CatalogValidationContext = {}): Promise<ValidationResult> {
  const parsed = parseCatalog(input);
  if (!parsed.success || !parsed.data) {
    return resultFromIssues(parsed.errors);
  }
  const catalog = parsed.data;

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (catalog.schemaVersion !== SUPPORTED_CATALOG_SCHEMA_VERSION) {
    errors.push(
      makeError("schemaVersion", C.UNSUPPORTED_SCHEMA_VERSION, `catalog schemaVersion ${catalog.schemaVersion} is not supported.`),
    );
  }

  if (!Array.isArray(catalog.games)) {
    errors.push(makeError("games", C.GAMES_NOT_ARRAY, "games must be an array."));
    return resultFromIssues(errors, warnings);
  }

  if (catalog.games.length === 0) {
    if (ctx.requireNonEmpty) {
      errors.push(makeError("games", C.EMPTY_GAME_LIST, "catalog contains no games."));
    } else {
      warnings.push(warning("games", C.EMPTY_GAME_LIST, "catalog contains no games."));
    }
  }

  // unique ids + shared referenced directories
  const seenIds = new Map<string, number>();
  const seenDirs = new Map<string, string>();
  catalog.games.forEach((game, index) => {
    const prevIndex = seenIds.get(game.id);
    if (prevIndex !== undefined) {
      errors.push(
        makeError(`games[${index}].id`, C.DUPLICATE_GAME_ID, `duplicate game id "${game.id}" (also at games[${prevIndex}]).`),
      );
    } else {
      seenIds.set(game.id, index);
    }
    // The directory the game actually references via its entry path.
    const referencedDir = dirname(game.entry);
    const owner = seenDirs.get(referencedDir);
    if (owner !== undefined && owner !== game.id) {
      errors.push(
        makeError(`games[${index}].entry`, C.SHARED_GAME_DIR, `game directory "${referencedDir}" is also used by "${owner}".`),
      );
    } else if (owner === undefined) {
      seenDirs.set(referencedDir, game.id);
    }
  });

  // per-game rules + file existence
  const perGameResults = await Promise.all(
    catalog.games.map((game) => validateCatalogEntry(game, ctx)),
  );
  for (const r of perGameResults) {
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  return resultFromIssues(errors, warnings);
}

// ── Settings validation ─────────────────────────────────────────

export function validateSettings(input: unknown, knownGameIds?: string[]): ValidationResult {
  const parsed = parseSettings(input);
  if (!parsed.success || !parsed.data) {
    return resultFromIssues(parsed.errors);
  }
  const settings = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (settings.schemaVersion !== SUPPORTED_SETTINGS_SCHEMA_VERSION) {
    errors.push(
      makeError("schemaVersion", C.UNSUPPORTED_SCHEMA_VERSION, `settings schemaVersion ${settings.schemaVersion} is not supported.`),
    );
  }

  if (knownGameIds) {
    const idSet = new Set(knownGameIds);
    for (const id of settings.featuredGameIds) {
      if (!idSet.has(id)) {
        errors.push(
          makeError("featuredGameIds", C.FEATURED_GAME_NOT_FOUND, `featured game id "${id}" does not exist in the catalog.`),
        );
      }
    }
  }

  for (const nav of settings.navigation) {
    if (!nav.path.startsWith("/")) {
      errors.push(makeError("navigation", C.INVALID_NAVIGATION, `navigation path "${nav.path}" must start with "/".`));
    }
  }

  if (errors.length === 0 && warnings.length === 0) return okResult();
  return resultFromIssues(errors, warnings);
}

// Re-export commonly used schema pieces
export { SUPPORTED_CATALOG_SCHEMA_VERSION, SUPPORTED_SETTINGS_SCHEMA_VERSION };
export { okResult };
