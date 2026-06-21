// ============================================================================
// totp.service.ts — TOTP (RFC 6238) second factor + recovery codes + lockout
//                    for the Command Center (QG) admin login (T7).
// ============================================================================
// ADDITIVE & lockout-proof by design. This module NEVER weakens the existing
// ways into the QG:
//   - Passkey login (passkey.service) is untouched.
//   - ADMIN_API_KEY login keeps working EXACTLY as today WHILE TOTP is not
//     activated. Only once TOTP is *activated* does the key path additionally
//     demand a TOTP code OR a recovery code.
//   - Break-glass (a SEPARATE env, ADMIN_BREAK_GLASS) is an independent door.
//
// Security properties:
//   - The TOTP secret is stored ENCRYPTED at rest (utils/crypto, AES-256-GCM)
//     and is returned to the caller ONLY once, at enrollment. It is never
//     logged and never returned afterwards.
//   - Recovery codes are random, single-use, and stored ONLY as SHA-256 hashes
//     (never in plaintext at rest). The plaintext set is returned ONLY once,
//     when enrollment is activated.
//   - All secret comparisons are constant-time.
//   - DB-read helpers fail "safe toward not-locking-out": if the admin_totp
//     table read fails, isTotpActivated() returns false so the key login keeps
//     working exactly as it does today.
//
// Implementation uses ONLY node:crypto (no new dependency): HMAC-SHA1 over the
// 8-byte counter, dynamic truncation to 6 digits, 30s step, ±1 step window.
//
// DB tables (created at boot elsewhere — this module only queries them):
//   admin_totp(id SMALLINT PK =1, secret_encrypted TEXT, activated BOOLEAN,
//              failed_attempts INT, locked_until TIMESTAMPTZ, created_at,
//              activated_at)
//   admin_recovery_codes(id BIGSERIAL, code_hash TEXT, used BOOLEAN,
//                        created_at, used_at)
// ============================================================================

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db/pool";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
} from "../utils/crypto";

// ── Tunables ────────────────────────────────────────────────────────────────
const TOTP_ROW_ID = 1; // the singleton admin_totp row
const STEP_SECONDS = 30; // RFC 6238 time step
const DIGITS = 6; // 6-digit codes
const WINDOW = 1; // accept current ±1 step (clock drift tolerance)
const SECRET_BYTES = 20; // 160-bit secret (RFC-recommended for SHA1)
const LOCKOUT_THRESHOLD = 5; // failed attempts before lockout
const LOCKOUT_MINUTES = 15; // lockout duration
const RECOVERY_CODE_COUNT = 10; // number of recovery codes generated
const RECOVERY_CODE_BYTES = 8; // entropy per recovery code (64 bits)

export interface TotpStatus {
  enrolled: boolean;
  activated: boolean;
}

interface TotpRow {
  id: number;
  secret_encrypted: string | null;
  activated: boolean;
  failed_attempts: number;
  locked_until: Date | string | null;
  created_at: Date | string | null;
  activated_at: Date | string | null;
}

// ── Base32 (RFC 4648, no padding required for 160-bit secrets) ───────────────
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes to a base32 string (uppercase, A–Z2–7). Exported for tests. */
export function base32Encode(buf: Buffer | Uint8Array): string {
  const bytes = Buffer.from(buf);
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Decode a base32 string to bytes. Ignores padding/whitespace/invalid chars. */
export function base32Decode(input: string): Buffer {
  const clean = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip spaces / invalid characters
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP core (RFC 4226 / RFC 6238) ───────────────────────────────────

/** Big-endian 8-byte counter buffer (no BigInt, safe for all step counters). */
function counterToBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);
  return buf;
}

/** HMAC-SHA1 HOTP with dynamic truncation to DIGITS digits. */
function hotp(secret: Buffer, counter: number): string {
  const hmac = createHmac("sha1", secret).update(counterToBuffer(counter)).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, "0");
}

/** Generate the TOTP code for a base32 secret at a given time. For tests/QR. */
export function generateTotp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/** Constant-time equality for two short strings (digit codes / hashes). */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * PURE verify: does `code` match the secret within the current ±WINDOW steps?
 * Constant-time across all candidate codes. Exported for tests.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
): boolean {
  const cleaned = String(code || "").replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(cleaned)) return false;

  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  let matched = false;
  for (let w = -WINDOW; w <= WINDOW; w++) {
    // Non-short-circuiting OR to keep timing independent of which step matches.
    if (constantTimeEqual(hotp(secret, counter + w), cleaned)) matched = true;
  }
  return matched;
}

