// ============================================================================
// Fleet Service — Multi-tenant supervision for the Command Center (/priv)
// ============================================================================
// Produces a single, bounded snapshot of the whole fleet of chatbots (one per
// real-estate agency / tenant) so the super-admin can supervise 350+ agencies
// from one screen.
//
// DESIGN:
//   - Read-only. Uses ONLY grouped/aggregate queries (no per-tenant N+1 loop),
//     so it scales to hundreds of tenants with a handful of SQL round-trips.
//   - Resilient: every query is independently guarded; a missing table never
//     breaks the snapshot (degrades gracefully like the existing admin routes).
//   - Cached briefly (PRIV_OVERVIEW_CACHE_MS, default 10s) so the dashboard can
//     poll without hammering the database.
//   - Never returns PII or secrets — only counts, timestamps and derived health.
// ============================================================================

import { pool, isDatabaseConfigured } from "../db/pool";

export type AgencyHealth = "healthy" | "idle" | "attention" | "empty";

export interface AgencyReport {
  tenantId: string;
  widgetIds: string[];
  propertyCount: number;
  available: number;
  retired: number;
  conversationCount: number;
  leadCount: number;
  conversionRate: number; // leads / conversations, 0..100
  lastActivityAt: string | null; // most recent of conversation / catalog update
  lastImportAt: string | null;
  lastImportErrors: number;
  active: boolean; // activity within ACTIVE_WINDOW_DAYS
  health: AgencyHealth;
}

export interface FleetSnapshot {
  generatedAt: string;
  summary: {
    agencies: number;
    activeAgencies: number;
    properties: number;
    conversations: number;
    messages: number;
    leads: number;
    health: { healthy: number; idle: number; attention: number; empty: number };
  };
  agencies: AgencyReport[];
}

const CACHE_MS = Number(process.env.PRIV_OVERVIEW_CACHE_MS ?? 10000);
const ACTIVE_WINDOW_DAYS = Number(process.env.PRIV_ACTIVE_WINDOW_DAYS ?? 7);
const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

let cache: { at: number; data: FleetSnapshot } | null = null;

/** Parse WIDGET_TENANT_MAP ("widgetId:tenantId,...") → reverse map tenant→widgetIds. */
function parseWidgetTenantsReverse(): Record<string, string[]> {
  const raw = (process.env.WIDGET_TENANT_MAP || "default:default")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  const reverse: Record<string, string[]> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [widgetId, tenantId] = trimmed.split(":").map((s) => s.trim());
    if (widgetId && tenantId) {
      if (!reverse[tenantId]) reverse[tenantId] = [];
      reverse[tenantId].push(widgetId);
    }
  }
  return reverse;
}

