/**
 * Safe tar extraction with no external dependencies.
 *
 * Security (section 13.3): rejects entries that
 *   - are absolute paths
 *   - contain Windows drive prefixes
 *   - contain ".." traversal segments
 *   - resolve outside the destination
 *   - are symlinks (typeflag 2) or hardlinks (typeflag 1)
 *
 * Supports the tar features GitHub archives use: regular files, directories,
 * GNU long-name ("L") and PAX extended headers ("x"/"g") for long paths.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

const BLOCK_SIZE = 512;

export interface ExtractedFile {
  name: string;
  size: number;
}

function readOctal(buf: Buffer, start: number, len: number): number {
  const raw = buf.toString("utf8", start, start + len);
  const nul = raw.indexOf("\0");
  const cleaned = (nul === -1 ? raw : raw.slice(0, nul)).trim();
  if (!cleaned) return 0;
  return parseInt(cleaned, 8);
}

function cstr(buf: Buffer, start: number, len: number): string {
  const raw = buf.toString("utf8", start, start + len);
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

/**
 * Resolve an entry name to a safe absolute path under `dest`, throwing on
 * anything that escapes the destination.
 */
export function safeTarget(dest: string, name: string): string {
  const normalized = path.normalize(name);
  if (path.isAbsolute(normalized)) throw new Error(`Refusing absolute path: ${name}`);
  if (/^[A-Za-z]:[\\/]/.test(normalized)) throw new Error(`Refusing Windows drive path: ${name}`);
  if (normalized.split(path.sep).includes("..") || normalized.split("/").includes("..")) {
    throw new Error(`Refusing path traversal: ${name}`);
  }
  const target = path.resolve(dest, normalized);
  const rel = path.relative(path.resolve(dest), target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Entry escapes destination: ${name}`);
  }
  return target;
}

/** Parse PAX extended-header records and return the `path` override if present. */
function parsePaxPath(data: Buffer): string | null {
  let i = 0;
  let path: string | null = null;
  const text = data.toString("utf8");
  while (i < text.length) {
    const space = text.indexOf(" ", i);
    if (space === -1) break;
    const len = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > text.length) break;
    const record = text.slice(i + space + 1, i + len).replace(/\n$/, "");
    const eq = record.indexOf("=");
    if (eq !== -1) {
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1);
      if (key === "path") path = value;
    }
    i += len;
  }
  return path;
}

export async function extractTar(tar: Buffer, destDir: string): Promise<ExtractedFile[]> {
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.resolve(destDir);
  const files: ExtractedFile[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((b) => b === 0)) break; // end-of-archive

    const nameField = cstr(header, 0, 100);
    const prefix = cstr(header, 345, 155);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);

    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE);
    const data = size > 0 ? tar.subarray(dataStart, dataEnd) : Buffer.alloc(0);

    let name = longName ?? paxPath ?? (prefix ? `${prefix}/${nameField}` : nameField);
    longName = null;
    paxPath = null;
    // Normalise a leading "./" produced by some tar invocations.
    name = name.replace(/^\.\//, "");

    switch (typeflag) {
      case "L": // GNU long name
        longName = data.toString("utf8").replace(/\0[\s\S]*$/, "").replace(/\n.*$/, "");
        break;
      case "x":
      case "g": // PAX extended header
        paxPath = parsePaxPath(data);
        break;
      case "0":
      case "\0": {
        if (!name) throw new Error("Tar entry with empty name");
        const target = safeTarget(dest, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data);
        files.push({ name, size });
        break;
      }
      case "5": {
        // directory
        const target = safeTarget(dest, name);
        await fs.mkdir(target, { recursive: true });
        break;
      }
      case "1": // hardlink
      case "2": // symlink
        throw new Error(`Refusing to extract link entry (type ${typeflag}): ${name}`);
      default:
        // skip char/block/fifo/other
        break;
    }

    offset = paddedEnd;
  }

  return files;
}
