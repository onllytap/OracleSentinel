import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { resolveDbSslConfig } from "../pool";

// ============================================================================
// Cross-tenant isolation tests for the CURRENT applicative model
// (WHERE tenant_id = $x), INDEPENDENT of the RLS feature flag. This is the
// safety net that must hold whether or not RLS is ever enabled.
// ============================================================================

type Row = { tenant_id: string; secret: string };

// Models the applicative contract: callers must scope every read by tenant_id.
function scopedSelect(rows: Row[], tenantId: string): Row[] {
  return rows.filter((r) => r.tenant_id === tenantId);
}

describe("applicative tenant scoping (contract, no DB)", () => {
  const data: Row[] = [
    { tenant_id: "A", secret: "a1" },
    { tenant_id: "A", secret: "a2" },
    { tenant_id: "B", secret: "b1" },
  ];

  it("a tenant-scoped read returns only that tenant's rows", () => {
    expect(scopedSelect(data, "A").map((r) => r.secret).sort()).toEqual(["a1", "a2"]);
    expect(scopedSelect(data, "B").map((r) => r.secret)).toEqual(["b1"]);
  });

  it("a tenant never sees another tenant's rows", () => {
    expect(scopedSelect(data, "A").some((r) => r.tenant_id === "B")).toBe(false);
    expect(scopedSelect(data, "B").some((r) => r.tenant_id === "A")).toBe(false);
  });
});

// ============================================================================
// Real-DB cross-tenant proof. Skipped unless TEST_DATABASE_URL is set (a
// DEDICATED test DB — never the production Neon URL). Demonstrates both that
// the applicative filter isolates AND that OMITTING it leaks across tenants —
// the precise residual risk (F8) that RLS exists to cover.
// ============================================================================

const TEST_DB = process.env.TEST_DATABASE_URL;
const TABLE = `tenant_iso_${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!TEST_DB)("applicative isolation (real DB)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB!, ssl: resolveDbSslConfig(TEST_DB!) });
    await pool.query(
      `CREATE TABLE ${TABLE} (id serial primary key, tenant_id text not null, secret text not null)`,
    );
    await pool.query(
      `INSERT INTO ${TABLE} (tenant_id, secret) VALUES ('A','a1'),('A','a2'),('B','b1')`,
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
      await pool.end();
    }
  });

  it("WHERE tenant_id = $1 returns only the requested tenant", async () => {
    const a = await pool.query(`SELECT secret FROM ${TABLE} WHERE tenant_id = $1`, ["A"]);
    expect(a.rows.map((r) => r.secret).sort()).toEqual(["a1", "a2"]);

    const b = await pool.query(`SELECT secret FROM ${TABLE} WHERE tenant_id = $1`, ["B"]);
    expect(b.rows.map((r) => r.secret)).toEqual(["b1"]);
  });

  it("a query that FORGETS the tenant filter leaks every tenant (why RLS is the net)", async () => {
    const all = await pool.query(`SELECT secret FROM ${TABLE}`);
    expect(all.rowCount).toBe(3); // documents the residual risk RLS mitigates
  });
});
