import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CatalogProvider } from "../catalog-context.tsx";
import { Home } from "./Home.tsx";

const CATALOG = {
  schemaVersion: 1,
  generatedAt: "2026-07-15T00:00:00Z",
  games: [
    {
      id: "snake",
      title: "贪吃蛇",
      description: "classic snake",
      version: "1.0.0",
      entry: "games/snake/index.html",
      cover: "games/snake/cover.png",
      categories: ["休闲"],
      tags: ["键盘"],
      status: "published",
      featured: true,
      controls: [],
      createdAt: "2026-07-01",
      updatedAt: "2026-07-15",
    },
    {
      id: "tetris",
      title: "俄罗斯方块",
      description: "blocks",
      version: "1.2.0",
      entry: "games/tetris/index.html",
      cover: "games/tetris/cover.png",
      categories: ["益智"],
      tags: [],
      status: "beta",
      featured: false,
      controls: [],
      createdAt: "2026-07-02",
      updatedAt: "2026-07-14",
    },
  ],
};

const SETTINGS = {
  schemaVersion: 1,
  siteName: "Test Site",
  siteDescription: "desc",
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
  navigation: [{ label: "首页", path: "/" }],
};

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("game-catalog.json")) {
        return { ok: true, json: async () => CATALOG } as Response;
      }
      if (url.includes("site-settings.json")) {
        return { ok: true, json: async () => SETTINGS } as Response;
      }
      return { ok: false, status: 404, statusText: "not found" } as Response;
    }),
  );
}

describe("Home page", () => {
  beforeEach(() => mockFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("renders featured and recently updated games from the catalog", async () => {
    render(
      <MemoryRouter>
        <CatalogProvider>
          <Home />
        </CatalogProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("贪吃蛇").length).toBeGreaterThan(0);
    });

    // Featured section contains snake; recent section contains both.
    expect(screen.getAllByText("俄罗斯方块").length).toBeGreaterThan(0);
    expect(screen.getByText("推荐游戏")).toBeTruthy();
    expect(screen.getByText("最近更新")).toBeTruthy();
  });

  it("shows the maintenance banner when maintenance mode is on", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("game-catalog.json")) return { ok: true, json: async () => CATALOG } as Response;
        return { ok: true, json: async () => ({ ...SETTINGS, maintenanceMode: true }) } as Response;
      }),
    );

    render(
      <MemoryRouter>
        <CatalogProvider>
          <Home />
        </CatalogProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/站点维护中/)).toBeTruthy();
    });
  });
});
