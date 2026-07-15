/**
 * Game Portal communication SDK.
 *
 * Used by two sides:
 *  - Games (inside the iframe) send `GAME_*` messages and listen for `PORTAL_*`.
 *  - The portal (host) sends `PORTAL_*` messages and listens for `GAME_*`.
 *
 * Both sides validate inbound messages with `validateIncoming`, which enforces:
 *   1. event.origin is allowed
 *   2. data.source === SDK_SOURCE
 *   3. data.version === SDK_VERSION
 *   4. data.gameId matches the expected game
 *   5. data.type is a known message type
 * Unknown messages are ignored. Message payloads are never executed, and no URL
 * supplied in a payload is ever fetched.
 */

export const SDK_SOURCE = "game-portal-sdk";
export const SDK_VERSION = 1;

export const GAME_MESSAGE_TYPES = [
  "GAME_READY",
  "GAME_STARTED",
  "SCORE_UPDATED",
  "GAME_OVER",
  "REQUEST_FULLSCREEN",
  "SAVE_DATA",
  "ERROR",
] as const;
export type GameMessageType = (typeof GAME_MESSAGE_TYPES)[number];

export const PORTAL_MESSAGE_TYPES = [
  "PORTAL_PAUSE",
  "PORTAL_RESUME",
  "PORTAL_MUTE",
  "PORTAL_UNMUTE",
  "PORTAL_RESTART",
] as const;
export type PortalMessageType = (typeof PORTAL_MESSAGE_TYPES)[number];

export type MessageType = GameMessageType | PortalMessageType;

export interface GameMessage<T = unknown> {
  source: typeof SDK_SOURCE;
  version: typeof SDK_VERSION;
  gameId: string;
  type: MessageType;
  payload?: T;
}

export type MessageHandler<T = unknown> = (payload: T | undefined, message: GameMessage<T>) => void;

/** Minimal shape we need from a DOM MessageEvent (keeps the validator DOM-free). */
export interface IncomingMessageEvent {
  origin: string;
  data: unknown;
}

export type AllowedOrigin = string | string[] | undefined;

/** Returns true if `origin` is permitted by `allowed`. When `allowed` is undefined, only same-origin is allowed. */
export function isAllowedOrigin(origin: string, allowed: AllowedOrigin, sameOrigin?: string): boolean {
  if (allowed === undefined) {
    // Same-origin only (no explicit allowlist configured).
    return sameOrigin !== undefined && origin === sameOrigin;
  }
  if (Array.isArray(allowed)) return allowed.includes(origin);
  return allowed === origin;
}

export function isGameMessageType(type: unknown): type is GameMessageType {
  return typeof type === "string" && (GAME_MESSAGE_TYPES as readonly string[]).includes(type);
}

export function isPortalMessageType(type: unknown): type is PortalMessageType {
  return typeof type === "string" && (PORTAL_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** Type guard: is `data` a structurally-valid SDK message (source + version + gameId + type)? */
export function isGameMessage(data: unknown): data is GameMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    m.source === SDK_SOURCE &&
    m.version === SDK_VERSION &&
    typeof m.gameId === "string" &&
    typeof m.type === "string" &&
    (isGameMessageType(m.type) || isPortalMessageType(m.type))
  );
}

/** Construct an outbound message. */
export function createMessage<T>(gameId: string, type: MessageType, payload?: T): GameMessage<T> {
  return { source: SDK_SOURCE, version: SDK_VERSION, gameId, type, payload };
}

export interface ValidateIncomingOptions {
  gameId: string;
  /** Allowed origin(s) for the sender. Omit to restrict to same-origin. */
  allowedOrigin?: AllowedOrigin;
  /** The receiver's own origin, used when `allowedOrigin` is omitted. */
  selfOrigin?: string;
  /** Restrict to one direction of messages (game->portal or portal->game). */
  direction?: "game-to-portal" | "portal-to-game";
}

/**
 * Validate an incoming MessageEvent according to the receive rules.
 * Returns the parsed message when valid, otherwise `null` (caller must ignore).
 */
export function validateIncoming(event: IncomingMessageEvent, opts: ValidateIncomingOptions): GameMessage | null {
  // 1. origin
  if (!isAllowedOrigin(event.origin, opts.allowedOrigin, opts.selfOrigin)) return null;
  // 2+3. shape (source + version)
  if (!isGameMessage(event.data)) return null;
  const message = event.data;
  // 4. gameId
  if (message.gameId !== opts.gameId) return null;
  // 5. type + direction
  if (opts.direction === "game-to-portal" && !isGameMessageType(message.type)) return null;
  if (opts.direction === "portal-to-game" && !isPortalMessageType(message.type)) return null;
  return message;
}

// ── Portal (host) bridge ────────────────────────────────────────

export type PortalSendTarget = { contentWindow: Window | null } | Window | null;

