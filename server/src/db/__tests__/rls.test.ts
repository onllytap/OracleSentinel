import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import {
  isRlsEnabled,
  buildRlsEnableSql,
  buildRlsDisableSql,
  withTenant,
  withAdminBypass,
  tenantQuery,
  RLS_TENANT_TABLES,
} from "../rls";
import { resolveDbSslConfig } from "../pool";

// ============================================================================
// Unit tests (always run — no database needed). They use an injected mock pool
// so the real Neon pool is never touched.
// ============================================================================

type RecordedQuery = { text: string; params?: any[] };

function makeMockPool() {
  const queries: RecordedQuery[] = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => {
      queries.push({ text, params });
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (text: string, params?: any[]) => {
      queries.push({ text, params });
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool: pool as unknown as Pool, client, queries };
}

describe("isRlsEnabled", () => {
  it("is OFF by default (unset / empty / false / 0)", () => {
    expect(isRlsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isRlsEnabled({ DB_RLS_ENABLED: "" } as any)).toBe(false);
    expect(isRlsEnabled({ DB_RLS_ENABLED: "false" } as any)).toBe(false);
    expect(isRlsEnabled({ DB_RLS_ENABLED: "0" } as any)).toBe(false);
  });

  it("is ON for 'true' / '1' (case-insensitive)", () => {
    expect(isRlsEnabled({ DB_RLS_ENABLED: "true" } as any)).toBe(true);
    expect(isRlsEnabled({ DB_RLS_ENABLED: "TRUE" } as any)).toBe(true);
    expect(isRlsEnabled({ DB_RLS_ENABLED: "1" } as any)).toBe(true);
  });
});

describe("buildRlsEnableSql / buildRlsDisableSql", () => {
  it("covers every multi-tenant table with an idempotent FORCE policy", () => {
    const sql = buildRlsEnableSql();
    for (const t of RLS_TENANT_TABLES) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
      expect(sql).toContain(`CREATE POLICY tenant_isolation ON ${t}`);
    }
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain("current_setting('app.bypass_rls', true) = 'on'");
  });

  it("rollback disables RLS and drops the policy on every table", () => {
    const sql = buildRlsDisableSql();
    for (const t of RLS_TENANT_TABLES) {
      expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
      expect(sql).toContain(`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`);
    }
  });
});

