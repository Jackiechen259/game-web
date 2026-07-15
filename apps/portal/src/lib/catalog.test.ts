import { describe, expect, it } from "vitest";
import {
  filterVisible,
  featuredGames,
  searchGames,
  paginate,
  gameEntryUrl,
  DEFAULT_SETTINGS,
} from "./catalog.ts";
import type { GameMetadata, SiteSettings } from "@game-platform/game-schema";

function game(id: string, overrides: Partial<GameMetadata> = {}): GameMetadata {
  return {
    id,
    title: id,
    description: "d",
    version: "1.0.0",
    entry: `games/${id}/index.html`,
    cover: `games/${id}/cover.png`,
    categories: [],
    tags: [],
    status: "published",
    featured: false,
    controls: [],
    createdAt: "2026-07-01",
    updatedAt: "2026-07-15",
    displayOrder: 0,
    ...overrides,
  };
}

const settings: SiteSettings = { ...DEFAULT_SETTINGS, featuredGameIds: ["snake"] };

describe("catalog helpers", () => {
  it("filterVisible shows published and beta (when enabled)", () => {
    const games = [game("a", { status: "published" }), game("b", { status: "beta" }), game("c", { status: "development" }), game("d", { status: "archived" })];
    const visible = filterVisible(games, settings);
    expect(visible.map((g) => g.id).sort()).toEqual(["a", "b"]);
  });

  it("filterVisible hides beta when showBetaGames is false", () => {
    const games = [game("a", { status: "published" }), game("b", { status: "beta" })];
    const visible = filterVisible(games, { ...settings, showBetaGames: false });
    expect(visible.map((g) => g.id)).toEqual(["a"]);
  });

  it("featuredGames uses featuredGameIds then featured flag", () => {
    const games = [game("snake", { featured: false }), game("tetris", { featured: true })];
    const f = featuredGames(games, settings);
    expect(f.map((g) => g.id)).toEqual(["snake"]);
    const f2 = featuredGames(games, { ...settings, featuredGameIds: [] });
    expect(f2.map((g) => g.id)).toEqual(["tetris"]);
  });

  it("searchGames matches title, id, tags", () => {
    const games = [game("snake", { title: "贪吃蛇", tags: ["键盘"] }), game("tetris")];
    expect(searchGames(games, "贪吃蛇").map((g) => g.id)).toEqual(["snake"]);
    expect(searchGames(games, "tetris").map((g) => g.id)).toEqual(["tetris"]);
    expect(searchGames(games, "键盘").map((g) => g.id)).toEqual(["snake"]);
  });

  it("paginate splits and clamps", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const p1 = paginate(items, 1, 10);
    expect(p1.items).toHaveLength(10);
    expect(p1.total).toBe(25);
    expect(p1.pages).toBe(3);
    const p3 = paginate(items, 3, 10);
    expect(p3.items).toHaveLength(5);
  });

  it("gameEntryUrl resolves and cleans paths", () => {
    expect(gameEntryUrl("games/snake/index.html")).toBe("/games/snake/index.html");
    expect(gameEntryUrl("//games//snake/index.html")).toBe("/games/snake/index.html");
  });
});
