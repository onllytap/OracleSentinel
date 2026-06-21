// ============================================================================
// audit.service.ts — append-only audit log (R5: PII / secret-safe)
// ============================================================================
// Lightweight, dependency-free helper around the append-only `audit_log` table
// (created at boot by ensure-db). Two guarantees define this module:
//
//   1. PII / secret-safe — `sanitizeMeta` strips any key whose NAME looks
//      sensitive (secret / token / key / password / …) and truncates long
//      strings, so a careless caller can never leak a credential or a giant
//      blob into the log. The audit row itself must stay free of PII & secrets.
//   2. Never breaks the caller — `appendAudit` swallows every error (logging a
//      NON-secret message) because auditing is a side-effect: it must never
//      turn a successful business operation into a failure.
//
// The table is APPEND-ONLY. This module performs INSERT and SELECT only — it
// never issues UPDATE or DELETE against `audit_log`.
//
// Table (created elsewhere, at boot):
//   audit_log(id BIGSERIAL PK, actor VARCHAR, action VARCHAR, target_type
//             VARCHAR, target_id VARCHAR, meta JSONB, created_at TIMESTAMPTZ)
// ============================================================================

import { pool } from "../db/pool";

/**
 * Free-form action verb. Kept as a plain string so adding a new action never
 * requires a code change here. Common values used across the app:
 *   - "rgpd.export"            — a per-tenant data export was produced
 *   - "rgpd.delete"            — a per-tenant anonymisation/erasure was performed
 *   - "tenant.config.save"     — a per-tenant config override was saved
 *   - "tenant.config.rollback" — a per-tenant config was rolled back
 *   - "redeploy.start" / "redeploy.finish"
 *   - "auth.login" / "auth.fail" / "auth.totp.fail" / "auth.breakglass"
 */
export type AuditAction = string;

export interface AuditEntryInput {
  actor: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  actor: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

// Keys whose NAME suggests a secret / credential / PII handle — dropped from
// `meta` entirely, at every depth.
const SENSITIVE_KEY_RE =
  /secret|token|key|password|passwd|pwd|auth|credential|apikey|api_key|dsn|cookie|session|webhook/i;

const MAX_STRING_LEN = 500; // truncate long strings to this many chars
const MAX_DEPTH = 4; // drop containers nested deeper than this
const MAX_KEYS = 50; // cap object size to bound the row
const MAX_ARRAY = 100; // cap array length to bound the row

/**
 * PURE. Returns a defensive copy of `meta` with:
 *   - any key matching SENSITIVE_KEY_RE removed (at every depth),
 *   - strings longer than 500 chars truncated (with a marker),
 *   - nesting limited to MAX_DEPTH (deeper containers are dropped),
 *   - object-key / array-length caps to bound the persisted row size.
 * Never throws and never mutates its input.
 */
export function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out = sanitizeValue(meta, 0);
  return out && typeof out === "object" && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === "string") {
    const s = value as string;
    return s.length > MAX_STRING_LEN
      ? `${s.slice(0, MAX_STRING_LEN)}...[truncated ${s.length} chars]`
      : s;
  }
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return (value as bigint).toString();
  if (t === "function" || t === "symbol") return undefined;

  // Containers below — enforce the depth limit before recursing.
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    for (const item of value.slice(0, MAX_ARRAY)) {
      const v = sanitizeValue(item, depth + 1);
      if (v !== undefined) arr.push(v);
    }
    return arr;
  }

  if (t === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const k of Object.keys(src)) {
      if (count >= MAX_KEYS) break;
      if (SENSITIVE_KEY_RE.test(k)) continue; // drop sensitive-looking key
      const v = sanitizeValue(src[k], depth + 1);
      if (v !== undefined) {
        out[k] = v;
        count++;
      }
    }
    return out;
  }

  return undefined;
}

/**
 * Append one entry to the append-only audit log. INSERT only.
 * NEVER throws: auditing is a side-effect and must not break the caller. On any
 * failure it logs a NON-secret message (action + error message, never the meta
 * payload) and returns.
 */
export async function appendAudit(input: AuditEntryInput): Promise<void> {
  const action = String(input?.action ?? "unknown");
  try {
    const meta = sanitizeMeta(input?.meta);
    await pool.query(
      `INSERT INTO audit_log (actor, action, target_type, target_id, meta)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input?.actor ?? null,
        action,
        input?.targetType ?? null,
        input?.targetId ?? null,
        JSON.stringify(meta),
      ],
    );
  } catch (err) {
    // NON-secret diagnostic only — never log the meta payload or query params.
    console.error(
      `[audit] failed to append entry (action=${action}):`,
      (err as Error)?.message ?? "unknown error",
    );
  }
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;

function clampLimit(limit: number | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)));
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? new Date(0).toISOString()
      : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Read recent audit entries (newest first) with optional filters.
 * SELECT only. `limit` is clamped to 1..200 (default 100).
 */
export async function listAudit(opts?: {
  limit?: number;
  action?: string;
  targetId?: string;
}): Promise<AuditEntry[]> {
  const limit = clampLimit(opts?.limit);
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts?.action) {
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }
  if (opts?.targetId) {
    params.push(opts.targetId);
    where.push(`target_id = $${params.length}`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const sql = `SELECT id, actor, action, target_type, target_id, meta, created_at
       FROM audit_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ${limitPlaceholder}`;

  const result = await pool.query(sql, params);
  const rows = (result?.rows ?? []) as Array<{
    id: string | number;
    actor: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    meta: Record<string, unknown> | null;
    created_at: Date | string | null;
  }>;

  return rows.map((r) => ({
    id: String(r.id),
    actor: r.actor ?? null,
    action: r.action,
    targetType: r.target_type ?? null,
    targetId: r.target_id ?? null,
    meta:
      r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
        ? r.meta
        : {},
    createdAt: toIso(r.created_at),
  }));
}