describe("withTenant", () => {
  it("opens a transaction, sets app.tenant_id (parameterized), commits and releases", async () => {
    const { pool, client, queries } = makeMockPool();
    const result = await withTenant("tenant-A", async (c) => {
      await c.query("SELECT 1");
      return "ok";
    }, pool);

    expect(result).toBe("ok");
    expect(queries[0].text).toBe("BEGIN");
    expect(queries[1].text).toBe("SELECT set_config('app.tenant_id', $1, true)");
    expect(queries[1].params).toEqual(["tenant-A"]);
    expect(queries.some((q) => q.text === "SELECT 1")).toBe(true);
    expect(queries.some((q) => q.text === "COMMIT")).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows on error, still releasing the client", async () => {
    const { pool, client, queries } = makeMockPool();
    await expect(
      withTenant("tenant-A", async () => {
        throw new Error("boom");
      }, pool),
    ).rejects.toThrow("boom");

    expect(queries.some((q) => q.text === "ROLLBACK")).toBe(true);
    expect(queries.some((q) => q.text === "COMMIT")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty tenantId (cannot silently skip the tenant context)", async () => {
    const { pool } = makeMockPool();
    await expect(withTenant("", async () => 1, pool)).rejects.toThrow(/tenantId/);
    await expect(withTenant("   ", async () => 1, pool)).rejects.toThrow(/tenantId/);
  });
});

describe("withAdminBypass", () => {
  it("sets app.bypass_rls='on' inside a transaction", async () => {
    const { pool, client, queries } = makeMockPool();
    await withAdminBypass(async (c) => {
      await c.query("SELECT count(*)");
    }, pool);

    expect(queries[0].text).toBe("BEGIN");
    expect(queries[1].text).toBe("SELECT set_config('app.bypass_rls', 'on', true)");
    expect(queries.some((q) => q.text === "COMMIT")).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("tenantQuery routing (the flag's observable effect)", () => {
  it("flag OFF -> plain pooled query, no transaction (current behaviour preserved)", async () => {
    const { pool, client } = makeMockPool();
    const res = await tenantQuery("tenant-A", "SELECT * FROM leads WHERE tenant_id = $1", ["tenant-A"], {
      env: {} as NodeJS.ProcessEnv,
      pool,
    });
    expect(res).toEqual({ rows: [], rowCount: 0 });
    expect((pool.query as any)).toHaveBeenCalledWith("SELECT * FROM leads WHERE tenant_id = $1", ["tenant-A"]);
    expect((pool.connect as any)).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("flag ON -> routes through withTenant (connect + BEGIN + set_config + COMMIT)", async () => {
    const { pool, client, queries } = makeMockPool();
    await tenantQuery("tenant-A", "SELECT 1", [], {
      env: { DB_RLS_ENABLED: "true" } as any,
      pool,
    });
    expect((pool.connect as any)).toHaveBeenCalledTimes(1);
    expect(queries[0].text).toBe("BEGIN");
    expect(queries[1].params).toEqual(["tenant-A"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Integration tests — REAL PostgreSQL enforcement of RLS.
// Skipped unless TEST_DATABASE_URL is set (a DEDICATED test database, NEVER the
// production Neon URL). Uses an ephemeral table so the real schema is untouched.
// ============================================================================

const TEST_DB = process.env.TEST_DATABASE_URL;
const TABLE = `rls_probe_${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!TEST_DB)("RLS enforcement (real DB)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: TEST_DB!,
      ssl: resolveDbSslConfig(TEST_DB!),
    });
    // 1) Create table + seed rows for two tenants BEFORE enabling RLS (so the
    //    WITH CHECK clause does not block the seed inserts).
    await pool.query(
      `CREATE TABLE ${TABLE} (id serial primary key, tenant_id text not null, secret text not null)`,
    );
    await pool.query(
      `INSERT INTO ${TABLE} (tenant_id, secret) VALUES ('A','a-secret-1'),('A','a-secret-2'),('B','b-secret-1')`,
    );
    // 2) Enable RLS + the same policy shape used in production.
    await pool.query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY tenant_isolation ON ${TABLE}
         USING (current_setting('app.bypass_rls', true) = 'on'
                OR tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
                OR tenant_id = current_setting('app.tenant_id', true))`,
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
      await pool.end();
    }
  });

  it("tenant A sees only A's rows", async () => {
    const rows = await withTenant("A", async (c) => (await c.query(`SELECT secret FROM ${TABLE}`)).rows, pool);
    expect(rows.map((r: any) => r.secret).sort()).toEqual(["a-secret-1", "a-secret-2"]);
  });

  it("tenant B cannot read A's rows", async () => {
    const rows = await withTenant("B", async (c) => (await c.query(`SELECT secret FROM ${TABLE}`)).rows, pool);
    expect(rows.map((r: any) => r.secret)).toEqual(["b-secret-1"]);
  });

  it("a connection with no tenant context sees no rows (safe default)", async () => {
    const res = await pool.query(`SELECT secret FROM ${TABLE}`);
    expect(res.rowCount).toBe(0);
  });

  it("admin bypass sees every tenant's rows", async () => {
    const rows = await withAdminBypass(async (c) => (await c.query(`SELECT secret FROM ${TABLE}`)).rows, pool);
    expect(rows.length).toBe(3);
  });

  it("tenant A cannot write a row for tenant B (WITH CHECK)", async () => {
    await expect(
      withTenant("A", async (c) => c.query(`INSERT INTO ${TABLE} (tenant_id, secret) VALUES ('B','evil')`), pool),
    ).rejects.toBeTruthy();
  });
});
