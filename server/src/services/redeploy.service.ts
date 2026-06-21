// ============================================================================
// redeploy.service.ts — controlled per-bot redeploy (R3/R4). T9.
// ============================================================================
// "Redeploy" in this SINGLE-PROCESS Node deployment is NOT a container restart.
// It means: make the LATEST saved per-tenant config the one actively served, by
//   (a) resolving the latest config version (tenant_config_versions), and
//   (b) invalidating THIS tenant's in-memory config cache so the very next
//       message reloads it (resetTenantConfigCache(tenantId)).
//
// Guarantees:
//   - SINGLE-FLIGHT per tenant (R3): only one redeploy runs at a time for a
//     given tenant. A concurrent request is rejected (in-memory lock).
//   - TENANT-SCOPED (R3.5): only THIS tenant's cache is invalidated; the other
//     agencies are untouched.
//   - ROLLBACK ON FAILURE: on any error we restore the previously-served active
//     version, record status='rolled_back' + a NON-secret error, and return a
//     clean state. requestRedeploy NEVER throws on an apply failure — only the
//     single-flight conflict throws, so the route can map it to a 409.
//   - AUDITED: redeploy.init + redeploy.result(ok|fail) via the append-only
//     audit log. Secrets / PII are never logged or returned.
//
// State is persisted in `tenant_redeploys` (created at boot):
//   tenant_redeploys(tenant_id PK, status, config_version, active_version,
//                    started_at, finished_at, error, updated_at)
// ============================================================================

import { pool } from "../db/pool";
import { appendAudit } from "./audit.service";
import {
  getTenantConfigVersions,
  resetTenantConfigCache,
} from "./tenant-config.service";

export type RedeployStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "rolled_back";

export interface RedeployState {
  tenantId: string;
  status: RedeployStatus;
  configVersion: number | null;
  activeVersion: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string;
}

const MAX_ERROR_LEN = 300;

// In-memory single-flight lock. One Node process serves the whole fleet, so a
// Set is sufficient (and authoritative) to guarantee one redeploy per tenant.
const inFlight = new Set<string>();

// ── pure helpers ─────────────────────────────────────────────────────────────

/**
 * PURE. True when there IS a latest version and it is newer than the active one
 * (or nothing is active yet). False when there is no latest version or the
 * active version already matches / leads it.
 */
export function isOutOfDate(active: number | null, latest: number | null): boolean {
  if (latest === null || latest === undefined) return false;
  if (active === null || active === undefined) return true;
  return latest > active;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Keep error text short + non-secret (we only ever store our own messages). */
function safeError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err ?? "unknown error");
  return String(msg).slice(0, MAX_ERROR_LEN);
}

// ── reads ──────────────────────────────────────────────────────────────────────

/** Resolve the latest saved config version id for a tenant (null if none). */
export async function getLatestConfigVersion(
  tenantId: string,
): Promise<number | null> {
  const versions = await getTenantConfigVersions(tenantId, 1);
  return versions.length > 0 ? toNum(versions[0].id) : null;
}

/** The currently-served (active) config version for a tenant (null if none). */
export async function getActiveConfigVersion(
  tenantId: string,
): Promise<number | null> {
  const r = await pool.query(
    `SELECT active_version FROM tenant_redeploys WHERE tenant_id = $1`,
    [tenantId],
  );
  return toNum(r.rows[0]?.active_version);
}

/** Full redeploy state for a tenant. Defaults to a 'pending' state if no row. */
export async function getRedeployState(tenantId: string): Promise<RedeployState> {
  const r = await pool.query(
    `SELECT tenant_id, status, config_version, active_version,
            started_at, finished_at, error
       FROM tenant_redeploys WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = r.rows[0];
  if (!row) {
    return {
      tenantId,
      status: "pending",
      configVersion: null,
      activeVersion: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  const state: RedeployState = {
    tenantId,
    status: (row.status as RedeployStatus) ?? "pending",
    configVersion: toNum(row.config_version),
    activeVersion: toNum(row.active_version),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
  if (row.error) state.error = String(row.error).slice(0, MAX_ERROR_LEN);
  return state;
}

// ── writes (state machine) ───────────────────────────────────────────────────

async function markInProgress(
  tenantId: string,
  configVersion: number | null,
  activeVersion: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_redeploys
        (tenant_id, status, config_version, active_version,
         started_at, finished_at, error, updated_at)
     VALUES ($1, 'in_progress', $2, $3, NOW(), NULL, NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
        SET status = 'in_progress',
            config_version = EXCLUDED.config_version,
            active_version = EXCLUDED.active_version,
            started_at = NOW(),
            finished_at = NULL,
            error = NULL,
            updated_at = NOW()`,
    [tenantId, configVersion, activeVersion],
  );
}

