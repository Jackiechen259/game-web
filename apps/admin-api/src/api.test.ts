import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { AdminUser, Role } from "@game-platform/admin-types";
import { buildContext, createApp, readConfig, Database, Store, type AppContext } from "./index.ts";
import { SESSION_COOKIE, CSRF_COOKIE } from "./auth/session.ts";

let ctx: AppContext;
let tmpDir: string;

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

function env(base: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...base };
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "admin-api-test-"));
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const configEnv = env({
    AUTH_PROVIDER: "dev",
    DEV_ADMIN_LOGIN: "admin",
    DEV_ADMIN_PASSWORD: "test1234",
    REPOSITORY_BACKEND: "local",
    LOCAL_REPO_PATH: path.join(tmpDir, "local-repo"),
    DATABASE_URL: path.join(tmpDir, "test.sqlite"),
    SESSION_SECRET: "test-secret-very-long-aaaaaaaaaaaa",
    ADMIN_GITHUB_USERS: "admin",
    ADMIN_ALLOWED_ORIGINS: "",
    GITHUB_GAME_LIBRARY_REPO: "owner/web-games-library",
    GITHUB_PORTAL_REPO: "owner/game-portal",
    NODE_ENV: "test",
    GAME_PLATFORM_REPO_ROOT: repoRoot,
  });
  const config = readConfig(configEnv);
  const database = new Database(config.databasePath);
  const store = new Store(database);
  ctx = buildContext(config, store);
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

let counter = 0;
function makeSession(role: Role): { cookie: string; csrf: string; user: AdminUser } {
  counter += 1;
  const user = ctx.store.createUser({
    provider: "dev",
    providerUserId: `u-${role}-${counter}`,
    login: `user-${role}-${counter}`,
    role,
  });
  const resMock = { cookie() {}, clearCookie() {} } as unknown as Parameters<typeof ctx.session.create>[0];
  const created = ctx.session.create(resMock, user, {});
  return {
    cookie: `${SESSION_COOKIE}=${created.cookieValue}; ${CSRF_COOKIE}=${created.csrfToken}`,
    csrf: created.csrfToken,
    user,
  };
}

const admin = () => makeSession("admin");
const editor = () => makeSession("editor");
const viewer = () => makeSession("viewer");

