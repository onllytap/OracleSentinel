// ============================================================================
// Factory Build History Service — PostgreSQL Persistence
// ============================================================================
// Stores build pipeline execution history for audit and monitoring.
// ============================================================================

import { pool } from "../db/pool";
import type { BuildResult } from "../factory/types";

export interface BuildHistoryRecord {
  id: number;
  build_id: string;
  agent_name: string;
  status: string;
  production_ready: boolean;
  config_version: string | null;
  steps: any;
  warnings: string[];
  errors: string[];
  audit_log: any;
  duration_ms: number | null;
  crm_provider: string | null;
  llm_provider: string | null;
  build_strict: boolean | null;
  created_at: Date;
}

export class FactoryBuildHistoryService {
  /**
   * Save a build result to the database
   */
  static async saveBuild(
    buildResult: BuildResult,
    config?: {
      crmProvider?: string;
      llmProvider?: string;
      buildStrict?: boolean;
    },
  ): Promise<void> {
    const query = `
      INSERT INTO factory_builds (
        build_id, agent_name, status, production_ready, config_version,
        steps, warnings, errors, audit_log, duration_ms,
        crm_provider, llm_provider, build_strict
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (build_id) DO UPDATE SET
        status = EXCLUDED.status,
        production_ready = EXCLUDED.production_ready,
        steps = EXCLUDED.steps,
        warnings = EXCLUDED.warnings,
        errors = EXCLUDED.errors,
        duration_ms = EXCLUDED.duration_ms
    `;

    const values = [
      buildResult.buildId,
      buildResult.agentName,
      buildResult.status,
      buildResult.productionReady,
      buildResult.configVersion || null,
      JSON.stringify(buildResult.steps || []),
      buildResult.warnings || [],
      buildResult.errors || [],
      JSON.stringify(buildResult.auditLog || {}),
      buildResult.durationMs || null,
      config?.crmProvider || null,
      config?.llmProvider || null,
      config?.buildStrict ?? null,
    ];

    await pool.query(query, values);
  }

  /**
   * Get recent builds (latest first)
   */
  static async getRecentBuilds(limit = 50): Promise<BuildHistoryRecord[]> {
    const query = `
      SELECT * FROM factory_builds
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get a specific build by ID
   */
  static async getBuildById(
    buildId: string,
  ): Promise<BuildHistoryRecord | null> {
    const query = `
      SELECT * FROM factory_builds
      WHERE build_id = $1
    `;

    const result = await pool.query(query, [buildId]);
    return result.rows[0] || null;
  }

  /**
   * Get build statistics
   */
  static async getStats(): Promise<{
    total: number;
    success: number;
    failure: number;
    successRate: number;
    avgDurationMs: number;
    lastBuildAt: Date | null;
  }> {
    const query = `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'success')::int as success,
        COUNT(*) FILTER (WHERE status = 'failure')::int as failure,
        AVG(duration_ms) as avg_duration_ms,
        MAX(created_at) as last_build_at
      FROM factory_builds
    `;

    const result = await pool.query(query);
    const row = result.rows[0];

    return {
      total: row.total || 0,
      success: row.success || 0,
      failure: row.failure || 0,
      successRate: row.total > 0 ? (row.success / row.total) * 100 : 0,
      avgDurationMs: Math.round(row.avg_duration_ms || 0),
      lastBuildAt: row.last_build_at || null,
    };
  }

  /**
   * Delete old builds (keep last N days)
   */
  static async cleanupOldBuilds(keepDays = 30): Promise<number> {
    const safeDays = Math.max(1, Math.floor(Number(keepDays) || 30));
    const query = `
      DELETE FROM factory_builds
      WHERE created_at < NOW() - make_interval(days => $1)
    `;

    const result = await pool.query(query, [safeDays]);
    return result.rowCount || 0;
  }
}
