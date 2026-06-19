-- Rollback for Migration 003: Multi-tenant Row-Level Security (RLS)
-- ============================================================================
-- Finding F8 / ADR_0003. Source of truth: server/src/db/rls.ts
-- (buildRlsDisableSql). Reverts 003_rls_multitenant.sql completely.
--
-- After this runs, the multi-tenant tables behave exactly as before RLS was
-- applied (isolation relies solely on the applicative WHERE tenant_id filter).
--
-- Idempotent: safe to run multiple times, and safe to run even if RLS was
-- never applied (DROP POLICY IF EXISTS / DISABLE are no-ops then).
-- ============================================================================

BEGIN;

-- conversations
DROP POLICY IF EXISTS tenant_isolation ON conversations;
ALTER TABLE conversations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;

-- messages
DROP POLICY IF EXISTS tenant_isolation ON messages;
ALTER TABLE messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

-- leads
DROP POLICY IF EXISTS tenant_isolation ON leads;
ALTER TABLE leads NO FORCE ROW LEVEL SECURITY;
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;

-- catalog_properties
DROP POLICY IF EXISTS tenant_isolation ON catalog_properties;
ALTER TABLE catalog_properties NO FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_properties DISABLE ROW LEVEL SECURITY;

-- catalog_import_runs
DROP POLICY IF EXISTS tenant_isolation ON catalog_import_runs;
ALTER TABLE catalog_import_runs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_import_runs DISABLE ROW LEVEL SECURITY;

COMMIT;