async function safeQuery<T = any>(sql: string): Promise<T[]> {
  try {
    const r = await pool.query(sql);
    return r.rows as T[];
  } catch {
    // Table may not exist yet, or DB temporarily unavailable — degrade gracefully.
    return [];
  }
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  const t = new Date(value as any).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isoOrNull(value: unknown): string | null {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export function deriveHealth(a: {
  propertyCount: number;
  lastImportErrors: number;
  active: boolean;
}): AgencyHealth {
  if (a.propertyCount === 0) return "empty"; // configured but no catalog imported
  if (a.lastImportErrors > 0) return "attention"; // last import had errors
  if (!a.active) return "idle"; // no recent activity
  return "healthy";
}

export async function collectFleetSnapshot(): Promise<FleetSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const generatedAt = new Date().toISOString();

  if (!isDatabaseConfigured) {
    const empty: FleetSnapshot = {
      generatedAt,
      summary: {
        agencies: 0,
        activeAgencies: 0,
        properties: 0,
        conversations: 0,
        messages: 0,
        leads: 0,
        health: { healthy: 0, idle: 0, attention: 0, empty: 0 },
      },
      agencies: [],
    };
    cache = { at: Date.now(), data: empty };
    return empty;
  }

  // ── Grouped queries (one round-trip each, no per-tenant loop) ─────────────
  const [propRows, convRows, leadRows, importRows, msgCountRows] =
    await Promise.all([
      safeQuery<{
        tenant_id: string;
        property_count: number;
        available: number;
        retired: number;
        last_catalog_update: string | null;
      }>(`
        SELECT tenant_id,
               COUNT(*)::int AS property_count,
               COUNT(*) FILTER (WHERE statut = 'disponible')::int AS available,
               COUNT(*) FILTER (WHERE statut = 'retire')::int AS retired,
               MAX(updated_at) AS last_catalog_update
        FROM catalog_properties
        GROUP BY tenant_id
      `),
      safeQuery<{ tenant_id: string; conversation_count: number; last_conversation_at: string | null }>(`
        SELECT tenant_id,
               COUNT(*)::int AS conversation_count,
               MAX(updated_at) AS last_conversation_at
        FROM conversations
        GROUP BY tenant_id
      `),
      safeQuery<{ tenant_id: string; lead_count: number }>(`
        SELECT tenant_id, COUNT(*)::int AS lead_count
        FROM leads
        GROUP BY tenant_id
      `),
      safeQuery<{ tenant_id: string; last_import_at: string | null; error_count: number }>(`
        SELECT DISTINCT ON (tenant_id)
               tenant_id,
               COALESCE(committed_at, created_at) AS last_import_at,
               error_count
        FROM catalog_import_runs
        ORDER BY tenant_id, created_at DESC
      `),
      safeQuery<{ c: number }>(`SELECT COUNT(*)::int AS c FROM messages`),
    ]);

  const convMap = new Map(convRows.map((r) => [r.tenant_id, r]));
  const leadMap = new Map(leadRows.map((r) => [r.tenant_id, r.lead_count]));
  const importMap = new Map(importRows.map((r) => [r.tenant_id, r]));
  const widgetReverse = parseWidgetTenantsReverse();

  // Union of all tenant ids seen anywhere (data + configured widget map).
  const tenantIds = new Set<string>();
  for (const r of propRows) tenantIds.add(r.tenant_id);
  for (const r of convRows) tenantIds.add(r.tenant_id);
  for (const r of leadRows) tenantIds.add(r.tenant_id);
  for (const r of importRows) tenantIds.add(r.tenant_id);
  for (const tid of Object.keys(widgetReverse)) tenantIds.add(tid);

  const propMap = new Map(propRows.map((r) => [r.tenant_id, r]));
  const now = Date.now();

  const agencies: AgencyReport[] = Array.from(tenantIds)
    .sort()
    .map((tenantId) => {
      const p = propMap.get(tenantId);
      const c = convMap.get(tenantId);
      const imp = importMap.get(tenantId);

      const propertyCount = p?.property_count ?? 0;
      const conversationCount = c?.conversation_count ?? 0;
      const leadCount = leadMap.get(tenantId) ?? 0;
      const lastImportErrors = imp?.error_count ?? 0;

      const lastActivityMs = Math.max(
        toMillis(c?.last_conversation_at),
        toMillis(p?.last_catalog_update),
      );
      const active = lastActivityMs > 0 && now - lastActivityMs < ACTIVE_WINDOW_MS;

      const conversionRate =
        conversationCount > 0
          ? Math.round((leadCount / conversationCount) * 100)
          : 0;

      const health = deriveHealth({ propertyCount, lastImportErrors, active });

      return {
        tenantId,
        widgetIds: widgetReverse[tenantId] || [],
        propertyCount,
        available: p?.available ?? 0,
        retired: p?.retired ?? 0,
        conversationCount,
        leadCount,
        conversionRate,
        lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
        lastImportAt: isoOrNull(imp?.last_import_at),
        lastImportErrors,
        active,
        health,
      };
    });

  const healthCounts = { healthy: 0, idle: 0, attention: 0, empty: 0 };
  let properties = 0;
  let conversations = 0;
  let leads = 0;
  let activeAgencies = 0;
  for (const a of agencies) {
    healthCounts[a.health]++;
    properties += a.propertyCount;
    conversations += a.conversationCount;
    leads += a.leadCount;
    if (a.active) activeAgencies++;
  }

  const snapshot: FleetSnapshot = {
    generatedAt,
    summary: {
      agencies: agencies.length,
      activeAgencies,
      properties,
      conversations,
      messages: msgCountRows[0]?.c ?? 0,
      leads,
      health: healthCounts,
    },
    agencies,
  };

  cache = { at: Date.now(), data: snapshot };
  return snapshot;
}

/** Test/ops helper: drop the cached snapshot so the next call recomputes. */
export function resetFleetCache(): void {
  cache = null;
}
