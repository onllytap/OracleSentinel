-- Migration 002: Factory Builds History Table
-- Stores build pipeline execution history for audit and monitoring

CREATE TABLE IF NOT EXISTS factory_builds (
  id SERIAL PRIMARY KEY,
  build_id VARCHAR(50) UNIQUE NOT NULL,
  agent_name VARCHAR(200),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure', 'partial')),
  production_ready BOOLEAN DEFAULT false,
  config_version VARCHAR(20),
  steps JSONB,
  warnings TEXT[],
  errors TEXT[],
  audit_log JSONB,
  duration_ms INTEGER,
  crm_provider VARCHAR(50),
  llm_provider VARCHAR(50),
  build_strict BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for querying recent builds
CREATE INDEX IF NOT EXISTS idx_factory_builds_created_at ON factory_builds(created_at DESC);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_factory_builds_status ON factory_builds(status);

-- Index for searching by agent name
CREATE INDEX IF NOT EXISTS idx_factory_builds_agent_name ON factory_builds(agent_name);

-- Add comment for documentation
COMMENT ON TABLE factory_builds IS 'Factory build pipeline execution history with full audit trail';
