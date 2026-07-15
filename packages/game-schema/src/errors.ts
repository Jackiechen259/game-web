/**
 * Shared validation result shapes and error codes.
 *
 * These codes are the single source of truth used by:
 *  - the portal sync script (build-time)
 *  - the admin API validate endpoints (runtime)
 *  - the games library CI
 *
 * Do not maintain separate validation logic per consumer.
 */

export interface ValidationIssue {
  /** Dot/bracket path to the offending field, e.g. "games[0].entry" or "snake.entry". */
  path: string;
  /** Stable machine-readable error code. See the `ValidationErrorCode` constants. */
  code: string;
  /** Human-readable message safe to surface to administrators. */
  message: string;
}

export interface ValidationResult {
  /** True only when there are zero blocking errors (warnings do not block). */
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Stable error codes. Errors block publishing, warnings do not. */
export const ValidationErrorCode = {
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  GAMES_NOT_ARRAY: "GAMES_NOT_ARRAY",
  DUPLICATE_GAME_ID: "DUPLICATE_GAME_ID",
  INVALID_GAME_ID: "INVALID_GAME_ID",
  EMPTY_TITLE: "EMPTY_TITLE",
  EMPTY_DESCRIPTION: "EMPTY_DESCRIPTION",
  PATH_NOT_RELATIVE: "PATH_NOT_RELATIVE",
  PATH_TRAVERSAL: "PATH_TRAVERSAL",
  ABSOLUTE_PATH: "ABSOLUTE_PATH",
  ENTRY_NOT_HTML: "ENTRY_NOT_HTML",
  ENTRY_NOT_FOUND: "ENTRY_NOT_FOUND",
  COVER_NOT_FOUND: "COVER_NOT_FOUND",
  GAME_DIR_MISMATCH: "GAME_DIR_MISMATCH",
  SHARED_GAME_DIR: "SHARED_GAME_DIR",
  INVALID_DATE: "INVALID_DATE",
  INVALID_VERSION: "INVALID_VERSION",
  INVALID_ASPECT_RATIO: "INVALID_ASPECT_RATIO",
  INVALID_STATUS: "INVALID_STATUS",
  IFRAME_PERMISSION_NOT_ALLOWED: "IFRAME_PERMISSION_NOT_ALLOWED",
  SANDBOX_DISABLED: "SANDBOX_DISABLED",
  FEATURED_GAME_NOT_FOUND: "FEATURED_GAME_NOT_FOUND",
  INVALID_SETTINGS: "INVALID_SETTINGS",
  INVALID_NAVIGATION: "INVALID_NAVIGATION",
  EMPTY_GAME_LIST: "EMPTY_GAME_LIST",
  LARGE_COVER: "LARGE_COVER",
} as const;

export type ValidationErrorCode = (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode];

export function okResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export function error(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

export function warning(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

/** Merge multiple validation results into one. */
export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export function resultFromIssues(
  errors: ValidationIssue[] = [],
  warnings: ValidationIssue[] = [],
): ValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}