// ── otpauth:// URI (for QR codes in authenticator apps) ──────────────────────
function buildOtpauthUri(secretBase32: string): string {
  const issuer = process.env.TOTP_ISSUER || "OracleSentinel";
  const account = process.env.TOTP_ACCOUNT || "admin";
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes ────────────────────────────────────────────────────────────

/** Canonical form for hashing/compare: uppercase, alphanumerics only. */
function normalizeRecoveryInput(code: string): string {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 hash (hex) of the canonical recovery code — what we store at rest. */
function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryInput(code)).digest("hex");
}

/** Display form: 16 hex chars grouped 4-4-4-4 (e.g. "1A2B-3C4D-5E6F-7081"). */
function formatRecoveryCode(): string {
  const raw = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase(); // 16 hex chars
  return raw.replace(/(.{4})(?=.)/g, "$1-");
}

function generateRecoveryCodes(count: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) codes.push(formatRecoveryCode());
  return codes;
}

// ── DB access (singleton admin_totp row) ─────────────────────────────────────

async function readTotpRow(): Promise<TotpRow | null> {
  const res = await pool.query(
    `SELECT id, secret_encrypted, activated, failed_attempts, locked_until,
            created_at, activated_at
       FROM admin_totp
      WHERE id = $1`,
    [TOTP_ROW_ID],
  );
  return (res?.rows?.[0] as TotpRow | undefined) ?? null;
}

