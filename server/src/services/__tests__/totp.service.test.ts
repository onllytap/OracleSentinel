import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// totp.service — TOTP 2-step + recovery codes + lockout + break-glass (T7)
//
// No live database: the pg pool is mocked. The RFC 6238 / window assertions are
// PURE (no DB). The recovery-code and lockout assertions drive a tiny stateful
// mock of pool.query that reacts to the SQL it receives. A valid 64-hex
// APP_ENCRYPTION_KEY is set so any code path that touches utils/crypto works,
// though the tested paths here do not require decrypting a stored secret.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db/pool", () => ({ pool: { query: h.query } }));

import {
  base32Encode,
  generateTotp,
  verifyTotpCode,
  consumeRecoveryCode,
  recordFailedAttempt,
  isLockedOut,
  isBreakGlass,
} from "../totp.service";

// 64 hex chars = 32 bytes — a valid APP_ENCRYPTION_KEY for tests.
const TEST_KEY = "a".repeat(64);

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  delete process.env.ADMIN_BREAK_GLASS;
  h.query.mockReset();
  h.query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_BREAK_GLASS;
});

// ===========================================================================
// RFC 6238 — known vectors, wrong code, ±1 window  (PURE, no DB)
// ===========================================================================

describe("totp.service · RFC 6238", () => {
  // The canonical RFC 6238 SHA1 test secret is the ASCII string
  // "12345678901234567890" (20 bytes). base32-encoded it is the well-known
  // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
  const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

  it("base32-encodes the RFC secret to the canonical value", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("generates the documented 6-digit codes for known timestamps", () => {
    // RFC 6238 Appendix B (SHA1) truncated to 6 digits:
    //   T=59          -> 94287082 -> 287082
    //   T=1111111109  -> 07081804 -> 081804
    //   T=1234567890  -> 89005924 -> 005924
    expect(generateTotp(RFC_SECRET, 59 * 1000)).toBe("287082");
    expect(generateTotp(RFC_SECRET, 1111111109 * 1000)).toBe("081804");
    expect(generateTotp(RFC_SECRET, 1234567890 * 1000)).toBe("005924");
  });

  it("verifies a freshly generated code and rejects a wrong one", () => {
    const t = 1_700_000_000_000; // fixed instant
    const good = generateTotp(RFC_SECRET, t);
    expect(verifyTotpCode(RFC_SECRET, good, t)).toBe(true);

    // A different 6-digit string must not verify.
    const wrong = good === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(RFC_SECRET, wrong, t)).toBe(false);

    // Non-numeric / wrong-length inputs are rejected.
    expect(verifyTotpCode(RFC_SECRET, "12ab56", t)).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, "12345", t)).toBe(false);
  });

  it("tolerates clock drift of ±1 step but not 2 steps", () => {
    const t = 1_700_000_000_000;
    const STEP = 30 * 1000;

    const prev = generateTotp(RFC_SECRET, t - STEP);
    const next = generateTotp(RFC_SECRET, t + STEP);
    const twoBack = generateTotp(RFC_SECRET, t - 2 * STEP);
    const twoFwd = generateTotp(RFC_SECRET, t + 2 * STEP);

    expect(verifyTotpCode(RFC_SECRET, prev, t)).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, next, t)).toBe(true);

    // Two steps away is outside the ±1 window (unless it happens to collide,
    // which is astronomically unlikely for these distinct counters).
    expect(verifyTotpCode(RFC_SECRET, twoBack, t)).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, twoFwd, t)).toBe(false);
  });
});

// ===========================================================================
// Recovery codes — single use
// ===========================================================================

describe("totp.service · consumeRecoveryCode (single-use)", () => {
  it("consumes a code exactly once; the second attempt fails", async () => {
    // Stateful mock: a recovery-code UPDATE succeeds (rowCount 1) only the first
    // time a given hash is seen — mirroring `WHERE used = FALSE` in Postgres.
    const used = new Set<string>();
    h.query.mockImplementation(async (sql: string, params: any[]) => {
      if (/UPDATE admin_recovery_codes/i.test(sql)) {
        const hash = params[0];
        if (used.has(hash)) return { rows: [], rowCount: 0 };
        used.add(hash);
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE admin_totp/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const code = "1A2B-3C4D-5E6F-7081";
    expect(await consumeRecoveryCode(code)).toBe(true);
    expect(await consumeRecoveryCode(code)).toBe(false);

    // Normalisation: dashes/case do not matter — same code, still consumed.
    expect(await consumeRecoveryCode("1a2b3c4d5e6f7081")).toBe(false);
  });

  it("rejects empty / too-short input without hitting the DB", async () => {
    expect(await consumeRecoveryCode("")).toBe(false);
    expect(await consumeRecoveryCode("12")).toBe(false);
    expect(h.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Lockout — after N failed attempts
// ===========================================================================

describe("totp.service · lockout", () => {
  it("locks out after the threshold of failed attempts", async () => {
    // Stateful singleton row driven by the mock.
    const row: any = {
      id: 1,
      secret_encrypted: "enc",
      activated: true,
      failed_attempts: 0,
      locked_until: null,
      created_at: new Date(),
      activated_at: new Date(),
    };

    h.query.mockImplementation(async (sql: string, params: any[]) => {
      if (/SELECT[\s\S]*FROM admin_totp/i.test(sql)) {
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/UPDATE admin_totp SET failed_attempts = \$2/i.test(sql)) {
        row.failed_attempts = params[1];
        row.locked_until = params[2];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    expect(await isLockedOut()).toBe(false);

    // 4 failures: still not locked (threshold is 5).
    for (let i = 0; i < 4; i++) await recordFailedAttempt();
    expect(row.failed_attempts).toBe(4);
    expect(await isLockedOut()).toBe(false);

    // 5th failure trips the lockout.
    await recordFailedAttempt();
    expect(row.failed_attempts).toBe(5);
    expect(row.locked_until).toBeInstanceOf(Date);
    expect(await isLockedOut()).toBe(true);
  });

  it("is not locked when locked_until is in the past", async () => {
    const past = new Date(Date.now() - 60_000);
    h.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*FROM admin_totp/i.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              secret_encrypted: "enc",
              activated: true,
              failed_attempts: 9,
              locked_until: past,
              created_at: new Date(),
              activated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    expect(await isLockedOut()).toBe(false);
  });
});

// ===========================================================================
// Break-glass — env-gated, constant-time, exact match
// ===========================================================================

describe("totp.service · isBreakGlass", () => {
  it("returns false when ADMIN_BREAK_GLASS is unset", () => {
    delete process.env.ADMIN_BREAK_GLASS;
    expect(isBreakGlass("anything")).toBe(false);
    expect(isBreakGlass("")).toBe(false);
  });

  it("returns false when ADMIN_BREAK_GLASS is empty / whitespace", () => {
    process.env.ADMIN_BREAK_GLASS = "   ";
    expect(isBreakGlass("   ")).toBe(false);
    expect(isBreakGlass("anything")).toBe(false);
  });

  it("returns true only on an exact match when set", () => {
    process.env.ADMIN_BREAK_GLASS = "break-glass-secret-XYZ-123";
    expect(isBreakGlass("break-glass-secret-XYZ-123")).toBe(true);
    expect(isBreakGlass("break-glass-secret-XYZ-124")).toBe(false);
    expect(isBreakGlass("break-glass-secret-XYZ-12")).toBe(false); // length differs
    expect(isBreakGlass("")).toBe(false);
  });
});
