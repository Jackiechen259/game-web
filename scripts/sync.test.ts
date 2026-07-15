import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  atomicReplaceDir,
  atomicWriteFile,
  downloadToBuffer,
  gunzipBuffer,
  readConfig,
  syncGames,
  type SyncConfig,
} from "./sync-lib.ts";
import { extractTar, safeTarget } from "./tar.ts";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function makeTarGz(srcDir: string): Buffer {
  // Create a gzipped tar of the contents of srcDir.
  return execFileSync("tar", ["-czf", "-", "-C", srcDir, "."]);
}

describe("safeTarget", () => {
  const dest = path.resolve(tmpdir(), "extract-dest");

  it("rejects path traversal", () => {
    expect(() => safeTarget(dest, "../evil")).toThrow();
    expect(() => safeTarget(dest, "sub/../../evil")).toThrow();
  });
  it("rejects absolute paths", () => {
    expect(() => safeTarget(dest, "/etc/passwd")).toThrow();
  });
  it("rejects Windows drive paths", () => {
    expect(() => safeTarget(dest, "C:\\Windows\\evil")).toThrow();
  });
  it("accepts a normal relative path", () => {
    const target = safeTarget(dest, "games/snake/index.html");
    expect(target).toBe(path.join(dest, "games", "snake", "index.html"));
  });
});

describe("extractTar", () => {
  it("extracts regular files and directories", async () => {
    const src = await makeTempDir("tar-src-");
    await mkdir(path.join(src, "games", "snake"), { recursive: true });
    await writeFile(path.join(src, "games", "snake", "index.html"), "<html>ok</html>");
    await writeFile(path.join(src, "catalog.json"), "{}");
    const gz = makeTarGz(src);
    const tar = gunzipSync(gz);
    const dest = await makeTempDir("tar-dest-");
    const files = await extractTar(tar, dest);
    expect(files.map((f) => f.name).sort()).toEqual(["catalog.json", "games/snake/index.html"]);
    expect(existsSync(path.join(dest, "games", "snake", "index.html"))).toBe(true);
    expect(await readFile(path.join(dest, "games", "snake", "index.html"), "utf8")).toBe("<html>ok</html>");
  });

  it("rejects symlink entries", async () => {
    const src = await makeTempDir("tar-symlink-");
    await mkdir(path.join(src, "real"), { recursive: true });
    await writeFile(path.join(src, "real", "secret.txt"), "topsecret");
    // Create a symlink pointing outside the archive root.
    execFileSync("ln", ["-s", "../../escape", path.join(src, "linkdir")]);
    const gz = makeTarGz(src);
    const tar = gunzipSync(gz);
    const dest = await makeTempDir("tar-symlink-dest-");
    await expect(extractTar(tar, dest)).rejects.toThrow(/link entry/);
  });

  it("handles GNU long names", async () => {
    const src = await makeTempDir("tar-long-");
    await mkdir(path.join(src, "a", "b"), { recursive: true });
    // 101+ character filename triggers GNU long-name extension.
    const longName = "x".repeat(120) + ".txt";
    await writeFile(path.join(src, "a", "b", longName), "long");
    const gz = makeTarGz(src);
    const tar = gunzipSync(gz);
    const dest = await makeTempDir("tar-long-dest-");
    await extractTar(tar, dest);
    expect(existsSync(path.join(dest, "a", "b", longName))).toBe(true);
  });
});

describe("gunzipBuffer", () => {
  it("rejects archives that decompress beyond the cap", async () => {
    // Compress a 4MB zero buffer; cap at 1MB.
    const big = Buffer.alloc(4 * 1024 * 1024, 0);
    const gz = requireGzip(big);
    await expect(gunzipBuffer(gz, 1024 * 1024)).rejects.toThrow(/exceeds/);
  });
});

function requireGzip(buf: Buffer): Buffer {
  return execFileSync("gzip", [], { input: buf });
}

describe("downloadToBuffer", () => {
  let server: Server;

  afterEach(async () => {
    if (server) await new Promise((res) => server.close(res));
  });

  it("rejects responses larger than maxBytes", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      // Write ~1MB in 64KB chunks.
      const chunk = Buffer.alloc(64 * 1024, 65);
      let written = 0;
      const write = () => {
        if (written >= 1024 * 1024) {
          res.end();
          return;
        }
        res.write(chunk, () => {
          written += chunk.length;
          write();
        });
      };
      write();
    });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as { port: number }).port;
    await expect(downloadToBuffer(`http://127.0.0.1:${port}/`, {}, 1024, 5000)).rejects.toThrow(/exceeds/);
  });
});

describe("atomicReplaceDir / atomicWriteFile", () => {
  it("replaces the destination and keeps a backup briefly", async () => {
    const base = await makeTempDir("atomic-");
    const src = path.join(base, "src");
    const dest = path.join(base, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "new.txt"), "new");
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "old.txt"), "old");
    await atomicReplaceDir(src, dest);
    expect(existsSync(path.join(dest, "new.txt"))).toBe(true);
    expect(existsSync(path.join(dest, "old.txt"))).toBe(false);
  });

  it("atomicWriteFile writes and renames", async () => {
    const base = await makeTempDir("aw-");
    const src = path.join(base, "s.txt");
    const dest = path.join(base, "d.txt");
    await writeFile(src, "hello");
    await atomicWriteFile(src, dest);
    expect(await readFile(dest, "utf8")).toBe("hello");
  });
});

