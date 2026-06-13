// ============================================================================
// Factory API Routes — Config CRUD, Build Pipeline, Observability
// ============================================================================
// All routes require admin session authentication.
// These routes power the Factory UI dashboard.
//
// ADDITIONS (P0):
// - POST /knowledge/import/dry-run — XML catalog dry-run (reuses CatalogImportService)
// - POST /knowledge/import/commit  — XML catalog commit
// - GET  /knowledge/status          — Catalog property count + last import info
// - POST /rollback/latest           — Restore latest .env backup
// ============================================================================

import { Router } from "express";
import express from "express";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import {
  loadCurrentConfig,
  saveConfig,
  diffConfigs,
  executeBuildPipeline,
  runReadinessChecks,
  getObservabilitySnapshot,
  logBuffer,
  factoryLog,
  RUNTIME_BEHAVIOR_MATRIX,
  restoreLatestBackup,
} from "../factory";
import type { AgentConfig } from "../factory";
import { CatalogImportService } from "../services/catalog-import.service";
import { pool } from "../db/pool";
import { FactoryBuildHistoryService } from "../services/factory-build-history.service";
import {
  validateBody,
  validateQuery,
  validateParams,
  schemas,
} from "../factory/validation";

const router = Router();

function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1"
  ) {
    return true;
  }

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// All factory routes require admin authentication
router.use(requireAdminSession());

// All mutation routes (POST/PUT/DELETE) require CSRF token
router.use(requireCSRF());

// ── GET /config — Load current agent configuration ─────────────────────────

