import { ApiErrorCode } from "@game-platform/admin-types";

/**
 * Internal application errors. The Express error handler converts these into
 * the versioned JSON error responses (section 32). Secrets are never included.
 */
export class AppError extends Error {
  statusCode: number;
  code: string;
  details: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super(401, ApiErrorCode.UNAUTHORIZED, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, ApiErrorCode.FORBIDDEN, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, ApiErrorCode.NOT_FOUND, `${resource} not found.`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, ApiErrorCode.VALIDATION_FAILED, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(currentSha: string, expectedSha: string, message = "This game was modified by another administrator.") {
    super(409, ApiErrorCode.CONFIG_CONFLICT, message, { currentSha, expectedSha });
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super(429, ApiErrorCode.RATE_LIMITED, "Too many requests. Please slow down.");
  }
}

export class CsrfError extends AppError {
  constructor() {
    super(403, ApiErrorCode.CSRF_REJECTED, "CSRF token validation failed.");
  }
}

export class BadOriginError extends AppError {
  constructor() {
    super(403, ApiErrorCode.BAD_ORIGIN, "Request origin is not allowed.");
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxMb: number) {
    super(413, ApiErrorCode.FILE_TOO_LARGE, `File exceeds the maximum allowed size of ${maxMb} MB.`);
  }
}

export class InvalidFileTypeError extends AppError {
  constructor(message = "File type is not allowed.") {
    super(415, ApiErrorCode.INVALID_FILE_TYPE, message);
  }
}

export class GitHubUnavailableError extends AppError {
  constructor(message = "GitHub is currently unavailable.") {
    super(502, ApiErrorCode.GITHUB_UNAVAILABLE, message);
  }
}
