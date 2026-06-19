-- Migration 003: Multi-tenant Row-Level Security (RLS) — defense in depth
-- ============================================================================
-- Finding F8 / ADR_0003. Source of truth for this DDL: server/src/db/rls.ts
-- (buildRlsEnableSql). Keep the two in sync.
--
-- REVERSIBLE & OPT-IN: applying this migration is an OPERATOR decision and must
-- be validated in a TEST environment first (see ADR_0003). It is NOT run at
-- boot. The application only routes through RLS when DB_RLS_ENABLED=true.
--
-- Rollback: run 003_rls_multitenant.rollback.sql (drops policies + disables RLS).
--
-- Policy contract: a row is visible/writable when EITHER
--   * current_setting('app.bypass_rls') = 'on'   (admin / cross-tenant), OR
--   * tenant_id = current_setting('app.tenant_id')  (tenant-scoped path).
-- FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner, so a
-- connection that sets NEITHER GUC sees NO rows (safe default). Set the GUCs
-- transaction-locally via withTenant / withAdminBypass (see rls.ts).
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

BEGIN;

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conversations;
CREATE POLICY tenant_isolation ON conversations
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leads;
CREATE POLICY tenant_isolation ON leads
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- catalog_properties
ALTER TABLE catalog_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON catalog_properties;
CREATE POLICY tenant_isolation ON catalog_properties
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- catalog_import_runs
ALTER TABLE catalog_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_import_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON catalog_import_runs;
CREATE POLICY tenant_isolation ON catalog_import_runs
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

COMMIT;
