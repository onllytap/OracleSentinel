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

-- ── Admin passkeys (WebAuthn / FIDO2) for the Command Center login ─────────
-- Passwordless login for the QG. ADMIN_API_KEY remains the break-glass
-- fallback. We store ONLY public material (COSE public key + metadata) — never
-- a secret. credential_id and public_key are base64url strings.
CREATE TABLE IF NOT EXISTS admin_passkeys (
    credential_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] NOT NULL DEFAULT '{}',
    device_type VARCHAR(32),
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    label VARCHAR(120),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_created ON admin_passkeys (created_at DESC);

-- ── Clients / CRM (Command Center) ─────────────────────────────────────────
-- End customers ("clients") managed by the super-admin QG, with French legal
-- info (legal name, SIREN, VAT, DPA...). No secrets are stored here.
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  company VARCHAR(160),
  email VARCHAR(200),
  phone VARCHAR(60),
  legal_name VARCHAR(200),
  siren VARCHAR(20),
  vat_number VARCHAR(30),
  address TEXT,
  contract_ref VARCHAR(120),
  dpa_signed BOOLEAN NOT NULL DEFAULT FALSE,
  documents_url TEXT,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Which chatbot (tenant) belongs to which client. A tenant has a single owner
-- (enforced in the service layer); a client can own many tenants.
CREATE TABLE IF NOT EXISTS client_tenants (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tenant_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (client_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_client_tenants_tenant ON client_tenants (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- v2.1 — Command Center plateforme multi-agences (R17/R18/R19 + R3/R4 + R11–R14)
-- Tables ADDITIVES, idempotentes, créées AU BOOT (jamais en lazy). Aucun secret
-- en clair : les credentials CRM et le secret TOTP sont chiffrés (utils/crypto).
-- ════════════════════════════════════════════════════════════════════════════

-- Registre des agences provisionnées (R19). Les tenants "historiques" (sans
-- ligne ici) restent servis normalement — la garde de service est fail-open.
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id  VARCHAR(100) PRIMARY KEY,
    name       VARCHAR(160) NOT NULL,
    widget_id  VARCHAR(128) UNIQUE NOT NULL,
    status     VARCHAR(20)  NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','suspended','archived')),
    plan       VARCHAR(20)  NOT NULL DEFAULT 'starter',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

-- Config CRM par agence (R17). config_encrypted = encryptJson(secrets) — JAMAIS
-- en clair, JAMAIS renvoyé par une API. field_mappings = canonique -> provider.
CREATE TABLE IF NOT EXISTS tenant_crm_configs (
    tenant_id        VARCHAR(100) PRIMARY KEY,
    provider         VARCHAR(20) NOT NULL DEFAULT 'none'
                     CHECK (provider IN ('none','twenty','airtable','webhook')),
    enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    config_encrypted TEXT,
    field_mappings   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by       VARCHAR(120)
);

-- Abonnements Stripe par agence (R18). Aucune clé secrète stockée ici.
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    tenant_id              VARCHAR(100) PRIMARY KEY,
    stripe_customer_id     VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    plan                   VARCHAR(20) NOT NULL DEFAULT 'starter',
    status                 VARCHAR(30) NOT NULL DEFAULT 'none',
    current_period_end     TIMESTAMP WITH TIME ZONE,
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Métering d'usage (R18). Append-only ; alimenté seulement si BILLING_ENABLED.
CREATE TABLE IF NOT EXISTS usage_events (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  VARCHAR(100) NOT NULL,
    kind       VARCHAR(20)  NOT NULL,   -- message | lead | conversation
    qty        INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created ON usage_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_kind_created ON usage_events (tenant_id, kind, created_at DESC);

-- Journal d'audit append-only (R5). meta est filtrée PII/secret côté service.
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor       VARCHAR(160),
    action      VARCHAR(80) NOT NULL,
    target_type VARCHAR(60),
    target_id   VARCHAR(160),
    meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);

-- ── Tables auto-gérées, créées AU BOOT (jamais en lazy pendant une requête) ──

-- Secret TOTP du super-admin (R11–R14). secret_encrypted = encryptSecret(...).
-- Ligne unique (id=1). Le secret n'est JAMAIS renvoyé après activation.
CREATE TABLE IF NOT EXISTS admin_totp (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    secret_encrypted TEXT NOT NULL,
    activated        BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    activated_at     TIMESTAMP WITH TIME ZONE
);

-- Codes de récupération TOTP à usage unique (R14). Stockés HACHÉS (sha256).
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
    id         BIGSERIAL PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at    TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_used ON admin_recovery_codes (used);

-- État de redéploiement par agence (R3/R4). single-flight + rollback côté service.
CREATE TABLE IF NOT EXISTS tenant_redeploys (
    tenant_id      VARCHAR(100) PRIMARY KEY,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','in_progress','succeeded','failed','rolled_back')),
    config_version BIGINT,
    active_version BIGINT,
    started_at     TIMESTAMP WITH TIME ZONE,
    finished_at    TIMESTAMP WITH TIME ZONE,
    error          TEXT,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dédup des pushs CRM (déjà créée en lazy par AirtableConnector). On la matérialise
-- AU BOOT (idempotent, schéma identique) pour éviter toute race en première requête.
CREATE TABLE IF NOT EXISTS crm_pushed_leads (
    phone      VARCHAR(50) PRIMARY KEY,
    provider   VARCHAR(20) NOT NULL DEFAULT 'airtable',
    session_id VARCHAR(255),
    record_id  VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_pushed_leads_created ON crm_pushed_leads (created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- Module "machine à mandats" — données DVF (ventes réelles notaires, open data).
-- Table ADDITIVE, idempotente, au boot. Aucune donnée perso : ce sont des
-- transactions foncières publiques (data.gouv geo-dvf). Sert au moteur
-- d'estimation (fourchette indicative par commune/type de bien).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS dvf_sales (
    id                        BIGSERIAL PRIMARY KEY,
    id_mutation               VARCHAR(64),
    date_mutation             DATE,
    valeur_fonciere           NUMERIC,
    code_postal               VARCHAR(10),
    code_commune              VARCHAR(10),
    commune                   TEXT,
    type_local                VARCHAR(40),   -- 'Maison' | 'Appartement' | 'Local' ...
    surface_reelle_bati       NUMERIC,
    nombre_pieces_principales INTEGER,
    longitude                 NUMERIC,
    latitude                  NUMERIC,
    created_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dvf_sales_commune_type ON dvf_sales (code_commune, type_local);
CREATE INDEX IF NOT EXISTS idx_dvf_sales_postal_type ON dvf_sales (code_postal, type_local);
CREATE INDEX IF NOT EXISTS idx_dvf_sales_geo ON dvf_sales (latitude, longitude);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dvf_sales_dedup ON dvf_sales (id_mutation, code_commune, surface_reelle_bati, valeur_fonciere);

-- Captures "vendeur/mandat" : un propriétaire a demandé une estimation. On stocke
-- le contact + le résultat (fourchette + DPE) pour alerter/recontacter l'agence.
-- Pas de secret. tenant_id rattache la capture à l'agence propriétaire.
CREATE TABLE IF NOT EXISTS estimation_leads (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     VARCHAR(100) NOT NULL DEFAULT 'default',
    prenom        VARCHAR(120),
    nom           VARCHAR(120),
    telephone     VARCHAR(50),
    email         VARCHAR(200),
    address       TEXT,
    code_commune  VARCHAR(10),
    code_postal   VARCHAR(10),
    type_local    VARCHAR(40),
    surface       NUMERIC,
    pieces        INTEGER,
    etat          VARCHAR(40),
    timeline      VARCHAR(60),
    estimate_low  INTEGER,
    estimate_mid  INTEGER,
    estimate_high INTEGER,
    price_per_m2  INTEGER,
    dpe           VARCHAR(4),
    confidence    VARCHAR(10),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estimation_leads_tenant_created ON estimation_leads (tenant_id, created_at DESC);
`;

export async function ensureDbSchema(): Promise<void> {
    await pool.query(ENSURE_DB_SQL);
}
