import { describe, expect, it } from "vitest";
import {
  toCatalogEntry,
  validateCatalog,
  validateGameConfig,
  validateSettings,
  type GameConfig,
} from "./index.ts";

function baseConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    schemaVersion: 1,
    id: "snake",
    title: "贪吃蛇",
    description: "经典贪吃蛇小游戏",
    version: "1.0.0",
    status: "published",
    featured: true,
    entry: "games/snake/index.html",
    cover: "games/snake/cover.webp",
    categories: ["休闲"],
    tags: ["单人", "键盘"],
    controls: ["方向键控制移动"],
    aspectRatio: "16/9",
    displayOrder: 100,
    minimumPortalSdkVersion: "1.0.0",
    seo: { title: "在线贪吃蛇游戏", description: "在浏览器中游玩经典贪吃蛇。" },
    iframe: { allow: ["fullscreen", "autoplay", "gamepad"], sandbox: ["allow-scripts", "allow-same-origin", "allow-pointer-lock"] },
    createdAt: "2026-07-01",
    updatedAt: "2026-07-15",
    changelog: [{ version: "1.0.0", date: "2026-07-15", changes: ["首次发布"] }],
    ...overrides,
  };
}

function baseCatalog(games: GameConfig[]) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T00:00:00Z",
    games: games.map(toCatalogEntry),
  };
}

const fullFs = new Set([
  "games/snake/index.html",
  "games/snake/cover.webp",
  "games/tetris/index.html",
  "games/tetris/cover.webp",
]);