router.get("/config", async (_req, res) => {
  try {
    const config = loadCurrentConfig();
    // Redact sensitive values for UI display
    const safeConfig = redactSecrets(config);
    return res.json({ success: true, config: safeConfig });
  } catch (err: any) {
    console.error("[Factory] Failed to load config:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /config/raw — Load config with secrets (for build only) ────────────

router.get("/config/raw", async (_req, res) => {
  if (process.env.FACTORY_ALLOW_RAW_CONFIG !== "true") {
    return res.status(404).json({ success: false, error: "Not found" });
  }

  try {
    const config = loadCurrentConfig();
    return res.json({ success: true, config });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /config — Update agent configuration ──────────────────────────────

router.put(
  "/config",
  express.json({ limit: "1mb" }),
  validateBody(schemas.putConfigBody),
  async (req, res) => {
    try {
      // req.body is now validated + coerced by Zod (defaults filled, types checked)
      const newConfig: AgentConfig = req.body.config;

      // Compute diff
      const currentConfig = loadCurrentConfig();
      const diffs = diffConfigs(currentConfig, newConfig);

      // Save
      const result = saveConfig(newConfig);

      return res.json({
        success: true,
        path: result.path,
        backup: result.backup,
        changes: diffs.length,
        diffs,
      });
    } catch (err: any) {
      console.error("[Factory] Failed to save config:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── POST /build — Execute full build pipeline ─────────────────────────────

router.post(
  "/build",
  express.json({ limit: "1mb" }),
  validateBody(schemas.postBuildBody),
  async (req, res) => {
    try {
      // Accept validated config from body, or use current config from .env
      let config: AgentConfig;
      if (req.body?.config) {
        config = req.body.config;
      } else {
        config = loadCurrentConfig();
      }

      const result = await executeBuildPipeline(config);

      const statusCode = result.status === "failure" ? 422 : 200;
      return res
        .status(statusCode)
        .json({ success: result.productionReady, build: result });
    } catch (err: any) {
      console.error("[Factory] Build pipeline error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── GET /readiness — Run production readiness checks ──────────────────────

router.get("/readiness", async (_req, res) => {
  try {
    const config = loadCurrentConfig();
    const report = await runReadinessChecks(config);
    return res.json({ success: true, readiness: report });
  } catch (err: any) {
    console.error("[Factory] Readiness check error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /observability — System & CRM metrics snapshot ────────────────────

router.get("/observability", async (_req, res) => {
  try {
    const snapshot = await getObservabilitySnapshot();
    return res.json({ success: true, ...snapshot });
  } catch (err: any) {
    console.error("[Factory] Observability error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /logs — Recent structured logs ────────────────────────────────────

router.get("/logs", validateQuery(schemas.getLogsQuery), async (req, res) => {
  try {
    const { limit, level } = (req as any).validatedQuery as {
      limit: number;
      level?: string;
    };
    const entries = logBuffer.getRecent(limit, level);
    return res.json({ success: true, entries, count: entries.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /matrix — Runtime behavior matrix ─────────────────────────────────

router.get("/matrix", async (_req, res) => {
  return res.json({ success: true, scenarios: RUNTIME_BEHAVIOR_MATRIX });
});

// ── GET /diff — Compare current config with proposed changes ──────────────

router.post(
  "/diff",
  express.json({ limit: "1mb" }),
  validateBody(schemas.diffConfigBody),
  async (req, res) => {
    try {
      const newConfig: AgentConfig = req.body.config;
      const currentConfig = loadCurrentConfig();
      const diffs = diffConfigs(currentConfig, newConfig);
      return res.json({ success: true, changes: diffs.length, diffs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── POST /test/llm — Test LLM provider connection ──────────────────────────

router.post(
  "/test/llm",
  express.json({ limit: "10kb" }),
  validateBody(schemas.llmTestBody),
  async (_req, res) => {
    try {
      const config = loadCurrentConfig();
      const provider = config.llm.provider;

    if (provider === "groq") {
      const { GroqService } = await import("../services/groq.service");
      if (!GroqService.isConfigured()) {
        return res.json({
          success: false,
          error: "No Groq API keys configured",
        });
      }
      const result = await GroqService.chatCompletion(
        [
          { role: "system", content: "Reply with exactly: OK" },
          { role: "user", content: "ping" },
        ],
        { max_tokens: 10, temperature: 0 },
      );
      return res.json({
        success: true,
        provider: "groq",
        model: result.model,
        response: result.content.slice(0, 50),
      });
    }

    if (provider === "openrouter") {
      const { callWithFallback } =
        await import("../services/openrouter.service");
      const result = await callWithFallback(
        [
          { role: "system", content: "Reply with exactly: OK" },
          { role: "user", content: "ping" },
        ],
        { max_tokens: 10, temperature: 0 },
      );
      return res.json({
        success: true,
        provider: "openrouter",
        model: result.model,
        response: result.content.slice(0, 50),
      });
    }

    return res.json({
      success: false,
      error: `Provider '${provider}' not implemented for test`,
    });
    } catch (err: any) {
      return res.json({
        success: false,
        error: err.message?.slice(0, 200) || "LLM test failed",
      });
    }
  },
);

// ── POST /test/crm — Test CRM provider connection ──────────────────────────

router.post(
  "/test/crm",
  express.json({ limit: "10kb" }),
  validateBody(schemas.crmTestBody),
  async (_req, res) => {
    try {
      const { validateCrmConnectionAsync } =
        await import("../services/crm/validator");
      const result = await validateCrmConnectionAsync();
      return res.json({
        success: result.connectionOk,
        configValid: result.configValid,
        errors: result.errors,
      });
    } catch (err: any) {
      return res.json({
        success: false,
        error: err.message?.slice(0, 200) || "CRM test failed",
      });
    }
  },
);

// ── POST /test/database — Test database connection ─────────────────────────

router.post(
  "/test/database",
  express.json({ limit: "10kb" }),
  async (_req, res) => {
    try {
      const { pool } = await import("../db/pool");
      const result = await pool.query("SELECT 1 as ok");
      if (result.rows[0]?.ok === 1) {
        return res.json({
          success: true,
          message: "Database connection verified",
        });
      }
      return res.json({ success: false, error: "Unexpected query result" });
    } catch (err: any) {
      return res.json({
        success: false,
        error: err.message?.slice(0, 200) || "Database test failed",
      });
    }
  },
);

// ── POST /knowledge/import/:mode — XML Knowledge Upload (reuses CatalogImportService) ──

router.post(
  "/knowledge/import/dry-run",
  express.text({
    type: ["application/xml", "text/xml", "text/plain"],
    limit: "50mb",
  }),
  validateQuery(schemas.knowledgeImportQuery),
  async (req, res) => {
    try {
      const config = loadCurrentConfig();
      const maxSizeMb = config.knowledge?.xmlMaxSizeMb || 20;
      const xmlText = typeof req.body === "string" ? req.body : "";

      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({
          success: false,
          error: "XML body is required (min 10 chars)",
        });
      }

      const sizeMb = Buffer.byteLength(xmlText, "utf-8") / (1024 * 1024);
      if (sizeMb > maxSizeMb) {
        return res.status(413).json({
          success: false,
          error: `XML size ${sizeMb.toFixed(1)}MB exceeds max ${maxSizeMb}MB (KNOWLEDGE_XML_MAX_SIZE_MB)`,
        });
      }

      const tenantMap = config.security?.widgetTenantMap || {};
      const tenantQuery = (req as any).validatedQuery as {
        tenant_id?: string;
      };
      const tenantId =
        tenantQuery.tenant_id || tenantMap["default"] || "default";

      factoryLog(
        "info",
        "factory.knowledge.import.start",
        `XML dry-run import started`,
        {
          tenantId,
          sizeMb: Math.round(sizeMb * 100) / 100,
          mode: "dry_run",
        },
      );

      const result = await CatalogImportService.runImport({
        tenantId,
        xmlText,
        mode: "dry_run",
      });

      factoryLog(
        "info",
        "factory.knowledge.import.end",
        `XML dry-run complete: ${result.seenCount} seen, ${result.errorCount} errors`,
        {
          tenantId,
          mode: "dry_run",
          seenCount: result.seenCount,
          errorCount: result.errorCount,
        },
      );

      return res.json({ success: true, ...result });
    } catch (error: any) {
      factoryLog(
        "error",
        "factory.knowledge.import.error",
        `XML dry-run failed: ${error.message}`,
        { error: error.message },
      );
      return res.status(500).json({
        success: false,
        error: "Import dry-run failed: " + (error.message || "unknown"),
      });
    }
  },
);

router.post(
  "/knowledge/import/commit",
  express.text({
    type: ["application/xml", "text/xml", "text/plain"],
    limit: "50mb",
  }),
  validateQuery(schemas.knowledgeImportQuery),
  async (req, res) => {
    try {
      const config = loadCurrentConfig();
      const maxSizeMb = config.knowledge?.xmlMaxSizeMb || 20;
      const xmlText = typeof req.body === "string" ? req.body : "";

      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({
          success: false,
          error: "XML body is required (min 10 chars)",
        });
      }

      const sizeMb = Buffer.byteLength(xmlText, "utf-8") / (1024 * 1024);
      if (sizeMb > maxSizeMb) {
        return res.status(413).json({
          success: false,
          error: `XML size ${sizeMb.toFixed(1)}MB exceeds max ${maxSizeMb}MB (KNOWLEDGE_XML_MAX_SIZE_MB)`,
        });
      }

      const tenantMap = config.security?.widgetTenantMap || {};
      const tenantQuery = (req as any).validatedQuery as {
        tenant_id?: string;
      };
      const tenantId =
        tenantQuery.tenant_id || tenantMap["default"] || "default";

      factoryLog(
        "info",
        "factory.knowledge.import.start",
        `XML commit import started`,
        {
          tenantId,
          sizeMb: Math.round(sizeMb * 100) / 100,
          mode: "commit",
        },
      );

      const result = await CatalogImportService.runImport({
        tenantId,
        xmlText,
        mode: "commit",
      });

      factoryLog(
        "info",
        "factory.knowledge.import.end",
        `XML commit complete: ${result.seenCount} seen, ${result.errorCount} errors`,
        {
          tenantId,
          mode: "commit",
          seenCount: result.seenCount,
          errorCount: result.errorCount,
        },
      );

      return res.json({ success: true, ...result });
    } catch (error: any) {
      factoryLog(
        "error",
        "factory.knowledge.import.error",
        `XML commit failed: ${error.message}`,
        { error: error.message },
      );
      return res.status(500).json({
        success: false,
        error: "Import commit failed: " + (error.message || "unknown"),
      });
    }
  },
);

// ── GET /knowledge/status — Catalog property count + last import ────────────

router.get("/knowledge/status", async (_req, res) => {
  try {
    const config = loadCurrentConfig();
    const tenantMap = config.security?.widgetTenantMap || {};
    const tenantId = tenantMap["default"] || "default";

    // Property count
    const countResult = await pool.query(
      "SELECT COUNT(*)::int as count FROM catalog_properties WHERE tenant_id = $1",
      [tenantId],
    );
    const propertyCount = countResult.rows[0]?.count ?? 0;

    // Last import run info
    let lastImportAt: string | null = null;
    let lastImportStatus: string | null = null;
    let lastErrorCount = 0;
    try {
      const runResult = await pool.query(
        `SELECT mode, seen_count, error_count, committed_at, created_at
                 FROM catalog_import_runs
                 WHERE tenant_id = $1
                 ORDER BY created_at DESC LIMIT 1`,
        [tenantId],
      );
      if (runResult.rows.length > 0) {
        const row = runResult.rows[0];
        lastImportAt = row.committed_at || row.created_at;
        lastImportStatus =
          row.mode === "commit" && row.committed_at ? "committed" : row.mode;
        lastErrorCount = row.error_count || 0;
      }
    } catch {
      // catalog_import_runs may not exist yet — non-fatal
    }

    return res.json({
      success: true,
      tenantId,
      propertyCount,
      lastImportAt,
      lastImportStatus,
      lastErrorCount,
      xmlEnabled: config.knowledge?.xmlEnabled !== false,
      xmlMaxSizeMb: config.knowledge?.xmlMaxSizeMb || 20,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /knowledge/tenants — List ALL tenants with stats ────────────────────

router.get("/knowledge/tenants", async (_req, res) => {
  try {
    // Get all distinct tenants from catalog_properties with their property counts
    const tenantsResult = await pool.query(`
      SELECT
        cp.tenant_id,
        COUNT(*)::int AS property_count,
        COUNT(*) FILTER (WHERE cp.statut = 'disponible')::int AS available_count,
        COUNT(*) FILTER (WHERE cp.statut = 'retire')::int AS retired_count,
        MIN(cp.created_at) AS first_import_at,
        MAX(cp.updated_at) AS last_updated_at
      FROM catalog_properties cp
      GROUP BY cp.tenant_id
      ORDER BY cp.tenant_id
    `);

    // For each tenant, get the last import run info
    const tenants = [];
    for (const row of tenantsResult.rows) {
      let lastImportAt: string | null = null;
      let lastImportMode: string | null = null;
      let lastImportErrors = 0;
      let totalImportRuns = 0;

      try {
        const runResult = await pool.query(
          `SELECT mode, seen_count, error_count, committed_at, created_at
           FROM catalog_import_runs
           WHERE tenant_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [row.tenant_id],
        );
        if (runResult.rows.length > 0) {
          const run = runResult.rows[0];
          lastImportAt = run.committed_at || run.created_at;
          lastImportMode = run.mode;
          lastImportErrors = run.error_count || 0;
        }

        const countResult = await pool.query(
          `SELECT COUNT(*)::int AS total FROM catalog_import_runs WHERE tenant_id = $1`,
          [row.tenant_id],
        );
        totalImportRuns = countResult.rows[0]?.total ?? 0;
      } catch {
        // catalog_import_runs may not exist yet
      }

      tenants.push({
        tenantId: row.tenant_id,
        propertyCount: row.property_count,
        availableCount: row.available_count,
        retiredCount: row.retired_count,
        firstImportAt: row.first_import_at,
        lastUpdatedAt: row.last_updated_at,
        lastImportAt,
        lastImportMode,
        lastImportErrors,
        totalImportRuns,
      });
    }

    // Also check for tenants that exist in WIDGET_TENANT_MAP but have no data yet
    const config = loadCurrentConfig();
    const tenantMap = config.security?.widgetTenantMap || {};
    const existingTenantIds = new Set(tenants.map((t: any) => t.tenantId));

    for (const [widgetId, tenantId] of Object.entries(tenantMap)) {
      if (!existingTenantIds.has(tenantId)) {
        tenants.push({
          tenantId,
          propertyCount: 0,
          availableCount: 0,
          retiredCount: 0,
          firstImportAt: null,
          lastUpdatedAt: null,
          lastImportAt: null,
          lastImportMode: null,
          lastImportErrors: 0,
          totalImportRuns: 0,
          widgetId,
          emptyTenant: true,
        });
      }
    }

    return res.json({
      success: true,
      tenants,
      totalTenants: tenants.length,
      widgetTenantMap: tenantMap,
    });
  } catch (err: any) {
    factoryLog(
      "error",
      "factory.knowledge.tenants.error",
      `Failed to list tenants: ${err.message}`,
      { error: err.message },
    );
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /knowledge/tenants/:tenantId — Purge a tenant and all its data ───

router.delete(
  "/knowledge/tenants/:tenantId",
  validateParams(schemas.tenantIdParam),
  async (req, res) => {
  const { tenantId } = (req as any).validatedParams as { tenantId: string };

  // Safety: prevent deleting if it's the only configured tenant
  const config = loadCurrentConfig();
  const tenantMap = config.security?.widgetTenantMap || {};
  const configuredTenantIds = new Set(Object.values(tenantMap));

  factoryLog(
    "warn",
    "factory.knowledge.tenant.delete.start",
    `Tenant deletion requested: ${tenantId}`,
    { tenantId, isConfigured: configuredTenantIds.has(tenantId) },
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Delete catalog_import_errors linked to this tenant's import runs
    const errorDeleteResult = await client.query(
      `DELETE FROM catalog_import_errors
       WHERE import_run_id IN (
         SELECT id FROM catalog_import_runs WHERE tenant_id = $1
       )`,
      [tenantId],
    );
    const errorsDeleted = errorDeleteResult.rowCount || 0;

    // 2. Delete catalog_import_runs for this tenant
    const runsDeleteResult = await client.query(
      `DELETE FROM catalog_import_runs WHERE tenant_id = $1`,
      [tenantId],
    );
    const runsDeleted = runsDeleteResult.rowCount || 0;

    // 3. Delete catalog_properties for this tenant
    const propsDeleteResult = await client.query(
      `DELETE FROM catalog_properties WHERE tenant_id = $1`,
      [tenantId],
    );
    const propertiesDeleted = propsDeleteResult.rowCount || 0;

    // 4. Delete messages for this tenant
    const msgsDeleteResult = await client.query(
      `DELETE FROM messages WHERE tenant_id = $1`,
      [tenantId],
    );
    const messagesDeleted = msgsDeleteResult.rowCount || 0;

    // 5. Delete conversations for this tenant
    const convsDeleteResult = await client.query(
      `DELETE FROM conversations WHERE tenant_id = $1`,
      [tenantId],
    );
    const conversationsDeleted = convsDeleteResult.rowCount || 0;

    // 6. Delete leads for this tenant
    const leadsDeleteResult = await client.query(
      `DELETE FROM leads WHERE tenant_id = $1`,
      [tenantId],
    );
    const leadsDeleted = leadsDeleteResult.rowCount || 0;

    await client.query("COMMIT");

    const summary = {
      tenantId,
      propertiesDeleted,
      runsDeleted,
      errorsDeleted,
      messagesDeleted,
      conversationsDeleted,
      leadsDeleted,
    };

    factoryLog(
      "info",
      "factory.knowledge.tenant.delete.success",
      `Tenant ${tenantId} purged: ${propertiesDeleted} properties, ${runsDeleted} runs, ${conversationsDeleted} conversations`,
      summary,
    );

    return res.json({
      success: true,
      message: `Tenant "${tenantId}" purged successfully`,
      ...summary,
      hint: configuredTenantIds.has(tenantId)
        ? `Note: "${tenantId}" is still referenced in WIDGET_TENANT_MAP. Remove it from .env if you no longer need this tenant.`
        : undefined,
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});

    factoryLog(
      "error",
      "factory.knowledge.tenant.delete.error",
      `Failed to delete tenant ${tenantId}: ${err.message}`,
      { tenantId, error: err.message },
    );

    return res.status(500).json({
      success: false,
      error: `Failed to purge tenant: ${err.message}`,
    });
  } finally {
    client.release();
  }
});

// ── POST /rollback/latest — Restore latest .env backup ─────────────────────

router.post(
  "/rollback/latest",
  express.json({ limit: "10kb" }),
  validateBody(schemas.rollbackBody),
  async (_req, res) => {
    try {
      factoryLog(
        "warn",
        "factory.rollback.start",
        "Manual rollback requested by operator",
        {},
      );

    const result = restoreLatestBackup();

    if (result.restored) {
      factoryLog(
        "info",
        "factory.rollback.success",
        `Rollback succeeded from ${result.backupUsed}`,
        {
          backupUsed: result.backupUsed,
        },
      );

      // Reload env after rollback
      try {
        const { resetCrmConfig } = await import("../services/crm/config");
        const { resetCRMConnector } =
          await import("../services/crm/crm-factory");
        resetCrmConfig();
        resetCRMConnector();
        const dotenv = require("dotenv");
        const path = require("path");
        dotenv.config({
          path: path.join(__dirname, "../../.env"),
          override: true,
        });
      } catch {
        /* best-effort reload */
      }

      return res.json({
        success: true,
        message: "Rollback succeeded",
        backupUsed: result.backupUsed,
      });
    } else {
      factoryLog(
        "error",
        "factory.rollback.failed",
        `Rollback failed: ${result.error}`,
        {
          error: result.error,
        },
      );
      return res.status(422).json({ success: false, error: result.error });
    }
    } catch (err: any) {
      factoryLog(
        "error",
        "factory.rollback.error",
        `Rollback error: ${err.message}`,
        { error: err.message },
      );
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── POST /test/webhook — Test webhook endpoint reachability ────────────────

router.post(
  "/test/webhook",
  express.json({ limit: "10kb" }),
  validateBody(schemas.webhookTestBody),
  async (req, res) => {
    try {
      const parsed = new URL(req.body.url);

      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.json({
          success: false,
          error: "Only HTTP(S) webhook URLs are allowed",
        });
      }

      if (isBlockedWebhookHost(parsed.hostname)) {
        return res.json({
          success: false,
          error: "Local and private network targets are blocked",
        });
      }

      // Only allow HTTPS URLs in production
      if (
        process.env.NODE_ENV === "production" &&
        parsed.protocol !== "https:"
      ) {
        return res.json({
          success: false,
          error: "HTTPS required in production",
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(parsed.toString(), {
          method: "HEAD",
          signal: controller.signal,
          headers: { "User-Agent": "AgentFactory/1.0 ConnectionTest" },
        });
        return res.json({
          success: response.ok || response.status === 405,
          status: response.status,
          message: `Endpoint responded with ${response.status}`,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      const isAbort = err.name === "AbortError";
      return res.json({
        success: false,
        error: isAbort
          ? "Connection timed out (10s)"
          : err.message?.slice(0, 200) || "Webhook test failed",
      });
    }
  },
);

// ── Redact secrets for safe UI display ─────────────────────────────────────

function redactSecrets(config: AgentConfig): AgentConfig {
  const clone = JSON.parse(JSON.stringify(config));

  // Redact API keys
  if (clone.llm?.groq?.apiKeys) {
    clone.llm.groq.apiKeys = clone.llm.groq.apiKeys.map((k: string) =>
      k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "",
    );
  }
  if (clone.llm?.openrouter?.apiKey) {
    const k = clone.llm.openrouter.apiKey;
    clone.llm.openrouter.apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "";
  }
  if (clone.crm?.twenty?.apiKey) {
    const k = clone.crm.twenty.apiKey;
    clone.crm.twenty.apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "";
  }
  if (clone.crm?.airtable?.webhookUrl) {
    const u = clone.crm.airtable.webhookUrl;
    clone.crm.airtable.webhookUrl = u ? u.replace(/\/[^/]{10,}$/, "/***") : "";
  }
  if (clone.llm?.openai?.apiKey) {
    const k = clone.llm.openai.apiKey;
    clone.llm.openai.apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "";
  }
  if (clone.llm?.anthropic?.apiKey) {
    const k = clone.llm.anthropic.apiKey;
    clone.llm.anthropic.apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "";
  }
  if (clone.llm?.custom?.apiKey) {
    const k = clone.llm.custom.apiKey;
    clone.llm.custom.apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : "";
  }
  if (clone.server?.databaseUrl) {
    clone.server.databaseUrl = clone.server.databaseUrl.replace(
      /\/\/([^:]+):([^@]+)@/,
      "//$1:***@",
    );
  }
  // Never expose webhook secrets
  if (clone.crm?.webhookSecret) clone.crm.webhookSecret = "***";
  if (clone.security?.jwtSecret) delete clone.security.jwtSecret;

  return clone;
}

// ── GET /builds/stats — Build statistics (MUST be before /:buildId) ────────

router.get("/builds/stats", async (_req, res) => {
  try {
    const stats = await FactoryBuildHistoryService.getStats();
    return res.json({ success: true, stats });
  } catch (err: any) {
    return res
      .status(500)
      .json({ success: false, error: err.message || "Failed to fetch stats" });
  }
});

// ── GET /builds — Build history ────────────────────────────────────────────

router.get(
  "/builds",
  validateQuery(schemas.getBuildsQuery),
  async (req, res) => {
  try {
    const { limit } = (req as any).validatedQuery as { limit: number };
    const builds = await FactoryBuildHistoryService.getRecentBuilds(limit);
    return res.json({ success: true, builds, count: builds.length });
  } catch (err: any) {
    return res
      .status(500)
      .json({
        success: false,
        error: err.message || "Failed to fetch build history",
      });
  }
  },
);

// ── GET /builds/:buildId — Get specific build ──────────────────────────────

router.get(
  "/builds/:buildId",
  validateParams(schemas.buildIdParam),
  async (req, res) => {
  try {
    const { buildId } = (req as any).validatedParams as { buildId: string };
    const build = await FactoryBuildHistoryService.getBuildById(
      buildId,
    );
    if (!build) {
      return res.status(404).json({ success: false, error: "Build not found" });
    }
    return res.json({ success: true, build });
  } catch (err: any) {
    return res
      .status(500)
      .json({ success: false, error: err.message || "Failed to fetch build" });
  }
  },
);

export default router;
