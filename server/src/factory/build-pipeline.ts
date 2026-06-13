// ============================================================================
// Build Pipeline — Config Validation, Connection Proof, Deployment Gate
// ============================================================================
// This module orchestrates the full build pipeline when a user clicks BUILD.
// Every step is deterministic. Every failure is explicit. No silent errors.
//
// LOGGING CONTRACT:
// - Every step emits factoryLog() at start AND end
// - Every log includes a buildId for correlation
// - On failure after .env write → automatic rollback to backup
// - console.log is FORBIDDEN here — all output via factoryLog()
// ============================================================================

import type {
  AgentConfig,
  BuildResult,
  BuildStep,
  BuildStatus,
  BuildAuditEntry,
  BuildStepStatus,
} from "./types";
import {
  agentConfigToEnv,
  saveConfig,
  loadCurrentConfig,
  restoreLatestBackup,
} from "./config-synthesizer";
import { runReadinessChecks } from "./readiness-gate";
import { factoryLog } from "./observability";
import {
  validateCrmConnectionAsync,
  validateCrmConfiguration,
} from "../services/crm/validator";
import {
  getCRMConnector,
  resetCRMConnector,
} from "../services/crm/crm-factory";
import { resetCrmConfig } from "../services/crm/config";
import crypto from "crypto";

// ── Generate a short unique build ID ───────────────────────────────────────

function generateBuildId(): string {
  return `build-${crypto.randomBytes(4).toString("hex")}`;
}

// ── Build Pipeline Orchestrator ────────────────────────────────────────────

