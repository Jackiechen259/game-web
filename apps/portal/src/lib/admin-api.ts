import type {
  AdminUser,
  AuditLogListResponse,
  CoverUploadResponse,
  DashboardStats,
  DeploymentResponse,
  DeploymentsResponse,
  GameDetailResponse,
  GameListResponse,
  PrepareResponse,
  PreviewResponse,
  PublishingStatusResponse,
  PublishResponse,
  ReleasesResponse,
  RollbackResponse,
  ValidateResponse,
  CreateGameInput,
  UpdateGameInput,
  AuditLogQuery,
} from "@game-platform/admin-types";
import type { SiteSettings } from "@game-platform/game-schema";
import { apiFetch } from "./api.ts";

export interface SessionResponse {
  user: AdminUser | null;
  csrfToken: string | null;
}

export const adminApi = {
  getSession: () => apiFetch<SessionResponse>("/session"),
  login: (login: string, password: string) =>
    apiFetch<{ user: AdminUser; csrfToken: string }>("/login", { method: "POST", body: { login, password } }),
  logout: () => apiFetch<{ ok: boolean }>("/logout", { method: "POST" }),

  dashboard: () => apiFetch<DashboardStats>("/dashboard"),

  listGames: (query: { q?: string; status?: string; category?: string; sort?: string; page?: number; pageSize?: number }) =>
    apiFetch<GameListResponse>("/games", { query }),
  getGame: (id: string) => apiFetch<GameDetailResponse>(`/games/${encodeURIComponent(id)}`),
  createGame: (input: CreateGameInput) =>
    apiFetch<{ game: GameDetailResponse["game"]; sha: string; branch: string }>("/games", { method: "POST", body: input }),
  updateGame: (id: string, input: UpdateGameInput) =>
    apiFetch<{ game: GameDetailResponse["game"]; sha: string; branch: string }>(`/games/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  archiveGame: (id: string, expectedSha: string) =>
    apiFetch<{ game: GameDetailResponse["game"]; sha: string }>(`/games/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: { expectedSha },
    }),
  restoreGame: (id: string, expectedSha: string) =>
    apiFetch<{ game: GameDetailResponse["game"]; sha: string }>(`/games/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: { expectedSha },
    }),
  validateGame: (id: string) =>
    apiFetch<ValidateResponse>(`/games/${encodeURIComponent(id)}/validate`, { method: "POST" }),
  uploadCover: (id: string, base64: string, filename: string, contentType: string) =>
    apiFetch<CoverUploadResponse>(`/games/${encodeURIComponent(id)}/cover`, {
      method: "POST",
      body: { base64, filename, contentType },
    }),
  deleteCover: (id: string, cover: string, expectedSha: string) =>
    apiFetch<{ ok: boolean; sha: string }>(`/games/${encodeURIComponent(id)}/cover`, {
      method: "DELETE",
      body: { cover, expectedSha },
    }),
  createPreview: (id: string) =>
    apiFetch<PreviewResponse>(`/games/${encodeURIComponent(id)}/preview`, { method: "POST" }),
  getPreview: (token: string) => apiFetch<{ gameId: string; commitSha: string; expiresAt: string }>(`/previews/${encodeURIComponent(token)}`),

  validateCatalog: () => apiFetch<ValidateResponse>("/catalog/validate", { method: "POST" }),

  publishingStatus: () => apiFetch<PublishingStatusResponse>("/publishing/status"),
  preparePublish: () => apiFetch<PrepareResponse>("/publishing/prepare", { method: "POST" }),
  publish: () => apiFetch<PublishResponse>("/publishing/publish", { method: "POST" }),
  cancelPublish: () => apiFetch<{ cancelled: boolean }>("/publishing/cancel", { method: "POST" }),

  listDeployments: () => apiFetch<DeploymentsResponse>("/deployments"),
  getDeployment: (id: string) => apiFetch<DeploymentResponse>(`/deployments/${encodeURIComponent(id)}`),
  retryDeployment: () => apiFetch<DeploymentResponse>("/deployments/retry", { method: "POST" }),

  listReleases: () => apiFetch<ReleasesResponse>("/releases"),
  rollback: (id: string) => apiFetch<RollbackResponse>(`/releases/${encodeURIComponent(id)}/rollback`, { method: "POST" }),

  listAudit: (query: AuditLogQuery) =>
    apiFetch<AuditLogListResponse>("/audit", {
      query: {
        action: query.action,
        actorLogin: query.actorLogin,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        result: query.result,
        page: query.page,
        pageSize: query.pageSize,
      },
    }),

  getSettings: () => apiFetch<{ settings: SiteSettings; sha: string }>("/settings"),
  updateSettings: (settings: SiteSettings, expectedSha: string) =>
    apiFetch<{ ok: boolean; sha: string }>("/settings", { method: "PATCH", body: { expectedSha, settings } }),
};
