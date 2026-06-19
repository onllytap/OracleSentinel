import type { Pool, PoolClient } from 'pg';
import { pool } from './pool';

// ============================================================================
// Row-Level Security (RLS) — defense in depth for multi-tenant isolation.
// Finding F8 / ADR_0003.
//
// This module ships the MECHANISM and is OFF BY DEFAULT (DB_RLS_ENABLED unset).
// While disabled, NOTHING in the data path changes: isolation keeps relying on
// the existing applicative `WHERE tenant_id = $x` filtering. When enabled (in a
// validated environment, by an operator), the widget/chat path can route DB
// access through `withTenant`, and PostgreSQL itself enforces tenant isolation
// so a future missing filter can no longer leak data cross-tenant.
//
// Activation is deliberately a two-step operator decision (see ADR_0003):
//   1. Apply the RLS policies to the database (migration 003, or
//      applyRlsPolicies()).
//   2. Run the application with a NON-owner role for tenant traffic, or rely on
//      FORCE ROW LEVEL SECURITY (used here) so the policy applies even to the
//      table owner. Set DB_RLS_ENABLED=true so tenantQuery routes through
//      withTenant.
// ============================================================================

/** Multi-tenant tables that carry `tenant_id` and must be isolated. */
export const RLS_TENANT_TABLES = [
  'conversations',
  'messages',
  'leads',
  'catalog_properties',
  'catalog_import_runs',
] as const;

const RLS_POLICY_NAME = 'tenant_isolation';

/**
 * Feature flag — RLS routing is OFF by default. When false (the default),
 * behaviour is 100% unchanged. Accepts "true"/"1" (case-insensitive).
 */
export function isRlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DB_RLS_ENABLED || '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * Idempotent SQL enabling RLS + a tenant policy on every multi-tenant table.
 *
 * A row is visible/writable when EITHER:
 *   - app.bypass_rls = 'on'                       (admin / cross-tenant path), OR
 *   - tenant_id = current_setting('app.tenant_id') (tenant-scoped path).
 *
 * FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner, so
 * isolation holds even with the single shared application role. A connection
 * that sets NEITHER GUC sees NO rows (safe default).
 */
export function buildRlsEnableSql(): string {
  return RLS_TENANT_TABLES.map(
    (t) => `-- ${t}
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON ${t};
CREATE POLICY ${RLS_POLICY_NAME} ON ${t}
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );`,
  ).join('\n\n');
}

/** Idempotent rollback: drop the policy and disable RLS on every table. */
export function buildRlsDisableSql(): string {
  return RLS_TENANT_TABLES.map(
    (t) => `-- ${t}
DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON ${t};
ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`,
  ).join('\n\n');
}

/** Apply the RLS policies (idempotent). Operator/test use; never auto-run. */
export async function applyRlsPolicies(p: Pool = pool): Promise<void> {
  await p.query(buildRlsEnableSql());
}

/** Remove the RLS policies (idempotent rollback). */
export async function removeRlsPolicies(p: Pool = pool): Promise<void> {
  await p.query(buildRlsDisableSql());
}

/**
 * Run `fn` inside a transaction scoped to a single tenant.
 *
 * Uses `set_config('app.tenant_id', $1, true)` — the parameterized,
 * transaction-local (is_local=true) equivalent of `SET LOCAL`, which is safe
 * with connection pooling because it is reset when the transaction ends. With
 * RLS enabled, the connection then only sees/writes rows for `tenantId`.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
  p: Pool = pool,
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new Error('withTenant: a non-empty tenantId is required');
  }
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.trim()]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a transaction with RLS bypass enabled — for the admin /
 * super-admin aggregation endpoints (/api/admin/db/*, /api/priv/overview,
 * fleet.service) that legitimately read across ALL tenants. These keep seeing
 * every tenant even when RLS is enabled.
 */
export async function withAdminBypass<T>(
  fn: (client: PoolClient) => Promise<T>,
  p: Pool = pool,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * High-level tenant query entry point — the single integration point the
 * widget/chat data path adopts at activation.
 *
 *   - RLS disabled (default): preserves the EXACT current behaviour (a plain
 *     pooled query; isolation via the caller's applicative `WHERE tenant_id`).
 *   - RLS enabled: routes through withTenant so PostgreSQL enforces isolation.
 *
 * The `pool`/`env` options exist for testability and never need to be passed
 * in production code.
 */
export async function tenantQuery<R = any>(
  tenantId: string,
  text: string,
  params: any[] = [],
  opts: { env?: NodeJS.ProcessEnv; pool?: Pool } = {},
): Promise<{ rows: R[]; rowCount: number | null }> {
  const env = opts.env ?? process.env;
  const p = opts.pool ?? pool;

  if (!isRlsEnabled(env)) {
    const res = await p.query(text, params);
    return { rows: res.rows as R[], rowCount: res.rowCount };
  }

  return withTenant(
    tenantId,
    async (client) => {
      const res = await client.query(text, params);
      return { rows: res.rows as R[], rowCount: res.rowCount };
    },
    p,
  );
}
