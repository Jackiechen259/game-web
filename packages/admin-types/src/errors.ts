/** Stable API error codes and response shapes (sections 23, 32). */

export const ApiErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFIG_CONFLICT: "CONFIG_CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_REJECTED: "CSRF_REJECTED",
  BAD_ORIGIN: "BAD_ORIGIN",
  INTERNAL: "INTERNAL",
  GITHUB_UNAVAILABLE: "GITHUB_UNAVAILABLE",
  PUBLISH_IN_PROGRESS: "PUBLISH_IN_PROGRESS",
  BUILD_FAILED: "BUILD_FAILED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  DUPLICATE_ID: "DUPLICATE_ID",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
  PATH_TRAVERSAL: "PATH_TRAVERSAL",
  PREVIEW_EXPIRED: "PREVIEW_EXPIRED",
  MAINTENANCE: "MAINTENANCE",
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiError {
  code: string;
  message: string;
  /** Optional structured details. Never contains secrets. */
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiError;
}

/** Conflict response (section 23). Flat shape used by 409 responses. */
export interface ConfigConflictResponse {
  code: typeof ApiErrorCode.CONFIG_CONFLICT;
  message: string;
  currentSha: string;
  expectedSha: string;
}

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

export function apiErrorResponse(code: string, message: string, details?: unknown): ApiErrorResponse {
  return { error: apiError(code, message, details) };
}
