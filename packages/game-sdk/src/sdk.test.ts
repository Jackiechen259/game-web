import { describe, expect, it } from "vitest";
import {
  SDK_SOURCE,
  SDK_VERSION,
  createMessage,
  isAllowedOrigin,
  isGameMessage,
  validateIncoming,
  type IncomingMessageEvent,
} from "./index.ts";

function msg(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: SDK_SOURCE,
    version: SDK_VERSION,
    gameId: "snake",
    type: "GAME_READY",
    ...overrides,
  };
}

describe("isGameMessage", () => {
  it("accepts a valid game->portal message", () => {
    expect(isGameMessage(msg())).toBe(true);
  });
  it("accepts a valid portal->game message", () => {
    expect(isGameMessage(msg({ type: "PORTAL_MUTE" }))).toBe(true);
  });
  it("rejects wrong source", () => {
    expect(isGameMessage(msg({ source: "other" }))).toBe(false);
  });
  it("rejects wrong version", () => {
    expect(isGameMessage(msg({ version: 2 }))).toBe(false);
  });
  it("rejects missing gameId", () => {
    const { gameId: _gameId, ...rest } = msg() as Record<string, unknown>;
    void _gameId;
    expect(isGameMessage(rest)).toBe(false);
  });
  it("rejects unknown type", () => {
    expect(isGameMessage(msg({ type: "HACK" }))).toBe(false);
  });
  it("rejects non-object", () => {
    expect(isGameMessage(null)).toBe(false);
    expect(isGameMessage("hello")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("matches a single string", () => {
    expect(isAllowedOrigin("https://games.example", "https://games.example")).toBe(true);
    expect(isAllowedOrigin("https://evil", "https://games.example")).toBe(false);
  });
  it("matches an array", () => {
    expect(isAllowedOrigin("https://b", ["https://a", "https://b"])).toBe(true);
    expect(isAllowedOrigin("https://c", ["https://a", "https://b"])).toBe(false);
  });
  it("defaults to same-origin when undefined", () => {
    expect(isAllowedOrigin("https://games.example", undefined, "https://games.example")).toBe(true);
    expect(isAllowedOrigin("https://evil", undefined, "https://games.example")).toBe(false);
  });
});

describe("createMessage", () => {
  it("produces the correct envelope", () => {
    const m = createMessage("snake", "SCORE_UPDATED", 42);
    expect(m).toEqual({ source: SDK_SOURCE, version: SDK_VERSION, gameId: "snake", type: "SCORE_UPDATED", payload: 42 });
  });
});

describe("validateIncoming", () => {
  const opts = { gameId: "snake", allowedOrigin: "https://games.example" as const, selfOrigin: "https://games.example" };

  function evt(origin: string, data: unknown): IncomingMessageEvent {
    return { origin, data };
  }

  it("returns the message when everything matches", () => {
    const result = validateIncoming(evt("https://games.example", msg()), opts);
    expect(result).not.toBeNull();
    expect(result?.gameId).toBe("snake");
  });

  it("rejects disallowed origin", () => {
    expect(validateIncoming(evt("https://evil", msg()), opts)).toBeNull();
  });

  it("rejects mismatched gameId", () => {
    expect(validateIncoming(evt("https://games.example", msg({ gameId: "tetris" })), opts)).toBeNull();
  });

  it("rejects non-SDK data", () => {
    expect(validateIncoming(evt("https://games.example", { hello: 1 }), opts)).toBeNull();
  });

  it("rejects portal->game messages when direction is game-to-portal", () => {
    expect(
      validateIncoming(evt("https://games.example", msg({ type: "PORTAL_MUTE" })), { ...opts, direction: "game-to-portal" }),
    ).toBeNull();
  });

  it("rejects game->portal messages when direction is portal-to-game", () => {
    expect(
      validateIncoming(evt("https://games.example", msg({ type: "GAME_READY" })), { ...opts, direction: "portal-to-game" }),
    ).toBeNull();
  });
});
