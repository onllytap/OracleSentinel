// ============================================================================
// crypto.ts — AES-256-GCM symmetric encryption for secrets at rest (Wave 0 / T0)
// ============================================================================
// Used to encrypt per-tenant CRM credentials (R17) and the TOTP secret (R14)
// BEFORE they are persisted. NEVER logs plaintext or the key.
//
// Blob format (base64):  iv(12 bytes) || authTag(16 bytes) || ciphertext
// Key:   APP_ENCRYPTION_KEY = 64 hex chars (32 bytes), e.g. `openssl rand -hex 32`.
//   - PRODUCTION without a valid key -> throws (refuse to handle secrets, R17.9).
//   - DEVELOPMENT without a key       -> derives a deterministic DEV key + warns
//     once (so dev secrets survive restarts; NEVER used in production).
// The GCM auth tag is verified on decrypt: any tampering / wrong key throws.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let warnedDevKey = false;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** The raw 32-byte key from APP_ENCRYPTION_KEY (64 hex), or null if absent/invalid. */
function keyFromEnv(): Buffer | null {
  const hex = (process.env.APP_ENCRYPTION_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

/** True when a valid APP_ENCRYPTION_KEY is configured. */
export function isEncryptionConfigured(): boolean {
  return keyFromEnv() !== null;
}

function resolveKey(): Buffer {
  const fromEnv = keyFromEnv();
  if (fromEnv) return fromEnv;

  if (isProduction()) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required in production (64 hex chars). " +
        "Refusing to handle secrets without it.",
    );
  }

  if (!warnedDevKey) {
    // eslint-disable-next-line no-console
    console.warn(
      "[security] APP_ENCRYPTION_KEY not set — using a derived DEV key (NOT for production). " +
        "Generate one with `openssl rand -hex 32` and set APP_ENCRYPTION_KEY.",
    );
    warnedDevKey = true;
  }
  // Deterministic dev-only key. Never reached in production (throws above).
  return createHash("sha256").update("oraclesentinel-dev-key-v1").digest();
}

/** Encrypt a UTF-8 string. Returns base64(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret: plaintext must be a string");
  }
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a blob produced by encryptSecret. Throws on bad key or tampering. */
export function decryptSecret(blob: string): string {
  const key = resolveKey();
  const raw = Buffer.from(String(blob || ""), "base64");
  if (raw.length <= IV_LEN + TAG_LEN) {
    throw new Error("decryptSecret: invalid or truncated blob");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // .final() throws if the auth tag does not verify (tampering / wrong key).
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt any JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value ?? null));
}

/** Decrypt a blob back into a typed JSON value. */
export function decryptJson<T = unknown>(blob: string): T {
  return JSON.parse(decryptSecret(blob)) as T;
}
