import { createHash } from "node:crypto";

/**
 * Accept canonical hex or unpadded base64url text for exactly 32 random bytes.
 * The returned digest is always SHA-256 over the token bytes, never its text form.
 */
export function digestCitizenToken(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let bytes: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    bytes = Buffer.from(value, "hex");
  } else if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
  } else {
    return null;
  }

  if (bytes.byteLength !== 32) return null;
  return createHash("sha256").update(bytes).digest("hex");
}