export async function executeBuildPipeline(
  config: AgentConfig,
): Promise<BuildResult> {
  const steps: BuildStep[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const startTime = Date.now();
  const buildId = generateBuildId();

  // Track whether .env has been written (for rollback decisions)
  let envWritten = false;
  let backupPath: string | null = null;

  factoryLog("info", "factory.build.start", `Build pipeline started`, {
    buildId,
    agent: config.branding?.agentName || "unknown",
    configVersion: config.version,
    crmProvider: config.crm?.provider,
    llmProvider: config.llm?.provider,
  });

  // ── Step 1: Config Schema Validation ───────────────────────────
  const step1 = await executeStep(
    "Config Schema Validation",
    buildId,
    async () => {
      const schemaErrors = validateConfigSchema(config);
      if (schemaErrors.length > 0) {
        return {
          status: "failure" as BuildStepStatus,
          message: `Schema validation failed: ${schemaErrors.join("; ")}`,
          details: { errors: schemaErrors },
        };
      }
      return {
        status: "success" as BuildStepStatus,
        message: `Config schema valid (version ${config.version})`,
      };
    },
  );
  steps.push(step1);
  if (step1.status === "failure") {
    errors.push(step1.message || "Schema validation failed");
  }

  // ── Step 2: Config Synthesis (.env generation) ─────────────────
  const step2 = await executeStep("Config Synthesis", buildId, async () => {
    try {
      const envContent = agentConfigToEnv(config);
      const lineCount = envContent.split("\n").length;
      if (lineCount < 10) {
        return {
          status: "failure" as BuildStepStatus,
          message: "Generated .env is suspiciously short",
          details: { lineCount },
        };
      }
      return {
        status: "success" as BuildStepStatus,
        message: `Generated .env with ${lineCount} lines`,
        details: { lineCount },
      };
    } catch (err: any) {
      return {
        status: "failure" as BuildStepStatus,
        message: `Config synthesis failed: ${err.message}`,
      };
    }
  });
  steps.push(step2);
  if (step2.status === "failure") {
    errors.push(step2.message || "Config synthesis failed");
  }

  // ── Step 3: Config Persistence (write .env + backup) ──────────
  const step3 = await executeStep("Config Persistence", buildId, async () => {
    try {
      const result = saveConfig(config);
      envWritten = true;
      backupPath = result.backup;
      return {
        status: "success" as BuildStepStatus,
        message: `Config saved to ${result.path}${result.backup ? ` (backup created)` : ""}`,
        details: { path: result.path, hasBackup: !!result.backup },
      };
    } catch (err: any) {
      return {
        status: "failure" as BuildStepStatus,
        message: `Failed to persist config: ${err.message}`,
      };
    }
  });
  steps.push(step3);
  if (step3.status === "failure") {
    errors.push(step3.message || "Config persistence failed");
  }

  // Stop early if config couldn't be saved
  if (step3.status === "failure") {
    return buildFinalResult(
      config,
      steps,
      warnings,
      errors,
      startTime,
      buildId,
    );
  }

  // ── Step 4: Reload CRM Config (apply new env) ─────────────────
  const step4 = await executeStep("CRM Config Reload", buildId, async () => {
    try {
      // Reset singletons to force reload from new .env
      resetCrmConfig();
      resetCRMConnector();

      // Re-read environment variables
      const dotenv = require("dotenv");
      const path = require("path");
      dotenv.config({
        path: path.join(__dirname, "../../.env"),
        override: true,
      });

      return {
        status: "success" as BuildStepStatus,
        message: "CRM configuration reloaded from new .env",
      };
    } catch (err: any) {
      return {
        status: "warning" as BuildStepStatus,
        message: `CRM reload warning: ${err.message}`,
      };
    }
  });
  steps.push(step4);
  if (step4.status === "warning") {
    warnings.push(step4.message || "CRM reload had warnings");
  }

  // ── Step 5: CRM Connection Proof ──────────────────────────────
  const step5 = await executeStep("CRM Connection Proof", buildId, async () => {
    if (config.crm.provider === "none") {
      return {
        status: "success" as BuildStepStatus,
        message: "CRM disabled (provider=none) — connection test skipped",
      };
    }

    try {
      const result = await validateCrmConnectionAsync();

      if (!result.configValid) {
        return {
          status: "failure" as BuildStepStatus,
          message: `CRM config invalid: ${result.errors.join("; ")}`,
          details: { errors: result.errors },
        };
      }

      if (!result.connectionOk) {
        return {
          status: "failure" as BuildStepStatus,
          message: `CRM connection failed: ${result.errors.join("; ")}`,
          details: { errors: result.errors },
        };
      }

      return {
        status: "success" as BuildStepStatus,
        message: `CRM connection verified (${config.crm.provider})`,
      };
    } catch (err: any) {
      return {
        status: "failure" as BuildStepStatus,
        message: `CRM connection test error: ${err.message}`,
      };
    }
  });
  steps.push(step5);
  if (step5.status === "failure") {
    errors.push(step5.message || "CRM connection failed");
  }

  // ── Step 6: Write Permission Proof ────────────────────────────
  const step6 = await executeStep(
    "Write Permission Check",
    buildId,
    async () => {
      if (config.crm.provider === "none") {
        return {
          status: "success" as BuildStepStatus,
          message: "CRM disabled — write permission check skipped",
        };
      }

      const connector = getCRMConnector();
      if (!connector.isConfigured()) {
        return {
          status: "warning" as BuildStepStatus,
          message:
            "Connector not fully configured — cannot verify write permissions",
        };
      }

      // We don't do a test write, but we verify the connector reports configured
      return {
        status: "success" as BuildStepStatus,
        message: `Write permission assumed OK (connector ${connector.providerName} is configured)`,
      };
    },
  );
  steps.push(step6);
  if (step6.status === "warning") {
    warnings.push(step6.message || "");
  }

  // ── Step 7: CRM Strict Mode Validation ────────────────────────
  const step7 = await executeStep(
    "Strict Mode Validation",
    buildId,
    async () => {
      const validationResult = validateCrmConfiguration();

      if (!validationResult.valid) {
        return {
          status: "failure" as BuildStepStatus,
          message: `Validation errors: ${validationResult.errors.join("; ")}`,
          details: { ...validationResult } as Record<string, unknown>,
        };
      }

      if (validationResult.warnings.length > 0) {
        for (const w of validationResult.warnings) {
          warnings.push(w);
        }
        return {
          status: "warning" as BuildStepStatus,
          message: `${validationResult.warnings.length} warning(s): ${validationResult.warnings.join("; ")}`,
          details: { ...validationResult } as Record<string, unknown>,
        };
      }

      return {
        status: "success" as BuildStepStatus,
        message: "All strict mode checks passed",
      };
    },
  );
  steps.push(step7);
  if (step7.status === "failure") {
    errors.push(step7.message || "Strict mode validation failed");
  }

  // ── Step 8: Production Readiness Gate ─────────────────────────
  const step8 = await executeStep(
    "Production Readiness Gate",
    buildId,
    async () => {
      const readiness = await runReadinessChecks(config);

      if (readiness.level === "BLOCKED") {
        return {
          status: "failure" as BuildStepStatus,
          message: `Production BLOCKED: ${readiness.blockers.join("; ")}`,
          details: { readiness },
        };
      }

      if (readiness.level === "WARNING") {
        for (const w of readiness.warnings) {
          warnings.push(w);
        }
        return {
          status: "warning" as BuildStepStatus,
          message: `Production ready with ${readiness.warnings.length} warning(s)`,
          details: { readiness },
        };
      }

      return {
        status: "success" as BuildStepStatus,
        message: "Production readiness: APPROVED",
        details: { readiness },
      };
    },
  );
  steps.push(step8);
  if (step8.status === "failure") {
    errors.push(step8.message || "Production readiness gate failed");
  }

  // ── Auto-Rollback: if build failed AFTER .env was written ─────
  const hasFailure = steps.some((s) => s.status === "failure");
  if (hasFailure && envWritten) {
    factoryLog(
      "warn",
      "factory.build.rollback.start",
      "Build failed after .env write — initiating automatic rollback",
      {
        buildId,
        backupPath: backupPath || "none",
      },
    );

    const rollbackResult = restoreLatestBackup();
    if (rollbackResult.restored) {
      factoryLog(
        "info",
        "factory.build.rollback.success",
        "Automatic rollback succeeded",
        {
          buildId,
          backupUsed: rollbackResult.backupUsed,
        },
      );
      warnings.push(
        `Auto-rollback: .env restored from backup after build failure`,
      );

      // Reload env after rollback
      try {
        resetCrmConfig();
        resetCRMConnector();
        const dotenv = require("dotenv");
        const pathMod = require("path");
        dotenv.config({
          path: pathMod.join(__dirname, "../../.env"),
          override: true,
        });
      } catch {
        /* best-effort reload */
      }
    } else {
      factoryLog(
        "error",
        "factory.build.rollback.failed",
        `Automatic rollback failed: ${rollbackResult.error}`,
        {
          buildId,
          backupUsed: rollbackResult.backupUsed,
          error: rollbackResult.error,
        },
      );
      errors.push(`CRITICAL: Auto-rollback failed: ${rollbackResult.error}`);
    }
  }

  return buildFinalResult(config, steps, warnings, errors, startTime, buildId);
}

// ── Execute a single build step with timing and structured logging ─────────

async function executeStep(
  name: string,
  buildId: string,
  fn: () => Promise<{
    status: BuildStepStatus;
    message: string;
    details?: Record<string, unknown>;
  }>,
): Promise<BuildStep> {
  const start = Date.now();

  factoryLog("info", "factory.build.step.start", `[${name}] Starting...`, {
    buildId,
    step: name,
  });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    const logLevel =
      result.status === "failure"
        ? "error"
        : result.status === "warning"
          ? "warn"
          : "info";

    factoryLog(
      logLevel,
      "factory.build.step.end",
      `[${name}] ${result.status.toUpperCase()}: ${result.message}`,
      {
        buildId,
        step: name,
        status: result.status,
        durationMs,
        blocking: result.status === "failure",
        ...(result.details || {}),
      },
    );

    return {
      name,
      status: result.status,
      message: result.message,
      durationMs,
      details: result.details,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;

    factoryLog(
      "error",
      "factory.build.step.end",
      `[${name}] UNEXPECTED ERROR: ${err.message}`,
      {
        buildId,
        step: name,
        status: "failure",
        durationMs,
        blocking: true,
        error: err.message,
      },
    );

    return {
      name,
      status: "failure",
      message: `Unexpected error: ${err.message}`,
      durationMs,
    };
  }
}

// ── Build Final Result ─────────────────────────────────────────────────────

function buildFinalResult(
  config: AgentConfig,
  steps: BuildStep[],
  warnings: string[],
  errors: string[],
  startTime: number,
  buildId: string,
): BuildResult {
  const hasFailure = steps.some((s) => s.status === "failure");
  const status: BuildStatus = hasFailure ? "failure" : "success";
  const productionReady = !hasFailure;
  const totalDurationMs = Date.now() - startTime;

  const auditLog: BuildAuditEntry = {
    event: "agent.factory.build",
    agent: config.branding.agentName,
    status: status.toUpperCase(),
    timestamp: new Date().toISOString(),
    configVersion: config.version,
    steps: steps.map((s) => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
    })),
  };

  // Emit final build summary via structured factoryLog (NOT console.log)
  const summaryLevel = hasFailure ? "error" : "info";
  factoryLog(
    summaryLevel,
    "factory.build.complete",
    `Build ${status.toUpperCase()} for ${config.branding.agentName}`,
    {
      buildId,
      status,
      productionReady,
      totalDurationMs,
      stepCount: steps.length,
      successCount: steps.filter((s) => s.status === "success").length,
      warningCount: warnings.length,
      errorCount: errors.length,
      blockers: errors,
      warnings,
      auditLog,
    },
  );

  const result = {
    status,
    steps,
    timestamp: new Date().toISOString(),
    agentName: config.branding.agentName,
    warnings,
    errors,
    productionReady,
    auditLog,
    buildId,
    configVersion: config.version,
    durationMs: totalDurationMs,
  };

  // Persist build history to PostgreSQL (async, non-blocking)
  setImmediate(async () => {
    try {
      const { FactoryBuildHistoryService } =
        await import("../services/factory-build-history.service");
      await FactoryBuildHistoryService.saveBuild(result, {
        crmProvider: config.crm?.provider,
        llmProvider: config.llm?.provider,
        buildStrict: config.factory?.buildStrict,
      });
    } catch (err: any) {
      // Log error but don't fail the build
      factoryLog(
        "warn",
        "factory.build.persistence.failed",
        `Failed to persist build history: ${err.message}`,
        { buildId },
      );
    }
  });

  return result;
}