export interface PortalBridgeOptions {
  gameId: string;
  target: PortalSendTarget;
  allowedOrigin?: AllowedOrigin;
  selfOrigin?: string;
}

function resolveWindow(target: PortalSendTarget): Window | null {
  if (target === null) return null;
  if ("contentWindow" in target) return target.contentWindow;
  return target;
}

export class PortalBridge {
  private readonly gameId: string;
  private readonly target: PortalSendTarget;
  private readonly allowedOrigin: AllowedOrigin;
  private readonly selfOrigin?: string;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly listener: (event: MessageEvent) => void;
  private destroyed = false;

  constructor(opts: PortalBridgeOptions) {
    this.gameId = opts.gameId;
    this.target = opts.target;
    this.allowedOrigin = opts.allowedOrigin;
    this.selfOrigin = opts.selfOrigin;
    this.listener = (event: MessageEvent) => {
      if (this.destroyed) return;
      const message = validateIncoming(event, {
        gameId: this.gameId,
        allowedOrigin: this.allowedOrigin,
        selfOrigin: this.selfOrigin,
        direction: "game-to-portal",
      });
      if (!message) return;
      const set = this.handlers.get(message.type);
      if (set) for (const handler of set) handler(message.payload, message);
    };
    if (typeof window !== "undefined") window.addEventListener("message", this.listener);
  }

  send(type: PortalMessageType, payload?: unknown): void {
    if (this.destroyed) return;
    const w = resolveWindow(this.target);
    if (!w) return;
    const message = createMessage(this.gameId, type, payload);
    const targetOrigin =
      this.allowedOrigin === undefined
        ? (this.selfOrigin ?? "*")
        : Array.isArray(this.allowedOrigin)
          ? (this.allowedOrigin[0] ?? "*")
          : this.allowedOrigin;
    w.postMessage(message, targetOrigin);
  }

  on(type: GameMessageType, handler: MessageHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  off(type: GameMessageType, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  pause(): void {
    this.send("PORTAL_PAUSE");
  }
  resume(): void {
    this.send("PORTAL_RESUME");
  }
  mute(): void {
    this.send("PORTAL_MUTE");
  }
  unmute(): void {
    this.send("PORTAL_UNMUTE");
  }
  restart(): void {
    this.send("PORTAL_RESTART");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.handlers.clear();
    if (typeof window !== "undefined") window.removeEventListener("message", this.listener);
  }
}

// ── Game (iframe) bridge ────────────────────────────────────────

export interface GameSdkOptions {
  gameId: string;
  /** Origin to post to (the portal). Defaults to "*"; set explicitly in production. */
  targetOrigin?: string;
  /** Allowed origin(s) for inbound portal messages. Omit to accept same-origin only. */
  allowedOrigin?: AllowedOrigin;
  selfOrigin?: string;
}

export class GameSdk {
  private readonly gameId: string;
  private readonly targetOrigin: string;
  private readonly allowedOrigin: AllowedOrigin;
  private readonly selfOrigin?: string;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly listener: (event: MessageEvent) => void;
  private destroyed = false;

  constructor(opts: GameSdkOptions) {
    this.gameId = opts.gameId;
    this.targetOrigin = opts.targetOrigin ?? "*";
    this.allowedOrigin = opts.allowedOrigin;
    this.selfOrigin = opts.selfOrigin;
    this.listener = (event: MessageEvent) => {
      if (this.destroyed) return;
      const message = validateIncoming(event, {
        gameId: this.gameId,
        allowedOrigin: this.allowedOrigin,
        selfOrigin: this.selfOrigin,
        direction: "portal-to-game",
      });
      if (!message) return;
      const set = this.handlers.get(message.type);
      if (set) for (const handler of set) handler(message.payload, message);
    };
    if (typeof window !== "undefined") window.addEventListener("message", this.listener);
  }

  send(type: GameMessageType, payload?: unknown): void {
    if (this.destroyed) return;
    const parent = typeof window !== "undefined" ? window.parent : null;
    if (!parent) return;
    parent.postMessage(createMessage(this.gameId, type, payload), this.targetOrigin);
  }

  on(type: PortalMessageType, handler: MessageHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  off(type: PortalMessageType, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  ready(payload?: unknown): void {
    this.send("GAME_READY", payload);
  }
  started(payload?: unknown): void {
    this.send("GAME_STARTED", payload);
  }
  score(payload?: number): void {
    this.send("SCORE_UPDATED", payload);
  }
  gameOver(payload?: unknown): void {
    this.send("GAME_OVER", payload);
  }
  requestFullscreen(): void {
    this.send("REQUEST_FULLSCREEN");
  }
  saveData(payload?: unknown): void {
    this.send("SAVE_DATA", payload);
  }
  error(payload?: unknown): void {
    this.send("ERROR", payload);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.handlers.clear();
    if (typeof window !== "undefined") window.removeEventListener("message", this.listener);
  }
}