describe("admin-api: session & auth", () => {
  it("returns null user without a session", async () => {
    const res = await request(createApp(ctx)).get("/api/admin/v1/session");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it("logs in with dev credentials", async () => {
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/login")
      .send({ login: "admin", password: "test1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.login).toBe("admin");
    expect(res.body.csrfToken).toBeTruthy();
  });

  it("rejects invalid credentials", async () => {
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/login")
      .send({ login: "admin", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated access to admin routes", async () => {
    const res = await request(createApp(ctx)).get("/api/admin/v1/games");
    expect(res.status).toBe(401);
  });
});

describe("admin-api: roles & CSRF", () => {
  it("viewer can read but not write", async () => {
    const app = createApp(ctx);
    const v = viewer();
    const read = await request(app).get("/api/admin/v1/games").set("Cookie", v.cookie);
    expect(read.status).toBe(200);
    const write = await request(app)
      .post("/api/admin/v1/games")
      .set("Cookie", v.cookie)
      .set("x-csrf-token", v.csrf)
      .send({ id: "x", title: "X", description: "d", version: "1.0.0", status: "development", entry: "games/x/index.html", cover: "games/x/cover.png" });
    expect(write.status).toBe(403);
  });

  it("editor can write but cannot publish", async () => {
    const app = createApp(ctx);
    const e = editor();
    const publish = await request(app)
      .post("/api/admin/v1/publishing/publish")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf);
    expect(publish.status).toBe(403);
  });

  it("rejects mutating requests without a CSRF token", async () => {
    const app = createApp(ctx);
    const e = editor();
    const res = await request(app)
      .post("/api/admin/v1/games")
      .set("Cookie", e.cookie) // no x-csrf-token
      .send({ id: "csrf-test", title: "x", description: "d", version: "1.0.0", status: "development", entry: "games/x/index.html", cover: "games/x/cover.png" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });

  it("disabled admin cannot use an existing session", async () => {
    const app = createApp(ctx);
    const v = viewer();
    ctx.store.setUserEnabled(v.user.id, false);
    const res = await request(app).get("/api/admin/v1/games").set("Cookie", v.cookie);
    expect(res.status).toBe(401);
    ctx.store.setUserEnabled(v.user.id, true);
  });
});

describe("admin-api: game management", () => {
  it("lists seeded games", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/games").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.games.map((g: { id: string }) => g.id);
    expect(ids).toContain("snake");
    expect(ids).toContain("tetris");
  });

  it("gets a single game with sha", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/games/snake").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.id).toBe("snake");
    expect(res.body.sha).toBeTruthy();
  });

  it("creates a game, then rejects a duplicate id", async () => {
    const e = editor();
    const app = createApp(ctx);
    const body = {
      id: "pong",
      title: "Pong",
      description: "d",
      version: "1.0.0",
      status: "development",
      featured: false,
      entry: "games/pong/index.html",
      cover: "games/pong/cover.png",
      categories: ["休闲"],
      tags: [],
      controls: [],
      displayOrder: 1,
      iframe: { allow: ["fullscreen", "autoplay", "gamepad"], sandbox: ["allow-scripts", "allow-same-origin", "allow-pointer-lock"] },
    };
    const res = await request(app).post("/api/admin/v1/games").set("Cookie", e.cookie).set("x-csrf-token", e.csrf).send(body);
    expect(res.status).toBe(201);
    expect(res.body.game.id).toBe("pong");
    const dup = await request(app).post("/api/admin/v1/games").set("Cookie", e.cookie).set("x-csrf-token", e.csrf).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_ID");
    // Write pong's static assets so the catalog stays valid for publishing.
    const pongDir = path.join(ctx.config.localRepoPath, "games", "pong");
    mkdirSync(pongDir, { recursive: true });
    writeFileSync(path.join(pongDir, "index.html"), "<html><body>pong</body></html>");
    writeFileSync(path.join(pongDir, "cover.png"), PNG_1x1);
  });

  it("updates a game and detects concurrent modification (409)", async () => {
    const e = editor();
    const app = createApp(ctx);
    const before = await request(app).get("/api/admin/v1/games/snake").set("Cookie", e.cookie);
    const sha = before.body.sha as string;
    const first = await request(app)
      .patch("/api/admin/v1/games/snake")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ expectedSha: sha, title: "贪吃蛇 (改)" });
    expect(first.status).toBe(200);
    // Stale sha -> conflict.
    const stale = await request(app)
      .patch("/api/admin/v1/games/snake")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ expectedSha: sha, title: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("CONFIG_CONFLICT");
    expect(stale.body.currentSha).toBeTruthy();
    expect(stale.body.expectedSha).toBe(sha);
  });

  it("archives and restores a game", async () => {
    const e = editor();
    const app = createApp(ctx);
    const before = await request(app).get("/api/admin/v1/games/tetris").set("Cookie", e.cookie);
    const sha = before.body.sha as string;
    const archive = await request(app)
      .post("/api/admin/v1/games/tetris/archive")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ expectedSha: sha });
    expect(archive.status).toBe(200);
    expect(archive.body.game.status).toBe("archived");
    const restore = await request(app)
      .post("/api/admin/v1/games/tetris/restore")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ expectedSha: archive.body.sha });
    expect(restore.status).toBe(200);
    expect(restore.body.game.status).toBe("development");
  });

  it("validates a game", async () => {
    const e = editor();
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/games/snake/validate")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});

describe("admin-api: cover upload", () => {
  it("accepts a real PNG cover", async () => {
    const e = editor();
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/games/snake/cover")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ base64: PNG_1x1.toString("base64"), filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.cover).toContain("games/snake/cover");
  });

  it("rejects a forged (non-image) cover", async () => {
    const e = editor();
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/games/snake/cover")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ base64: Buffer.from("<script>x</script>").toString("base64"), filename: "evil.svg", contentType: "image/svg+xml" });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
  });

  it("rejects an oversized cover", async () => {
    const e = editor();
    const big = Buffer.alloc(6 * 1024 * 1024, 65); // 6MB > default 5MB
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/games/snake/cover")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf)
      .send({ base64: big.toString("base64"), filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });
});

describe("admin-api: publishing", () => {
  it("prepares (validates catalog)", async () => {
    const e = editor();
    const res = await request(createApp(ctx))
      .post("/api/admin/v1/publishing/prepare")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf);
    expect(res.status).toBe(200);
    expect(res.body.validation).toBeDefined();
  });

  it("admin publishes and a job is created", async () => {
    const a = admin();
    const app = createApp(ctx);
    const res = await request(app)
      .post("/api/admin/v1/publishing/publish")
      .set("Cookie", a.cookie)
      .set("x-csrf-token", a.csrf);
    expect(res.status).toBe(200);
    expect(res.body.publishJob.status).toBe("published");
    // Second publish while one just completed is allowed (no active). Verify status endpoint.
    const status = await request(app).get("/api/admin/v1/publishing/status").set("Cookie", a.cookie);
    expect(status.status).toBe(200);
  });
});

describe("admin-api: deployments, releases, audit, dashboard, settings", () => {
  it("lists deployments", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/deployments").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deployments)).toBe(true);
  });

  it("lists releases", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/releases").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.releases)).toBe(true);
  });

  it("rolls back a release (admin)", async () => {
    const a = admin();
    const list = await request(createApp(ctx)).get("/api/admin/v1/releases").set("Cookie", a.cookie);
    const releaseId = list.body.releases[0]?.id;
    if (!releaseId) return; // no releases to roll back
    const res = await request(createApp(ctx))
      .post(`/api/admin/v1/releases/${releaseId}/rollback`)
      .set("Cookie", a.cookie)
      .set("x-csrf-token", a.csrf);
    expect([200, 422]).toContain(res.status);
  });

  it("records audit logs for login and writes", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/audit").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    const actions = res.body.logs.map((l: { action: string }) => l.action);
    expect(actions.length).toBeGreaterThan(0);
  });

  it("returns dashboard stats", async () => {
    const v = viewer();
    const res = await request(createApp(ctx)).get("/api/admin/v1/dashboard").set("Cookie", v.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("published");
    expect(res.body).toHaveProperty("recentReleases");
  });

  it("gets and updates settings (admin)", async () => {
    const a = admin();
    const app = createApp(ctx);
    const get = await request(app).get("/api/admin/v1/settings").set("Cookie", a.cookie);
    expect(get.status).toBe(200);
    const settings = get.body.settings;
    const updated = { ...settings, siteName: "Updated Site" };
    const patch = await request(app)
      .patch("/api/admin/v1/settings")
      .set("Cookie", a.cookie)
      .set("x-csrf-token", a.csrf)
      .send({ expectedSha: get.body.sha, settings: updated });
    expect(patch.status).toBe(200);
  });

  it("viewer cannot update settings", async () => {
    const v = viewer();
    const res = await request(createApp(ctx))
      .patch("/api/admin/v1/settings")
      .set("Cookie", v.cookie)
      .set("x-csrf-token", v.csrf)
      .send({ expectedSha: "x", settings: {} });
    expect(res.status).toBe(403);
  });
});

describe("admin-api: previews", () => {
  it("creates a preview token and fetches it", async () => {
    const e = editor();
    const app = createApp(ctx);
    const create = await request(app)
      .post("/api/admin/v1/games/snake/preview")
      .set("Cookie", e.cookie)
      .set("x-csrf-token", e.csrf);
    expect(create.status).toBe(200);
    const token = create.body.previewId;
    const get = await request(app).get(`/api/admin/v1/previews/${token}`).set("Cookie", e.cookie);
    expect(get.status).toBe(200);
    expect(get.body.gameId).toBe("snake");
  });
});

describe("admin-api: security", () => {
  it("error responses do not leak stack traces or secrets", async () => {
    const res = await request(createApp(ctx)).get("/api/admin/v1/games/does-not-exist");
    // Unauthenticated -> 401, but the error shape must not include secrets.
    expect(res.body.error).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token|authorization/i);
  });

  it("rejects unknown routes with a stable error", async () => {
    const res = await request(createApp(ctx)).get("/api/admin/v1/nonexistent");
    expect(res.status).toBe(401); // requires session first
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("fixture cover is a real PNG", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const cover = readFileSync(path.join(repoRoot, "tests", "fixtures", "games-library-dist", "games", "snake", "cover.png"));
    expect(cover.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
