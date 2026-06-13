// ============================================================================
// Production Readiness Gate — Hard validation before production deployment
// ============================================================================
// A build is ONLY marked READY FOR PRODUCTION if ALL blocking checks pass.
// WARNING checks are logged but do not block deployment.
// FAILURE checks block deployment. No exceptions.
//
// CHECK 15 (Catalog Data): When RAG + XML are enabled, verifies that
// catalog_properties has at least 1 row. Empty catalog = hallucination risk.
// ============================================================================

import type {
  AgentConfig,
  ReadinessReport,
  ReadinessCheck,
  ReadinessLevel,
} from "./types";
import { pool } from "../db/pool";

// ── Run All Readiness Checks ───────────────────────────────────────────────

export async function runReadinessChecks(
  config: AgentConfig,
): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];

  // ── 1. Database Connection ─────────────────────────────────────
  checks.push(await checkDatabaseConnection(config));

  // ── 2. LLM Provider Configured ─────────────────────────────────
  checks.push(checkLlmConfiguration(config));

  // ── 3. CRM Provider Configured ─────────────────────────────────
  checks.push(checkCrmConfiguration(config));

  // ── 4. CRM Strict Mode ─────────────────────────────────────────
  checks.push(checkCrmStrictMode(config));

  // ── 5. CRM Read-After-Write ────────────────────────────────────
  checks.push(checkReadAfterWrite(config));

  // ── 6. Identity Strategy ───────────────────────────────────────
  checks.push(checkIdentityStrategy(config));

  // ── 7. Security Config ─────────────────────────────────────────
  checks.push(checkSecurityConfig(config));

  // ── 8. Agent Identity ──────────────────────────────────────────
  checks.push(checkAgentIdentity(config));

  // ── 9. Knowledge Base ──────────────────────────────────────────
  checks.push(checkKnowledgeBase(config));

  // ── 10. Custom Fields Policy ───────────────────────────────────
  checks.push(checkCustomFieldsPolicy(config));

  // ── 11. Duplicate Strategy ─────────────────────────────────────
  checks.push(checkDuplicateStrategy(config));

  // ── 12. Error Handling Strategy ────────────────────────────────
  checks.push(checkErrorStrategy(config));

  // ── 13. RAG Configuration ───────────────────────────────────────
  checks.push(checkRagConfig(config));

  // ── 14. Kill Switch ─────────────────────────────────────────────
  checks.push(checkKillSwitch(config));

  // ── 15. Catalog Data Presence (RAG + XML) ───────────────────────
  checks.push(await checkCatalogDataPresence(config));

  // Compute final level
  const blockers = checks
    .filter((c) => c.status === "fail" && c.blocking)
    .map((c) => c.message);
  let warnings = checks
    .filter((c) => c.status === "warn")
    .map((c) => c.message);

  // FACTORY_BUILD_STRICT: if enabled, ALL warnings become blockers
  if (config.factory?.buildStrict) {
    const warningChecks = checks.filter((c) => c.status === "warn");
    for (const wc of warningChecks) {
      blockers.push(`[STRICT] ${wc.message}`);
    }
    warnings = [];
  }

  let level: ReadinessLevel = "READY";
  if (blockers.length > 0) level = "BLOCKED";
  else if (warnings.length > 0) level = "WARNING";

  return {
    level,
    checks,
    blockers,
    warnings,
    timestamp: new Date().toISOString(),
  };
}

// ── Individual Checks ──────────────────────────────────────────────────────

async function checkDatabaseConnection(
  config: AgentConfig,
): Promise<ReadinessCheck> {
  try {
    const result = await pool.query("SELECT 1 as ok");
    if (result.rows[0]?.ok === 1) {
      return {
        name: "Database Connection",
        status: "pass",
        message: "PostgreSQL connection verified",
        blocking: true,
      };
    }
    return {
      name: "Database Connection",
      status: "fail",
      message: "Database query returned unexpected result",
      blocking: true,
    };
  } catch (err: any) {
    return {
      name: "Database Connection",
      status: "fail",
      message: `Database unreachable: ${err.message}`,
      blocking: true,
    };
  }
}

function checkLlmConfiguration(config: AgentConfig): ReadinessCheck {
  if (config.llm.provider === "groq") {
    const keyCount = config.llm.groq?.apiKeys?.length ?? 0;
    if (keyCount === 0) {
      return {
        name: "LLM Provider",
        status: "fail",
        message: "No Groq API keys configured",
        blocking: true,
      };
    }
    if (keyCount < 2) {
      return {
        name: "LLM Provider",
        status: "warn",
        message: "Only 1 Groq API key — no rotation fallback available",
        blocking: false,
      };
    }
    return {
      name: "LLM Provider",
      status: "pass",
      message: `Groq configured with ${keyCount} API key(s)`,
      blocking: true,
    };
  }

  if (config.llm.provider === "openrouter") {
    if (!config.llm.openrouter?.apiKey) {
      return {
        name: "LLM Provider",
        status: "fail",
        message: "OpenRouter API key missing",
        blocking: true,
      };
    }
    return {
      name: "LLM Provider",
      status: "pass",
      message: "OpenRouter configured",
      blocking: true,
    };
  }

  return {
    name: "LLM Provider",
    status: "fail",
    message: `Unknown LLM provider: ${config.llm.provider}`,
    blocking: true,
  };
}

