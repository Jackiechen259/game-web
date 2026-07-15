import type { GameCatalog, SiteSettings } from "@game-platform/game-schema";
import { PUBLIC_VISIBLE_STATUSES, resolveEntryUrl } from "@game-platform/game-schema";

/** Runtime catalog fetch (build-time synced static file). Browser never calls GitHub. */
export async function loadGameCatalog(): Promise<GameCatalog> {
  const response = await fetch("/game-catalog.json", {
    cache: import.meta.env.DEV ? "no-store" : "default",
  });
  if (!response.ok) {
    throw new Error(`Unable to load game catalog: ${response.status}`);
  }
  return (await response.json()) as GameCatalog;
}

export async function loadSiteSettings(): Promise<SiteSettings | null> {
  try {
    const response = await fetch("/site-settings.json", {
      cache: import.meta.env.DEV ? "no-store" : "default",
    });
    if (!response.ok) return null;
    return (await response.json()) as SiteSettings;
  } catch {
    return null;
  }
}

export const DEFAULT_SETTINGS: SiteSettings = {
  schemaVersion: 1,
  siteName: "Web Games",
  siteDescription: "Browser games",
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
  featuredGameIds: [],
  navigation: [
    { label: "首页", path: "/" },
    { label: "全部游戏", path: "/games" },
  ],
};

/** Only published and (when enabled) beta games are shown publicly. */
export function filterVisible(games: GameCatalog["games"], settings: SiteSettings): GameCatalog["games"] {
  return games.filter((g) => {
    if (g.status === "published") return true;
    if (g.status === "beta" && settings.showBetaGames) return true;
    return false;
  });
}

export function featuredGames(games: GameCatalog["games"], settings: SiteSettings): GameCatalog["games"] {
  const ids = new Set(settings.featuredGameIds);
  return games
    .filter((g) => (ids.size > 0 ? ids.has(g.id) : g.featured))
    .sort((a, b) => (b.displayOrder ?? 0) - (a.displayOrder ?? 0));
}

export function searchGames(games: GameCatalog["games"], q: string): GameCatalog["games"] {
  const needle = q.trim().toLowerCase();
  if (!needle) return games;
  return games.filter(
    (g) =>
      g.title.toLowerCase().includes(needle) ||
      g.id.toLowerCase().includes(needle) ||
      g.description.toLowerCase().includes(needle) ||
      g.tags.some((t) => t.toLowerCase().includes(needle)),
  );
}

export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; total: number; pages: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, pages };
}

export { PUBLIC_VISIBLE_STATUSES, resolveEntryUrl };

/** Build a safe game URL from a catalog entry. */
export function gameEntryUrl(entry: string): string {
  return resolveEntryUrl(entry);
}
