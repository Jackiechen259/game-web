import { createHash, randomBytes, randomUUID } from "node:crypto";

/** SHA-256 hex digest of a string (used to hash session tokens and IPs). */
export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Cryptographically random URL-safe token. */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function newId(): string {
  return randomUUID();
}