function checkCrmConfiguration(config: AgentConfig): ReadinessCheck {
  if (config.crm.provider === "none") {
    return {
      name: "CRM Provider",
      status: "warn",
      message: "CRM is disabled (provider=none) — leads will not be synced",
      blocking: false,
    };
  }

  if (config.crm.provider === "twenty") {
    if (!config.crm.twenty?.apiUrl || !config.crm.twenty?.apiKey) {
      return {
        name: "CRM Provider",
        status: "fail",
        message: "Twenty CRM: API URL or API Key missing",
        blocking: true,
      };
    }
    return {
      name: "CRM Provider",
      status: "pass",
      message: `Twenty CRM configured (${config.crm.twenty.apiUrl})`,
      blocking: true,
    };
  }

  if (config.crm.provider === "airtable") {
    if (!config.crm.airtable?.webhookUrl) {
      return {
        name: "CRM Provider",
        status: "fail",
        message: "Airtable: webhook URL missing",
        blocking: true,
      };
    }
    return {
      name: "CRM Provider",
      status: "pass",
      message: "Airtable configured",
      blocking: true,
    };
  }

  return {
    name: "CRM Provider",
    status: "fail",
    message: `Unknown CRM provider: ${config.crm.provider}`,
    blocking: true,
  };
}

function checkCrmStrictMode(config: AgentConfig): ReadinessCheck {
  if (config.crm.provider === "none") {
    return {
      name: "CRM Strict Mode",
      status: "pass",
      message: "N/A (CRM disabled)",
      blocking: false,
    };
  }

  if (!config.crm.strict.requireId) {
    return {
      name: "CRM Strict Mode",
      status: "warn",
      message:
        "CRM_STRICT_REQUIRE_ID=false — personId not required (production risk)",
      blocking: false,
    };
  }

  return {
    name: "CRM Strict Mode",
    status: "pass",
    message: "Strict mode: requireId=true",
    blocking: false,
  };
}

function checkReadAfterWrite(config: AgentConfig): ReadinessCheck {
  if (config.crm.provider === "none") {
    return {
      name: "Read-After-Write",
      status: "pass",
      message: "N/A (CRM disabled)",
      blocking: false,
    };
  }

  if (!config.crm.strict.verifyWrite) {
    return {
      name: "Read-After-Write",
      status: "warn",
      message: "CRM_STRICT_VERIFY_WRITE=false — write verification disabled",
      blocking: false,
    };
  }

  return {
    name: "Read-After-Write",
    status: "pass",
    message: "Read-after-write verification enabled",
    blocking: false,
  };
}

function checkIdentityStrategy(config: AgentConfig): ReadinessCheck {
  const validKeys = ["phone", "email", "externalid"];
  if (!validKeys.includes(config.crm.identityKey)) {
    return {
      name: "Identity Strategy",
      status: "fail",
      message: `Invalid identity key: ${config.crm.identityKey}`,
      blocking: true,
    };
  }

  if (config.crm.identityKey === "email") {
    return {
      name: "Identity Strategy",
      status: "warn",
      message:
        "Identity key is email — phone-first is recommended for French real estate",
      blocking: false,
    };
  }

  return {
    name: "Identity Strategy",
    status: "pass",
    message: `Identity key: ${config.crm.identityKey}`,
    blocking: false,
  };
}

function checkSecurityConfig(config: AgentConfig): ReadinessCheck {
  if (config.security.allowedOrigins.length === 0) {
    return {
      name: "Security Config",
      status: "warn",
      message: "No allowed origins configured — CORS may block requests",
      blocking: false,
    };
  }

  if (config.security.jwtTtlSeconds > 86400) {
    return {
      name: "Security Config",
      status: "warn",
      message: "JWT TTL > 24h — consider reducing for security",
      blocking: false,
    };
  }

  return {
    name: "Security Config",
    status: "pass",
    message: `JWT (${config.security.jwtAlg}), ${config.security.allowedOrigins.length} origin(s), TTL=${config.security.jwtTtlSeconds}s`,
    blocking: false,
  };
}

function checkAgentIdentity(config: AgentConfig): ReadinessCheck {
  if (!config.branding.agentName || !config.branding.agencyName) {
    return {
      name: "Agent Identity",
      status: "fail",
      message: "Agent name or agency name is missing",
      blocking: true,
    };
  }

  return {
    name: "Agent Identity",
    status: "pass",
    message: `Agent: ${config.branding.agentName} | Agency: ${config.branding.agencyName}`,
    blocking: true,
  };
}

function checkKnowledgeBase(config: AgentConfig): ReadinessCheck {
  if (config.knowledge.urls.length === 0) {
    return {
      name: "Knowledge Base",
      status: "warn",
      message: "No knowledge base URLs configured — RAG will only use catalog",
      blocking: false,
    };
  }

  return {
    name: "Knowledge Base",
    status: "pass",
    message: `${config.knowledge.urls.length} knowledge URL(s) configured`,
    blocking: false,
  };
}

