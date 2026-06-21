// ============================================================================
// Metrics Service — real per-bot metrics for the Command Center (R6 / R7)
// ============================================================================
// Produces REAL, measured metrics for one bot (tenant) or the whole fleet so
// the super-admin sees ground truth instead of pseudo/derived values:
//   - messageCount    : total messages stored for the tenant
//   - measuredLatencyMs: a live HTTP round-trip probe of the serving process
//                        (null on timeout/unreachable — R6.5 / R7.4)
//   - responseRate    : % of assistant replies vs user messages in a window
//   - lastActivityAt  : timestamp of the most recent message (R6.6)
//   - hostingLocation : non-secret infra metadata (region label only)
//
// DESIGN (mirrors fleet.service / cloudflare.service):
//   - READ-ONLY on existing tables (`messages`). No writes, no schema changes.
//   - Resilient: every DB access is guarded; on any error we degrade to
//     zeros/null and NEVER throw (callers/routes can rely on a value).
//   - The latency probe mirrors cloudflare.service `pingWorker`: a time-boxed
//     GET with manual redirect handling, measuring the wall-clock delta.
//   - Security: `hostingLocation` is a coarse region LABEL from env metadata —
//     never a connection string, token or any secret.
// ============================================================================

import { pool } from "../db/pool";

export interface BotMetrics {
  tenantId: string;
  messageCount: number; // from messages WHERE tenant_id=$1
  measuredLatencyMs: number | null; // real probe; null on timeout/unreachable (R6.5/R7.4)
  responseRate: number; // % assistant replies vs user msgs in window, clamped 0..100 (R6.3)
  lastActivityAt: string | null; // MAX(messages.created_at); null if none (R6.6)
  hostingLocation: string; // infra metadata, NO secret (e.g. process.env.HOSTING_REGION || 'vps')
}

// ── Tunables (env-driven, with safe integer guards) ──────────────────────────

/** Latency probe budget. Time-boxed so a hung serving URL can never block us. */
const DEFAULT_PROBE_TIMEOUT_MS = toPositiveInt(
  process.env.PRIV_METRICS_PROBE_TIMEOUT_MS,
  4000,
);

/** Window (days) over which the response rate is computed (R6.3). */
const RESPONSE_RATE_WINDOW_DAYS = toPositiveInt(
  process.env.PRIV_METRICS_WINDOW_DAYS,
  7,
);

/** Safety cap on how many tenants a no-argument fleet call will fan out to. */
const MAX_FLEET_TENANTS = toPositiveInt(
  process.env.PRIV_METRICS_MAX_TENANTS,
  500,
);

/** Parse a positive integer from env, falling back when unset/invalid. */
function toPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Pure helpers (no I/O — unit-testable) ─────────────────────────────────────

/**
 * Response rate = assistant replies / user messages, as a percentage.
 * PURE & defensive:
 *   - 0 when there are no user messages (avoids divide-by-zero) — R6.3.
 *   - clamped to 0..100 (a bot may emit system/greeting messages with no user
 *     turn, which could otherwise push the ratio above 100).
 *   - non-finite / negative inputs are treated as 0.
 */
export function computeResponseRate(
  userCount: number,
  assistantCount: number,
): number {
  const users = Number.isFinite(userCount) ? Math.max(0, userCount) : 0;
  const assistants = Number.isFinite(assistantCount)
    ? Math.max(0, assistantCount)
    : 0;
  if (users === 0) return 0;
  const rate = (assistants / users) * 100;
  return Math.min(100, Math.max(0, Math.round(rate)));
}

/** Coerce a DB timestamp to an ISO string, or null if missing/invalid. */
function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const t = new Date(value as any).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Resolve the URL to probe for serving latency. All bots are served by the same
 * Node process, so this is the process health endpoint:
 *   SELF_HEALTH_URL > PUBLIC_BASE_URL + '/health' > http://localhost:PORT/health
 * (trailing slash on PUBLIC_BASE_URL is tolerated to avoid a double slash).
 */
function resolveServingUrl(): string {
  const explicit = (process.env.SELF_HEALTH_URL || "").trim();
  if (explicit) return explicit;
  const base = (process.env.PUBLIC_BASE_URL || "").trim();
  if (base) return `${base.replace(/\/+$/, "")}/health`;
  return `http://localhost:${process.env.PORT || 3001}/health`;
}

/**
 * Coarse hosting region LABEL for display only. SECURITY: this is infra
 * metadata (e.g. "vps", "fra1") — never a secret or connection string.
 */
function resolveHostingLocation(): string {
  return (process.env.HOSTING_REGION || "").trim() || "vps";
}

// ── Latency probe (mirrors cloudflare.service `pingWorker`) ───────────────────

/**
 * Measure a live HTTP round-trip to `url`. Returns the elapsed milliseconds, or
 * null on any timeout / unreachable / thrown error (R6.5 / R7.4). Never throws.
 * Time-boxed via AbortSignal.timeout so it cannot hang the request.
 */
