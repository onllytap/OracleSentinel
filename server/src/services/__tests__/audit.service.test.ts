import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// audit.service — append-only, PII/secret-safe audit log (T4)
//
// No live database: the PostgreSQL pool is fully mocked. These tests lock in
// the three guarantees that matter for security & reliability:
//   1. sanitizeMeta strips secret-looking keys and truncates long strings.
//   2. appendAudit NEVER throws — even when the DB rejects.
//   3. listAudit clamps the limit (1..200) and only ever SELECTs.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../../db/pool", () => ({
  pool: { query: h.query },
}));

import { sanitizeMeta, appendAudit, listAudit } from "../audit.service";

beforeEach(() => {
  h.query.mockReset();
  h.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ===========================================================================
// sanitizeMeta — PURE, PII/secret-safe
// ===========================================================================

describe("audit.service · sanitizeMeta", () => {
  it("drops secret-looking keys and keeps benign ones", () => {
    const out = sanitizeMeta({
      apiKey: "sk-should-be-gone",
      token: "abc",
      password: "hunter2",
      authorization: "Bearer x", // matches /auth/
      sessionId: "s-1", // matches /session/
      webhookUrl: "https://x", // matches /webhook/
      mode: "soft",
      count: 7,
      tenantId: "buchy-immo", // benign — survives
    });

    expect(out.apiKey).toBeUndefined();
    expect(out.token).toBeUndefined();
    expect(out.password).toBeUndefined();
    expect(out.authorization).toBeUndefined();
    expect(out.sessionId).toBeUndefined();
    expect(out.webhookUrl).toBeUndefined();

    expect(out.mode).toBe("soft");
    expect(out.count).toBe(7);
    expect(out.tenantId).toBe("buchy-immo");
  });

  it("drops secret-looking keys at nested depth too", () => {
    const out = sanitizeMeta({
      nested: { secretValue: "x", accessToken: "t", keep: "yes" },
    });
    const nested = out.nested as Record<string, unknown>;
    expect(nested.secretValue).toBeUndefined(); // /secret/
    expect(nested.accessToken).toBeUndefined(); // /token/
    expect(nested.keep).toBe("yes");
  });

  it("truncates strings longer than 500 chars", () => {
    const long = "a".repeat(1000);
    const out = sanitizeMeta({ note: long });
    const note = out.note as string;

    expect(note.length).toBeLessThan(long.length);
    expect(note.startsWith("a".repeat(500))).toBe(true);
    expect(note).toContain("truncated");
  });

  it("keeps strings of exactly 500 chars untouched", () => {
    const exact = "b".repeat(500);
    expect(sanitizeMeta({ note: exact }).note).toBe(exact);
  });

  it("returns an empty object for undefined / non-object input", () => {
    expect(sanitizeMeta(undefined)).toEqual({});
    expect(sanitizeMeta(null as any)).toEqual({});
    expect(sanitizeMeta("nope" as any)).toEqual({});
    expect(sanitizeMeta([] as any)).toEqual({});
  });
});

// ===========================================================================
// appendAudit — INSERT only, never throws
// ===========================================================================

describe("audit.service · appendAudit", () => {
  it("issues an INSERT into audit_log with sanitized meta", async () => {
    await appendAudit({
      actor: "admin",
      action: "rgpd.export",
      targetType: "tenant",
      targetId: "t1",
      meta: { apiKey: "sk-secret", mode: "soft" },
    });

    expect(h.query).toHaveBeenCalledTimes(1);
    const [sql, params] = h.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/INSERT INTO audit_log/i);

    // meta is the 5th bind param, serialized — the secret key must be gone.
    const metaJson = String(params[4]);
    expect(metaJson).not.toContain("apiKey");
    expect(metaJson).not.toContain("sk-secret");
    expect(metaJson).toContain("soft");

    expect(params[0]).toBe("admin"); // actor
    expect(params[1]).toBe("rgpd.export"); // action
    expect(params[3]).toBe("t1"); // target_id
  });

  it("does NOT throw when the mocked pool.query rejects", async () => {
    h.query.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      appendAudit({ actor: null, action: "rgpd.delete", targetId: "t1" }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ===========================================================================
// listAudit — clamps limit, SELECT only, maps rows
// ===========================================================================

describe("audit.service · listAudit", () => {
  it("clamps an over-large limit to 200", async () => {
    await listAudit({ limit: 9999 });
    const [sql, params] = h.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/SELECT[\s\S]*FROM audit_log/i);
    expect(String(sql)).toMatch(/ORDER BY created_at DESC/i);
    expect(params[params.length - 1]).toBe(200);
  });

  it("clamps a zero / negative limit up to 1", async () => {
    await listAudit({ limit: 0 });
    let params = h.query.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(1);

    h.query.mockClear();
    await listAudit({ limit: -50 });
    params = h.query.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(1);
  });

  it("defaults to a limit of 100 when none is given", async () => {
    await listAudit();
    const params = h.query.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(100);
  });

  it("adds parameterised filters for action and targetId", async () => {
    await listAudit({ action: "rgpd.export", targetId: "t1", limit: 50 });
    const [sql, params] = h.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toMatch(/WHERE/i);
    expect(String(sql)).toMatch(/action = \$1/);
    expect(String(sql)).toMatch(/target_id = \$2/);
    expect(params[0]).toBe("rgpd.export");
    expect(params[1]).toBe("t1");
    expect(params[2]).toBe(50);
  });

  it("maps rows to AuditEntry with id coerced to string", async () => {
    h.query.mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          actor: "admin",
          action: "rgpd.export",
          target_type: "tenant",
          target_id: "t1",
          meta: { mode: "soft" },
          created_at: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
    });

    const out = await listAudit();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("42");
    expect(typeof out[0].id).toBe("string");
    expect(out[0].actor).toBe("admin");
    expect(out[0].targetType).toBe("tenant");
    expect(out[0].targetId).toBe("t1");
    expect(out[0].meta).toEqual({ mode: "soft" });
    expect(out[0].createdAt).toBe("2024-01-01T00:00:00.000Z");
  });
});
