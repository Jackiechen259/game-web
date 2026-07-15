import { z } from "zod";

/**
 * Game configuration types and Zod schemas.
 *
 * A full `GameConfig` lives in the games library at
 * `catalog/games/<game-id>.json`. The games library CI aggregates a subset
 * (`GameMetadata`) into `dist/catalog.json`, which the public portal reads at
 * runtime.
 */

// ── Enums & whitelists ──────────────────────────────────────────

export const GAME_STATUSES = ["development", "beta", "published", "archived"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Public portal lists show only these statuses by default. */
export const PUBLIC_VISIBLE_STATUSES: ReadonlyArray<GameStatus> = ["published", "beta"];

/** Permission-policy tokens allowed in `iframe.allow` (joined with "; "). */
export const ALLOW_PERMISSIONS = ["fullscreen", "autoplay", "gamepad"] as const;
export type AllowPermission = (typeof ALLOW_PERMISSIONS)[number];

/** Sandbox tokens allowed in `iframe.sandbox` (joined with " "). */
export const SANDBOX_TOKENS = [
  "allow-scripts",
  "allow-same-origin",
  "allow-pointer-lock",
  "allow-popups",
  "allow-forms",
  "allow-downloads",
] as const;
export type SandboxToken = (typeof SANDBOX_TOKENS)[number];

/** Tokens that must always be present in a game's sandbox (never fully disabled). */
export const REQUIRED_SANDBOX_TOKENS: ReadonlyArray<SandboxToken> = ["allow-scripts", "allow-same-origin"];

/** A safe default iframe configuration used when a game does not specify one. */
export const DEFAULT_IFRAME_CONFIG: IframeConfig = {
  allow: ["fullscreen", "autoplay", "gamepad"],
  sandbox: ["allow-scripts", "allow-same-origin", "allow-pointer-lock"],
};

// ── Regexes ─────────────────────────────────────────────────────

export const GAME_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const ASPECT_RATIO_REGEX = /^\d+\/\d+$/;

// ── Sub-schemas ────────────────────────────────────────────────

export const iframeConfigSchema = z.object({
  allow: z.array(z.string()).default([]),
  sandbox: z.array(z.string()).default([]),
});

export const seoConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
});

export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  changes: z.array(z.string()).default([]),
});

// ── Game config (full, in catalog/games/<id>.json) ──────────────

export const gameConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string().regex(GAME_ID_REGEX, "id must match ^[a-z0-9][a-z0-9-]*$"),
  title: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, "version must be semver x.y.z"),
  status: z.enum(GAME_STATUSES),
  featured: z.boolean().default(false),
  entry: z.string().min(1),
  cover: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  controls: z.array(z.string()).default([]),
  aspectRatio: z.string().regex(ASPECT_RATIO_REGEX, "aspectRatio must be like 16/9").optional(),
  displayOrder: z.number().int().default(0),
  minimumPortalSdkVersion: z.string().regex(SEMVER_REGEX).optional(),
  seo: seoConfigSchema.optional(),
  iframe: iframeConfigSchema.optional(),
  createdAt: z.string().regex(DATE_REGEX, "createdAt must be YYYY-MM-DD"),
  updatedAt: z.string().regex(DATE_REGEX, "updatedAt must be YYYY-MM-DD"),
  changelog: z.array(changelogEntrySchema).default([]),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

// ── Game metadata (catalog entry, public subset) ───────────────

export const gameMetadataSchema = z.object({
  id: z.string().regex(GAME_ID_REGEX),
  title: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX),
  entry: z.string().min(1),
  cover: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  status: z.enum(GAME_STATUSES),
  featured: z.boolean().default(false),
  controls: z.array(z.string()).default([]),
  aspectRatio: z.string().optional(),
  displayOrder: z.number().int().default(0),
  createdAt: z.string().regex(DATE_REGEX),
  updatedAt: z.string().regex(DATE_REGEX),
  iframe: iframeConfigSchema.optional(),
  seo: seoConfigSchema.optional(),
});

export type GameMetadata = z.infer<typeof gameMetadataSchema>;

export interface IframeConfig {
  allow: string[];
  sandbox: string[];
}

export interface SeoConfig {
  title?: string;
  description?: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

/**
 * Derive a public catalog entry from a full game config.
 * Internal-only fields (minimumPortalSdkVersion, changelog, schemaVersion) are dropped.
 */
export function toCatalogEntry(config: GameConfig): GameMetadata {
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    version: config.version,
    entry: config.entry,
    cover: config.cover,
    categories: config.categories,
    tags: config.tags,
    status: config.status,
    featured: config.featured,
    controls: config.controls,
    aspectRatio: config.aspectRatio,
    displayOrder: config.displayOrder,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    iframe: config.iframe,
    seo: config.seo,
  };
}