export async function probeLatency(
  url: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  if (!url) return null;
  const start = Date.now();
  try {
    await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return Date.now() - start;
  } catch {
    // Timeout, DNS failure, connection refused, abort — all mean "no reading".
    return null;
  }
}

// ── DB metrics (read-only, guarded) ──────────────────────────────────────────

interface TenantDbMetrics {
  messageCount: number;
  responseRate: number;
  lastActivityAt: string | null;
}

/**
 * Load the DB-derived metrics for one tenant. Two read-only round-trips:
 *   1) total message count + most-recent message timestamp
 *   2) windowed user/assistant breakdown → response rate
 * Defensive: on ANY error (missing table, DB down) returns zeros/null instead
 * of throwing, so the caller always gets a usable shape.
 */
async function loadTenantDbMetrics(tenantId: string): Promise<TenantDbMetrics> {
  try {
    // (1) totals: lifetime count + most-recent message; (2) windowed role split.
    const [totalsRes, windowRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS message_count, MAX(created_at) AS last_activity
           FROM messages
          WHERE tenant_id = $1`,
        [tenantId],
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE role = 'user')::int      AS user_count,
                COUNT(*) FILTER (WHERE role = 'assistant')::int AS assistant_count
           FROM messages
          WHERE tenant_id = $1
            AND created_at >= NOW() - make_interval(days => $2::int)`,
        [tenantId, RESPONSE_RATE_WINDOW_DAYS],
      ),
    ]);

    const messageCount = Number(totalsRes.rows[0]?.message_count ?? 0) || 0;
    const lastActivityAt = isoOrNull(totalsRes.rows[0]?.last_activity);
    const userCount = Number(windowRes.rows[0]?.user_count ?? 0) || 0;
    const assistantCount = Number(windowRes.rows[0]?.assistant_count ?? 0) || 0;

    return {
      messageCount,
      responseRate: computeResponseRate(userCount, assistantCount),
      lastActivityAt,
    };
  } catch (err: any) {
    // Degrade gracefully — never throw out of the metrics layer.
    console.error(
      "[metrics] tenant DB metrics failed:",
      err?.message ?? err,
    );
    return { messageCount: 0, responseRate: 0, lastActivityAt: null };
  }
}

/** Distinct tenant ids seen in `messages` (bounded). [] on error. */
async function listTenantIds(): Promise<string[]> {
  try {
    const r = await pool.query(
      `SELECT DISTINCT tenant_id
         FROM messages
        WHERE tenant_id IS NOT NULL
        ORDER BY tenant_id
        LIMIT $1`,
      [MAX_FLEET_TENANTS],
    );
    return r.rows
      .map((row: any) => String(row.tenant_id))
      .filter((id: string) => id.length > 0);
  } catch (err: any) {
    console.error("[metrics] tenant id enumeration failed:", err?.message ?? err);
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Real metrics for a single bot/tenant. The DB read and the latency probe run
 * concurrently; the probe never throws (null on failure) and the DB layer is
 * guarded, so this resolves to a complete BotMetrics even when degraded.
 */
export async function getBotMetrics(tenantId: string): Promise<BotMetrics> {
  const servingUrl = resolveServingUrl();
  const [measuredLatencyMs, db] = await Promise.all([
    probeLatency(servingUrl),
    loadTenantDbMetrics(tenantId),
  ]);

  return {
    tenantId,
    messageCount: db.messageCount,
    measuredLatencyMs,
    responseRate: db.responseRate,
    lastActivityAt: db.lastActivityAt,
    hostingLocation: resolveHostingLocation(),
  };
}

/**
 * Real metrics for the whole fleet. When `tenantIds` is omitted, the distinct
 * tenants are derived from `messages` (bounded by MAX_FLEET_TENANTS).
 *
 * PERFORMANCE: all bots share one serving process, so the serving URL is
 * probed exactly ONCE and the measured latency is reused for every tenant —
 * this avoids N redundant network probes for a single shared endpoint.
 */
export async function getFleetMetrics(
  tenantIds?: string[],
): Promise<BotMetrics[]> {
  const ids =
    tenantIds && tenantIds.length > 0
      ? Array.from(new Set(tenantIds))
      : await listTenantIds();

  if (ids.length === 0) return [];

  // Probe the shared serving URL ONCE; reuse for all tenants (see note above).
  const measuredLatencyMs = await probeLatency(resolveServingUrl());
  const hostingLocation = resolveHostingLocation();

  return Promise.all(
    ids.map(async (tenantId): Promise<BotMetrics> => {
      const db = await loadTenantDbMetrics(tenantId);
      return {
        tenantId,
        messageCount: db.messageCount,
        measuredLatencyMs,
        responseRate: db.responseRate,
        lastActivityAt: db.lastActivityAt,
        hostingLocation,
      };
    }),
  );
}
