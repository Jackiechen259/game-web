/**
 * Admin API client. Talks to /api/admin/v1/* (proxied to the admin-api in dev).
 * The CSRF token is obtained from /session (the cookie is non-HttpOnly and also
 * returned in the body) and sent back on mutating requests.
 */

export class ApiError extends Error {
  details: unknown;
  constructor(
    public status: number,
    public code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.details = details;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const isMutating = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (!headers["content-type"]) headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (isMutating && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const params = new URLSearchParams();
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined) continue;
      const sv = String(value);
      if (sv !== "") params.set(key, sv);
    }
  }
  const qs = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(`/api/admin/v1${path}${qs}`, {
    method,
    headers,
    body,
    credentials: "same-origin",
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const obj = parsed as {
      error?: { code?: string; message?: string };
      code?: string;
      message?: string;
    } | null;
    const err = obj?.error ?? obj;
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? res.statusText, err);
  }
  return parsed as T;
}