// ── Config Schema Validator ────────────────────────────────────────────────

function validateConfigSchema(config: AgentConfig): string[] {
  const errors: string[] = [];

  // Required fields
  if (!config.branding?.agentName)
    errors.push("branding.agentName is required");
  if (!config.branding?.agencyName)
    errors.push("branding.agencyName is required");
  if (!config.server?.databaseUrl)
    errors.push("server.databaseUrl is required");

  // CRM validation
  if (config.crm.provider !== "none") {
    if (config.crm.provider === "twenty") {
      if (!config.crm.twenty?.apiUrl)
        errors.push("crm.twenty.apiUrl is required when provider=twenty");
      if (!config.crm.twenty?.apiKey)
        errors.push("crm.twenty.apiKey is required when provider=twenty");
    }
    if (config.crm.provider === "airtable") {
      if (!config.crm.airtable?.webhookUrl)
        errors.push(
          "crm.airtable.webhookUrl is required when provider=airtable",
        );
    }
  }

  // Score range
  if (config.crm.minPushScore < 0 || config.crm.minPushScore > 100) {
    errors.push("crm.minPushScore must be 0-100");
  }

  // LLM validation
  if (config.llm.provider === "groq") {
    if (!config.llm.groq?.apiKeys?.length)
      errors.push("At least one Groq API key is required");
  }
  if (config.llm.provider === "openrouter") {
    if (!config.llm.openrouter?.apiKey)
      errors.push("OpenRouter API key is required");
  }

  // Security
  if (!config.security.jwtIssuer) errors.push("security.jwtIssuer is required");
  if (config.security.jwtTtlSeconds < 60)
    errors.push("security.jwtTtlSeconds must be >= 60");

  return errors;
}
