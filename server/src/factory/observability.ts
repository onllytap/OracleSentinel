// ============================================================================
// Observability Service — Metrics Collection & Real-Time Status
// ============================================================================
// Provides structured metrics for the Factory UI dashboard.
// All data is computed on-demand (no persistent metrics store).
// ============================================================================

import type {
  ObservabilitySnapshot,
  SystemHealthMetrics,
  CrmPushMetrics,
} from "./types";
import { pool } from "../db/pool";
import { getCRMConnector } from "../services/crm/crm-factory";
import { getCrmConfig } from "../services/crm/config";

// ── In-Memory Metrics Accumulator ──────────────────────────────────────────

interface PushRecord {
  timestamp: number;
  success: boolean;
  durationMs: number;
  duplicate: boolean;
  verificationResult: "pass" | "fail" | "skipped";
}

class MetricsCollector {
  private pushHistory: PushRecord[] = [];
  private lastError: string | null = null;
  private maxHistory = 1000;

  recordPush(record: PushRecord): void {
    this.pushHistory.push(record);
    if (this.pushHistory.length > this.maxHistory) {
      this.pushHistory = this.pushHistory.slice(-this.maxHistory);
    }
    if (!record.success) {
      this.lastError = new Date(record.timestamp).toISOString();
    }
  }

  getCrmMetrics(): CrmPushMetrics {
    const now = Date.now();
    // Consider last 24h for metrics
    const recent = this.pushHistory.filter((r) => now - r.timestamp < 86400000);

    const totalPushes = recent.length;
    const successCount = recent.filter((r) => r.success).length;
    const failureCount = recent.filter((r) => !r.success).length;
    const duplicateCount = recent.filter((r) => r.duplicate).length;
    const avgDurationMs =
      totalPushes > 0
        ? Math.round(
            recent.reduce((sum, r) => sum + r.durationMs, 0) / totalPushes,
          )
        : 0;
    const lastPush =
      recent.length > 0
        ? new Date(recent[recent.length - 1].timestamp).toISOString()
        : null;
    const lastVerification =
      recent.length > 0 ? recent[recent.length - 1].verificationResult : null;

    let failedLeadsInQueue = 0;
    try {
      const connector = getCRMConnector();
      failedLeadsInQueue = connector.getFailedLeadsCount();
    } catch (err: any) {
      factoryLog(
        "warn",
        "observability.crm.failedLeadsCount.error",
        `Could not read failed leads count: ${err.message}`,
        { error: err.message },
      );
    }

    return {
      totalPushes,
      successCount,
      failureCount,
      duplicateCount,
      avgDurationMs,
      lastPushAt: lastPush,
      lastVerificationResult: lastVerification,
      failedLeadsInQueue,
    };
  }

  getLastError(): string | null {
    return this.lastError;
  }
}

// Singleton
export const metricsCollector = new MetricsCollector();

// ── System Health Check ────────────────────────────────────────────────────

async function getSystemHealth(): Promise<SystemHealthMetrics> {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  const memoryUsageMb = Math.round(memUsage.heapUsed / 1024 / 1024);

  // Database connection check
  let databaseConnected = false;
  let activeConnections = 0;
  try {
    const result = await pool.query("SELECT 1 as ok");
    databaseConnected = result.rows[0]?.ok === 1;
    activeConnections = pool.totalCount;
  } catch (err: any) {
    factoryLog(
      "warn",
      "observability.health.database.error",
      `Database health check failed: ${err.message}`,
      { error: err.message },
    );
  }

  // CRM connection check
  let crmConnected = false;
  try {
    const config = getCrmConfig();
    if (config.provider !== "none") {
      const connector = getCRMConnector();
      crmConnected = connector.isConfigured();
    }
  } catch (err: any) {
    factoryLog(
      "warn",
      "observability.health.crm.error",
      `CRM health check failed: ${err.message}`,
      { error: err.message },
    );
  }

  // LLM availability check
  let llmAvailable = false;
  try {
    const provider = process.env.LLM_PROVIDER || "groq";
    if (provider === "groq") {
      llmAvailable = !!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1);
    } else if (provider === "openrouter") {
      llmAvailable = !!process.env.OPENROUTER_API_KEY;
    }
  } catch {
    /* ignore */
  }

  return {
    uptime,
    memoryUsageMb,
    activeConnections,
    databaseConnected,
    crmConnected,
    llmAvailable,
    lastError: metricsCollector.getLastError(),
  };
}

// ── Full Snapshot ──────────────────────────────────────────────────────────

export async function getObservabilitySnapshot(): Promise<ObservabilitySnapshot> {
  const [system, crm] = await Promise.all([
    getSystemHealth(),
    Promise.resolve(metricsCollector.getCrmMetrics()),
  ]);

  return {
    system,
    crm,
    timestamp: new Date().toISOString(),
  };
}

// ── Recent CRM Logs (structured events from in-memory buffer) ──────────────

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  event: string;
  message: string;
  details?: Record<string, unknown>;
}

class LogBuffer {
  private entries: LogEntry[] = [];
  private maxEntries = 500;

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getRecent(limit = 50, level?: string): LogEntry[] {
    let filtered = this.entries;
    if (level) {
      filtered = filtered.filter((e) => e.level === level);
    }
    return filtered.slice(-limit).reverse();
  }

  clear(): void {
    this.entries = [];
  }
}

export const logBuffer = new LogBuffer();

// Helper to log and buffer simultaneously
export function factoryLog(
  level: LogEntry["level"],
  event: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    details,
  };
  logBuffer.push(entry);

  // Also emit to stdout for observability
  const logFn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  logFn(JSON.stringify({ ...entry, source: "factory" }));
}
