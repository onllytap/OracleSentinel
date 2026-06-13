import fs from 'fs';
import path from 'path';
import { pool } from '../src/db/pool';

const EXTRA_TABLES_SQL = `
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
`;

async function initDb() {
    try {
        const schemaPath = path.join(__dirname, '../src/db/schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema.sql...');
        await pool.query(schemaSql);

        console.log('Creating additional tables...');
        await pool.query(EXTRA_TABLES_SQL);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await pool.end();
    }
}

initDb();
