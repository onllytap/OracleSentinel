import { pool } from './pool';

export const ENSURE_DB_SQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(100) NOT NULL DEFAULT 'default',
    session_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
UPDATE conversations SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE conversations ALTER COLUMN tenant_id SET DEFAULT 'default';
ALTER TABLE conversations ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_session_id ON conversations (tenant_id, session_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(100) NOT NULL DEFAULT 'default',
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
UPDATE messages m
SET tenant_id = c.tenant_id
FROM conversations c
WHERE m.conversation_id = c.id AND (m.tenant_id IS NULL OR m.tenant_id = '');
UPDATE messages SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE messages ALTER COLUMN tenant_id SET DEFAULT 'default';
ALTER TABLE messages ALTER COLUMN tenant_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(100) NOT NULL DEFAULT 'default',
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    tools_mentioned TEXT[],
    automation_needs TEXT,
    timeline VARCHAR(100),
    chat_summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
UPDATE leads l
SET tenant_id = c.tenant_id
FROM conversations c
WHERE l.conversation_id = c.id AND (l.tenant_id IS NULL OR l.tenant_id = '');
UPDATE leads SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = '';
ALTER TABLE leads ALTER COLUMN tenant_id SET DEFAULT 'default';
ALTER TABLE leads ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_updated_at ON conversations(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_conversation_created_at ON messages(tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created_at ON leads(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS airtable_leads (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(50) UNIQUE NOT NULL,
    session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_airtable_leads_phone ON airtable_leads (phone);
CREATE INDEX IF NOT EXISTS idx_airtable_leads_created ON airtable_leads (created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
    key VARCHAR(255) PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    reset_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (reset_at);

CREATE TABLE IF NOT EXISTS catalog_import_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(100) NOT NULL,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('dry_run', 'commit')),
    source_name TEXT,
    seen_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    committed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_runs_tenant_created ON catalog_import_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_import_errors (
    id BIGSERIAL PRIMARY KEY,
    import_run_id UUID NOT NULL REFERENCES catalog_import_runs(id) ON DELETE CASCADE,
    id_unique VARCHAR(255),
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_errors_run ON catalog_import_errors (import_run_id);

CREATE TABLE IF NOT EXISTS catalog_properties (
    tenant_id VARCHAR(100) NOT NULL,
    id_unique VARCHAR(255) NOT NULL,

    type VARCHAR(20) CHECK (type IN ('maison','appartement','terrain','autre')),
    transaction VARCHAR(20) CHECK (transaction IN ('vente','location')),
    statut VARCHAR(20) NOT NULL DEFAULT 'disponible' CHECK (statut IN ('disponible','sous_offre','vendu','retire')),

    url_annonce TEXT,
    date_maj TIMESTAMP WITH TIME ZONE,

    prix INTEGER,
    charges INTEGER,
    tax_year INTEGER,

    surface_m2 NUMERIC,
    pieces INTEGER,
    chambres INTEGER,
    floor INTEGER,
    elevator BOOLEAN,

    ville TEXT,
    code_postal VARCHAR(10),
    country TEXT,
    lat NUMERIC,
    lon NUMERIC,

    flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    title TEXT,
    description TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    photos_urls TEXT[] NOT NULL DEFAULT '{}',

    last_import_run_id UUID REFERENCES catalog_import_runs(id) ON DELETE SET NULL,
    search_tsv tsvector,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id_unique)
);

CREATE INDEX IF NOT EXISTS idx_catalog_properties_tenant_statut ON catalog_properties (tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_tenant_city ON catalog_properties (tenant_id, ville);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_tenant_postcode ON catalog_properties (tenant_id, code_postal);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_tenant_price ON catalog_properties (tenant_id, prix);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_tenant_date_maj ON catalog_properties (tenant_id, date_maj DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_search_tsv ON catalog_properties USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_catalog_properties_flags ON catalog_properties USING GIN (flags);

-- ── Per-tenant configuration overrides (Command Center, Phase 2 Option B) ──
-- Effective config = global AgentConfig (.env) + this tenant's partial override.
-- overrides JSONB only ever holds NON-SECRET fields (branding + personality).
CREATE TABLE IF NOT EXISTS tenant_configs (
    tenant_id VARCHAR(100) PRIMARY KEY,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(120)
);

-- Append-only history of overrides for audit + rollback.
CREATE TABLE IF NOT EXISTS tenant_config_versions (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(120)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_versions_tenant_created ON tenant_config_versions (tenant_id, created_at DESC);
`;

export async function ensureDbSchema(): Promise<void> {
    await pool.query(ENSURE_DB_SQL);
}