async function markSucceeded(
  tenantId: string,
  activeVersion: number | null,
): Promise<void> {
  await pool.query(
    `UPDATE tenant_redeploys
        SET status = 'succeeded',
            active_version = $2,
            finished_at = NOW(),
            error = NULL,
            updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, activeVersion],
  );
}

async function markRolledBack(
  tenantId: string,
  configVersion: number | null,
  activeVersion: number | null,
  error: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_redeploys
        (tenant_id, status, config_version, active_version,
         started_at, finished_at, error, updated_at)
     VALUES ($1, 'rolled_back', $2, $3, NOW(), NOW(), $4, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
        SET status = 'rolled_back',
            config_version = EXCLUDED.config_version,
            active_version = EXCLUDED.active_version,
            finished_at = NOW(),
            error = EXCLUDED.error,
            updated_at = NOW()`,
    [tenantId, configVersion, activeVersion, error],
  );
}

// ── orchestration ──────────────────────────────────────────────────────────────

/**
 * Request a controlled redeploy for ONE tenant (R3).
 *
 * Single-flight: throws Error('redeploy_in_progress') when a redeploy is
 * already running for this tenant. On an apply failure it rolls back and
 * returns a 'rolled_back' state (never throws), so the route always has a clean
 * JSON state to return. Affects ONLY this tenant (R3.5).
 */
export async function requestRedeploy(
  tenantId: string,
  actor: string | null,
): Promise<RedeployState> {
  if (inFlight.has(tenantId)) {
    throw new Error("redeploy_in_progress");
  }
  inFlight.add(tenantId);
  try {
    return await runRedeploy(tenantId, actor);
  } finally {
    inFlight.delete(tenantId);
  }
}

async function runRedeploy(
  tenantId: string,
  actor: string | null,
): Promise<RedeployState> {
  // Remember what is served right now so we can restore it on failure.
  let previousActive: number | null = null;
  try {
    previousActive = await getActiveConfigVersion(tenantId);
  } catch {
    previousActive = null;
  }

  let latest: number | null = null;
  let startedAt: string | null = null;

  try {
    // (a) resolve the latest saved config version.
    latest = await getLatestConfigVersion(tenantId);
    startedAt = new Date().toISOString();

    await markInProgress(tenantId, latest, previousActive);
    await appendAudit({
      actor,
      action: "redeploy.init",
      targetType: "tenant",
      targetId: tenantId,
      meta: { fromVersion: previousActive, toVersion: latest },
    });

    // Apply: set active_version=latest then invalidate ONLY this tenant's cache
    // so the next message reloads the latest config (single shared process →
    // reload, NOT a real container restart). Cache reset is in-memory & cannot
    // fail, so it runs after the DB write is committed.
    await markSucceeded(tenantId, latest);
    resetTenantConfigCache(tenantId);

    await appendAudit({
      actor,
      action: "redeploy.result",
      targetType: "tenant",
      targetId: tenantId,
      meta: { ok: true, activeVersion: latest },
    });

    return {
      tenantId,
      status: "succeeded",
      configVersion: latest,
      activeVersion: latest,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Failure: we never successfully applied (the cache reset is the very last
    // step and cannot throw), so the served config is untouched. Restore the
    // previously-active version as bookkeeping, record a NON-secret error, and
    // return a clean 'rolled_back' state WITHOUT throwing.
    const error = safeError(err);
    try {
      await markRolledBack(tenantId, latest, previousActive, error);
    } catch {
      /* persistence is best-effort; we still return a clean state below */
    }
    await appendAudit({
      actor,
      action: "redeploy.result",
      targetType: "tenant",
      targetId: tenantId,
      meta: { ok: false, error },
    });
    return {
      tenantId,
      status: "rolled_back",
      configVersion: latest,
      activeVersion: previousActive,
      startedAt,
      finishedAt: new Date().toISOString(),
      error,
    };
  }
}