function isLockedRow(row: TotpRow | null): boolean {
  if (!row || !row.locked_until) return false;
  const until =
    row.locked_until instanceof Date ? row.locked_until : new Date(row.locked_until);
  const t = until.getTime();
  return Number.isFinite(t) && t > Date.now();
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Non-secret status for the admin UI. Never returns the secret. */
export async function getTotpStatus(): Promise<TotpStatus> {
  try {
    const row = await readTotpRow();
    if (!row) return { enrolled: false, activated: false };
    return { enrolled: !!row.secret_encrypted, activated: !!row.activated };
  } catch {
    // Table unreadable → behave as "not enrolled" (never block the key login).
    return { enrolled: false, activated: false };
  }
}

/**
 * True ONLY when TOTP is fully activated AND a secret is present. Reads fail
 * safe (return false) so a transient DB issue can never lock the admin out of
 * the key-login path — it simply behaves as it does today.
 */
export async function isTotpActivated(): Promise<boolean> {
  try {
    const row = await readTotpRow();
    return !!(row && row.activated && row.secret_encrypted);
  } catch {
    return false;
  }
}

/**
 * Start enrollment: generate a fresh secret, store it ENCRYPTED with
 * activated=false, and return the secret + otpauth URI EXACTLY ONCE.
 * Throws "encryption_not_configured" if no APP_ENCRYPTION_KEY — we must never
 * persist a TOTP secret we cannot protect. (This never affects the key-login
 * path while TOTP is not activated.)
 */
export async function beginEnrollment(): Promise<{ secret: string; otpauthUri: string }> {
  if (!isEncryptionConfigured()) {
    throw new Error("encryption_not_configured");
  }
  const secret = base32Encode(randomBytes(SECRET_BYTES));
  const secretEncrypted = encryptSecret(secret);

  // Upsert the singleton row as a fresh, NOT-yet-activated enrollment.
  await pool.query(
    `INSERT INTO admin_totp
        (id, secret_encrypted, activated, failed_attempts, locked_until, created_at, activated_at)
     VALUES ($1, $2, FALSE, 0, NULL, NOW(), NULL)
     ON CONFLICT (id) DO UPDATE
        SET secret_encrypted = EXCLUDED.secret_encrypted,
            activated        = FALSE,
            failed_attempts  = 0,
            locked_until     = NULL,
            created_at       = NOW(),
            activated_at     = NULL`,
    [TOTP_ROW_ID, secretEncrypted],
  );

  return { secret, otpauthUri: buildOtpauthUri(secret) };
}

/**
 * Activate a pending enrollment by verifying a code from the authenticator.
 * On success: set activated=true and (re)generate the recovery code set,
 * storing only their SHA-256 hashes and returning the plaintext set ONCE.
 */
export async function activateEnrollment(
  code: string,
): Promise<{ ok: boolean; recoveryCodes?: string[]; error?: string }> {
  let row: TotpRow | null;
  try {
    row = await readTotpRow();
  } catch {
    return { ok: false, error: "totp_unavailable" };
  }
  if (!row || !row.secret_encrypted) return { ok: false, error: "no_pending_enrollment" };
  if (row.activated) return { ok: false, error: "already_activated" };

  let secret: string;
  try {
    secret = decryptSecret(row.secret_encrypted);
  } catch {
    return { ok: false, error: "totp_unavailable" };
  }

  if (!verifyTotpCode(secret, code)) {
    return { ok: false, error: "invalid_code" };
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = recoveryCodes.map(hashRecoveryCode);
  const valuesSql = hashes.map((_, i) => `($${i + 1}, FALSE, NOW())`).join(", ");

  try {
    // Replace any stale codes, then insert the new set, then activate last so
    // a partial failure never leaves an "activated but unprotected" state.
    await pool.query(`DELETE FROM admin_recovery_codes`);
    await pool.query(
      `INSERT INTO admin_recovery_codes (code_hash, used, created_at) VALUES ${valuesSql}`,
      hashes,
    );
    await pool.query(
      `UPDATE admin_totp
          SET activated = TRUE, activated_at = NOW(), failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [TOTP_ROW_ID],
    );
  } catch {
    return { ok: false, error: "totp_unavailable" };
  }

  return { ok: true, recoveryCodes };
}

/**
 * Verify a TOTP code against the ACTIVATED secret. Respects lockout (returns
 * false while locked). Resets the failure counter on success. Does NOT itself
 * record failures — the caller orchestrates recordFailedAttempt().
 */
export async function verifyTotp(code: string): Promise<boolean> {
  let row: TotpRow | null;
  try {
    row = await readTotpRow();
  } catch {
    return false;
  }
  if (!row || !row.activated || !row.secret_encrypted) return false;
  if (isLockedRow(row)) return false;

  let secret: string;
  try {
    secret = decryptSecret(row.secret_encrypted);
  } catch {
    return false;
  }

  const ok = verifyTotpCode(secret, code);
  if (ok) {
    await pool
      .query(
        `UPDATE admin_totp SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
        [TOTP_ROW_ID],
      )
      .catch(() => undefined);
  }
  return ok;
}

/**
 * Consume a single-use recovery code. Returns true exactly once per code; any
 * later use of the same code returns false (atomic via `WHERE used = FALSE`).
 */
export async function consumeRecoveryCode(code: string): Promise<boolean> {
  const canonical = normalizeRecoveryInput(code);
  if (canonical.length < 6) return false; // too short to be a real code

  const hash = createHash("sha256").update(canonical).digest("hex");
  try {
    const res = await pool.query(
      `UPDATE admin_recovery_codes
          SET used = TRUE, used_at = NOW()
        WHERE code_hash = $1 AND used = FALSE`,
      [hash],
    );
    const consumed = (res?.rowCount || 0) > 0;
    if (consumed) {
      await pool
        .query(
          `UPDATE admin_totp SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
          [TOTP_ROW_ID],
        )
        .catch(() => undefined);
    }
    return consumed;
  } catch {
    return false;
  }
}

/** Clears TOTP state + all recovery codes. Caller MUST be authorized. */
export async function disableTotp(): Promise<void> {
  await pool.query(`DELETE FROM admin_recovery_codes`);
  await pool.query(`DELETE FROM admin_totp WHERE id = $1`, [TOTP_ROW_ID]);
}

/**
 * Constant-time compare of `provided` to process.env.ADMIN_BREAK_GLASS.
 * Returns false when the env var is unset/empty (break-glass disabled), so the
 * common deployment (no break-glass configured) is entirely unaffected.
 */
export function isBreakGlass(provided: string): boolean {
  const expected = (process.env.ADMIN_BREAK_GLASS || "").trim();
  if (!expected) return false; // unset/empty → disabled
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Record a failed second-factor attempt. Increments failed_attempts and, once
 * the threshold is reached, sets locked_until = now + LOCKOUT_MINUTES.
 * Best-effort: never throws (it must not break the login flow).
 */
export async function recordFailedAttempt(): Promise<void> {
  try {
    const row = await readTotpRow();
    if (!row) return;
    const attempts = Number(row.failed_attempts ?? 0) + 1;
    const lockedUntil =
      attempts >= LOCKOUT_THRESHOLD
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
        : row.locked_until ?? null;
    await pool.query(
      `UPDATE admin_totp SET failed_attempts = $2, locked_until = $3 WHERE id = $1`,
      [TOTP_ROW_ID, attempts, lockedUntil],
    );
  } catch {
    // best-effort; never throw
  }
}

/** True while the admin is currently locked out. Reads fail safe (false). */
export async function isLockedOut(): Promise<boolean> {
  try {
    return isLockedRow(await readTotpRow());
  } catch {
    return false;
  }
}