function checkCustomFieldsPolicy(config: AgentConfig): ReadinessCheck {
  if (config.crm.provider === "twenty" && config.crm.twenty?.customFields) {
    if (config.crm.strict.customFields) {
      return {
        name: "Custom Fields Policy",
        status: "pass",
        message: "Twenty custom fields enabled with strict enforcement",
        blocking: false,
      };
    }
    return {
      name: "Custom Fields Policy",
      status: "warn",
      message:
        "Twenty custom fields enabled but not strictly enforced — may silently skip",
      blocking: false,
    };
  }

  return {
    name: "Custom Fields Policy",
    status: "pass",
    message: "Custom fields: N/A or disabled",
    blocking: false,
  };
}

function checkDuplicateStrategy(config: AgentConfig): ReadinessCheck {
  if (config.crm.duplicateStrategy === "create_always") {
    return {
      name: "Duplicate Strategy",
      status: "warn",
      message: "Strategy is create_always — will create duplicates in CRM",
      blocking: false,
    };
  }

  if (config.crm.duplicateStrategy === "fail") {
    return {
      name: "Duplicate Strategy",
      status: "warn",
      message: "Strategy is fail — existing contacts will cause push failures",
      blocking: false,
    };
  }

  return {
    name: "Duplicate Strategy",
    status: "pass",
    message: `Duplicate strategy: ${config.crm.duplicateStrategy}`,
    blocking: false,
  };
}

function checkErrorStrategy(config: AgentConfig): ReadinessCheck {
  if (config.crm.errorMode === "permissive") {
    return {
      name: "Error Handling",
      status: "warn",
      message:
        "Error mode is permissive — errors will be queued, not fail immediately",
      blocking: false,
    };
  }

  return {
    name: "Error Handling",
    status: "pass",
    message: "Error mode: strict (fail-fast)",
    blocking: false,
  };
}

function checkRagConfig(config: AgentConfig): ReadinessCheck {
  if (!config.rag?.enabled) {
    return {
      name: "RAG System",
      status: "warn",
      message: "RAG is disabled — agent will not use knowledge retrieval",
      blocking: false,
    };
  }

  if (config.rag.minConfidence < 0 || config.rag.minConfidence > 1) {
    return {
      name: "RAG System",
      status: "fail",
      message: `RAG_MIN_CONFIDENCE=${config.rag.minConfidence} is invalid (must be 0.0-1.0)`,
      blocking: true,
    };
  }

  return {
    name: "RAG System",
    status: "pass",
    message: `RAG enabled (minConfidence=${config.rag.minConfidence}, forceOnIntent=${config.rag.forceLookupOnIntent})`,
    blocking: false,
  };
}

function checkKillSwitch(config: AgentConfig): ReadinessCheck {
  if (config.factory?.agentKillSwitch) {
    return {
      name: "Kill Switch",
      status: "fail",
      message:
        "FACTORY_AGENT_KILL_SWITCH=true — ALL agent responses are disabled",
      blocking: true,
    };
  }

  return {
    name: "Kill Switch",
    status: "pass",
    message: "Kill switch: OFF",
    blocking: true,
  };
}

// ── 15. Catalog Data Presence ──────────────────────────────────────────────
// When RAG is enabled AND XML knowledge ingestion is enabled, the catalog
// MUST contain at least one property. An empty catalog with RAG active
// means the agent will hallucinate answers instead of using real data.

async function checkCatalogDataPresence(
  config: AgentConfig,
): Promise<ReadinessCheck> {
  // Only relevant when both RAG and XML knowledge are enabled
  if (!config.rag?.enabled) {
    return {
      name: "Catalog Data",
      status: "pass",
      message: "RAG disabled — catalog data check skipped",
      blocking: false,
    };
  }

  if (!config.knowledge?.xmlEnabled) {
    return {
      name: "Catalog Data",
      status: "pass",
      message: "XML knowledge disabled — catalog data check skipped",
      blocking: false,
    };
  }

  // RAG + XML both enabled → verify catalog has data
  try {
    // Determine tenant_id from widget tenant map (use 'default' as fallback)
    const tenantMap = config.security?.widgetTenantMap || {};
    const tenantId = tenantMap["default"] || "default";

    const result = await pool.query(
      "SELECT COUNT(*)::int as count FROM catalog_properties WHERE tenant_id = $1",
      [tenantId],
    );
    const count = result.rows[0]?.count ?? 0;

    if (count === 0) {
      return {
        name: "Catalog Data",
        status: "warn",
        message: `RAG enabled + XML enabled but catalog has 0 properties (tenant=${tenantId}). Import XML via Factory or /admin to populate catalog.`,
        blocking: false,
      };
    }

    return {
      name: "Catalog Data",
      status: "pass",
      message: `Catalog contains ${count} properties (tenant=${tenantId})`,
      blocking: false,
    };
  } catch (err: any) {
    return {
      name: "Catalog Data",
      status: "warn",
      message: `Could not verify catalog data: ${err.message}`,
      blocking: false,
    };
  }
}