describe("syncGames (local fixture)", () => {
  it("syncs a valid local catalog to the output dir", async () => {
    const fixture = await makeTempDir("fx-");
    await mkdir(path.join(fixture, "games", "snake"), { recursive: true });
    await mkdir(path.join(fixture, "games", "tetris"), { recursive: true });
    const catalog = {
      schemaVersion: 1,
      generatedAt: "2026-07-15T00:00:00Z",
      games: [
        { id: "snake", title: "Snake", description: "d", version: "1.0.0", entry: "games/snake/index.html", cover: "games/snake/cover.png", categories: [], tags: [], status: "published", featured: true, controls: [], createdAt: "2026-07-01", updatedAt: "2026-07-15" },
      ],
    };
    await writeFile(path.join(fixture, "catalog.json"), JSON.stringify(catalog));
    await writeFile(path.join(fixture, "settings.json"), JSON.stringify({ schemaVersion: 1, siteName: "S", siteDescription: "d", navigation: [] }));
    await writeFile(path.join(fixture, "games", "snake", "index.html"), "<html>snake</html>");
    await writeFile(path.join(fixture, "games", "snake", "cover.png"), Buffer.alloc(8));

    const outputDir = await makeTempDir("out-");
    const config: SyncConfig = {
      ...readConfig({ GAMES_SYNC_ENABLED: "true", GAMES_LOCAL_PATH: fixture }, path.dirname(fixture)),
      outputDir,
    };
    const logs: string[] = [];
    const result = await syncGames(config, { logger: { info: (m) => logs.push(m), warn: () => {}, error: (m) => logs.push(m) } });
    expect(result.ok).toBe(true);
    expect(result.gameCount).toBe(1);
    expect(result.source).toBe("local");
    expect(existsSync(path.join(outputDir, "game-catalog.json"))).toBe(true);
    expect(existsSync(path.join(outputDir, "games", "snake", "index.html"))).toBe(true);
    expect(existsSync(path.join(outputDir, "site-settings.json"))).toBe(true);
    const info = JSON.parse(await readFile(path.join(outputDir, "games-sync-info.json"), "utf8"));
    expect(info.gameCount).toBe(1);
    expect(info.commit).toBe("local");
    expect(logs.some((l) => l.includes("Completed") || l.includes("completed"))).toBe(true);
  });

  it("does not delete the previous result when validation fails", async () => {
    const fixture = await makeTempDir("fx-bad-");
    await mkdir(path.join(fixture, "games", "snake"), { recursive: true });
    // Catalog references a cover file that does not exist -> validation fails.
    const catalog = {
      schemaVersion: 1,
      generatedAt: "2026-07-15T00:00:00Z",
      games: [
        { id: "snake", title: "Snake", description: "d", version: "1.0.0", entry: "games/snake/index.html", cover: "games/snake/missing.png", categories: [], tags: [], status: "published", featured: false, controls: [], createdAt: "2026-07-01", updatedAt: "2026-07-15" },
      ],
    };
    await writeFile(path.join(fixture, "catalog.json"), JSON.stringify(catalog));
    await writeFile(path.join(fixture, "games", "snake", "index.html"), "<html>snake</html>");

    const outputDir = await makeTempDir("out-bad-");
    await mkdir(path.join(outputDir, "games", "snake"), { recursive: true });
    await writeFile(path.join(outputDir, "games", "snake", "marker.txt"), "previous");
    await writeFile(path.join(outputDir, "game-catalog.json"), "{}");

    const config: SyncConfig = {
      ...readConfig({ GAMES_SYNC_ENABLED: "true", GAMES_LOCAL_PATH: fixture }, path.dirname(fixture)),
      outputDir,
    };
    const result = await syncGames(config, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
    expect(result.ok).toBe(false);
    // Previous result preserved.
    expect(existsSync(path.join(outputDir, "games", "snake", "marker.txt"))).toBe(true);
    expect(await readFile(path.join(outputDir, "game-catalog.json"), "utf8")).toBe("{}");
  });

  it("does not copy unrelated source files outside games/", async () => {
    const fixture = await makeTempDir("fx-unrelated-");
    await mkdir(path.join(fixture, "games", "snake"), { recursive: true });
    await mkdir(path.join(fixture, "secret"), { recursive: true });
    await writeFile(path.join(fixture, "secret", "private.key"), "PRIVATE");
    await writeFile(path.join(fixture, "catalog.json"), JSON.stringify({
      schemaVersion: 1, generatedAt: "2026-07-15T00:00:00Z",
      games: [{ id: "snake", title: "Snake", description: "d", version: "1.0.0", entry: "games/snake/index.html", cover: "games/snake/cover.png", categories: [], tags: [], status: "published", featured: false, controls: [], createdAt: "2026-07-01", updatedAt: "2026-07-15" }],
    }));
    await writeFile(path.join(fixture, "games", "snake", "index.html"), "<html/>");
    await writeFile(path.join(fixture, "games", "snake", "cover.png"), Buffer.alloc(8));
    const outputDir = await makeTempDir("out-unrelated-");
    const config: SyncConfig = {
      ...readConfig({ GAMES_SYNC_ENABLED: "true", GAMES_LOCAL_PATH: fixture }, path.dirname(fixture)),
      outputDir,
    };
    await syncGames(config, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
    expect(existsSync(path.join(outputDir, "games", "snake", "index.html"))).toBe(true);
    expect(existsSync(path.join(outputDir, "secret"))).toBe(false);
  });

  afterEach(async () => {
    // Best-effort cleanup of tmp dirs (OS will reap eventually).
    await Promise.resolve();
  });
});