describe("validateGameConfig", () => {
  it("passes for a valid config", async () => {
    const result = await validateGameConfig(baseConfig(), { fileExists: (p) => fullFs.has(p) });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes without a file context (skips file existence)", async () => {
    const result = await validateGameConfig(baseConfig());
    expect(result.valid).toBe(true);
  });

  it("fails when entry file is missing", async () => {
    const result = await validateGameConfig(baseConfig(), { fileExists: () => false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ENTRY_NOT_FOUND")).toBe(true);
    expect(result.errors.some((e) => e.code === "COVER_NOT_FOUND")).toBe(true);
  });

  it("fails when entry contains traversal", async () => {
    const result = await validateGameConfig(baseConfig({ entry: "games/snake/../snake/index.html" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "PATH_TRAVERSAL")).toBe(true);
  });

  it("fails when entry is an absolute path", async () => {
    const result = await validateGameConfig(baseConfig({ entry: "/games/snake/index.html" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "PATH_NOT_RELATIVE")).toBe(true);
  });

  it("fails when entry is a URL", async () => {
    const result = await validateGameConfig(baseConfig({ entry: "https://evil.example/snake.html" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "PATH_NOT_RELATIVE")).toBe(true);
  });

  it("fails when entry does not end with .html", async () => {
    const result = await validateGameConfig(baseConfig({ entry: "games/snake/index.htm" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ENTRY_NOT_HTML")).toBe(true);
  });

  it("fails when entry is outside the game directory", async () => {
    const result = await validateGameConfig(baseConfig({ entry: "games/tetris/index.html" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "GAME_DIR_MISMATCH")).toBe(true);
  });

  it("fails when iframe allow token is not whitelisted", async () => {
    const result = await validateGameConfig(
      baseConfig({ iframe: { allow: ["camera"], sandbox: ["allow-scripts", "allow-same-origin"] } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "IFRAME_PERMISSION_NOT_ALLOWED")).toBe(true);
  });

  it("fails when sandbox is fully disabled (missing required tokens)", async () => {
    const result = await validateGameConfig(
      baseConfig({ iframe: { allow: ["fullscreen"], sandbox: ["allow-scripts"] } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SANDBOX_DISABLED")).toBe(true);
  });

  it("warns when cover is large", async () => {
    const result = await validateGameConfig(baseConfig(), { fileSize: () => 500 * 1024 });
    expect(result.warnings.some((w) => w.code === "LARGE_COVER")).toBe(true);
    expect(result.valid).toBe(true);
  });
});

describe("validateCatalog", () => {
  it("passes for a valid catalog", async () => {
    const result = await validateCatalog(baseCatalog([baseConfig()]), { fileExists: (p) => fullFs.has(p) });
    expect(result.valid).toBe(true);
  });

  it("fails on duplicate game ids", async () => {
    const snake = baseConfig();
    const snake2 = baseConfig({ title: "Snake 2" });
    const result = await validateCatalog(baseCatalog([snake, snake2]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_GAME_ID")).toBe(true);
  });

  it("fails when two games share the same directory", async () => {
    const a = baseConfig({ id: "snake", entry: "games/snake/index.html", cover: "games/snake/cover.webp" });
    const b = baseConfig({ id: "snake-clone", entry: "games/snake/index.html", cover: "games/snake/cover.webp" });
    // The clone references games/snake which does not match its own id dir.
    const result = await validateCatalog(baseCatalog([a, b]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SHARED_GAME_DIR")).toBe(true);
  });

  it("fails on unsupported schemaVersion", async () => {
    const result = await validateCatalog({ schemaVersion: 99, generatedAt: "2026-07-15T00:00:00Z", games: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("fails when games is not an array", async () => {
    const result = await validateCatalog({ schemaVersion: 1, generatedAt: "2026-07-15T00:00:00Z", games: "nope" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "GAMES_NOT_ARRAY" || e.code === "INVALID_SETTINGS")).toBe(true);
  });

  it("fails on invalid game id", async () => {
    const result = await validateCatalog(
      baseCatalog([baseConfig({ id: "Bad ID!" })]),
    );
    expect(result.valid).toBe(false);
  });

  it("fails on invalid status", async () => {
    const result = await validateCatalog(
      // Cast because TS protects the literal; the runtime validator must still reject.
      baseCatalog([{ ...baseConfig(), status: "live" as never }]),
    );
    expect(result.valid).toBe(false);
  });

  it("fails on invalid version", async () => {
    const result = await validateCatalog(baseCatalog([baseConfig({ version: "v1" })]));
    expect(result.valid).toBe(false);
  });

  it("fails on invalid date", async () => {
    const result = await validateCatalog(baseCatalog([baseConfig({ createdAt: "2026/07/01" })]));
    expect(result.valid).toBe(false);
  });

  it("fails on missing required field", async () => {
    const partial = { ...baseConfig() } as Record<string, unknown>;
    const { title: _title, ...noTitle } = partial;
    void _title;
    const result = await validateCatalog(baseCatalog([noTitle as GameConfig]));
    expect(result.valid).toBe(false);
  });

  it("warns (does not fail) on empty games list", async () => {
    const result = await validateCatalog({ schemaVersion: 1, generatedAt: "2026-07-15T00:00:00Z", games: [] });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("validateSettings", () => {
  function baseSettings() {
    return {
      schemaVersion: 1,
      siteName: "Bohan's Web Games",
      siteDescription: "Small browser games made by Bohan",
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
  }

  it("passes for valid settings with known ids", () => {
    const result = validateSettings(baseSettings(), ["snake"]);
    expect(result.valid).toBe(true);
  });

  it("fails when a featured game id does not exist", () => {
    const result = validateSettings(baseSettings(), ["snake"]);
    // Override to reference a missing game
    const resultMissing = validateSettings({ ...baseSettings(), featuredGameIds: ["ghost"] }, ["snake"]);
    expect(result.valid).toBe(true);
    expect(resultMissing.valid).toBe(false);
    expect(resultMissing.errors.some((e) => e.code === "FEATURED_GAME_NOT_FOUND")).toBe(true);
  });

  it("fails when a navigation path does not start with /", () => {
    const result = validateSettings({ ...baseSettings(), navigation: [{ label: "x", path: "games" }] }, ["snake"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_NAVIGATION")).toBe(true);
  });
});
