// ============================================================================
// Surveillance Service — real-time enterprise monitoring wall (/qg)
// ============================================================================
// Powers the Command Center "Mur de surveillance". Unlike the legacy wall
// (which faked "online" from catalog updated_at and faked latency from a hash),
// this service exposes ONLY real signals:
//
//   - Per-agency real-time activity: messages / conversations / leads in the
//     last 24h, and the timestamp of the last chat message.
//   - A derived live status (live / active / idle / offline) computed from the
//     most recent REAL activity (chat message or conversation update).
//   - Recent factory deployments (factory_builds) so a deploy via /factory or
//     the API shows up here immediately.
//   - A fleet-wide, PII-free activity feed (deploys + new leads).
//
// DESIGN (mirrors fleet.service):
//   - Read-only. Builds on collectFleetSnapshot() for the per-agency base, then
//     enriches with a few additional GROUPED queries (no per-tenant N+1 loop).
//   - Resilient: every extra query is guarded; a missing table degrades to 0.
//   - Cached briefly (PRIV_SURVEILLANCE_CACHE_MS, default 6s) so the wall can
//     poll for a near-real-time feel without hammering the database.
//   - Never returns PII (emails/phones) or secrets — only counts, timestamps,
//     derived status and tenant identifiers.
// ============================================================================

import { pool, isDatabaseConfigured } from "../db/pool";
import {
  collectFleetSnapshot,
  type AgencyHealth,
} from "./fleet.service";

export type BotLiveStatus = "live" | "active" | "idle" | "offline";

export interface SurveillanceBot {
  // snake_case fields kept identical to the legacy tenant shape so the existing
  // <BotDetail> drawer keeps working unchanged when a tile is clicked.
  tenant_id: string;
  widgetIds: string[];
  conversation_count: number;
  lead_count: number;
  property_count: number;
  available: number;
  retired: number;
  last_import: string | null;
  last_updated: string | null;
  // enriched per-agency health (same fields ChatbotsView merges from /overview)
  health: AgencyHealth;
  active: boolean;
  conversionRate: number;
  lastImportErrors: number;
  lastImportAt: string | null;
  lastActivityAt: string | null;
  // ── real-time signals (new) ──────────────────────────────────────────────
  liveStatus: BotLiveStatus;
  messages24h: number;
  conversations24h: number;
  leads24h: number;
  lastMessageAt: string | null;
}

export interface DeploymentEvent {
  buildId: string;
  agentName: string | null;
  status: "success" | "failure" | "partial";
  productionReady: boolean;
  crmProvider: string | null;
  llmProvider: string | null;
  durationMs: number | null;
  at: string;
}

export interface ActivityEvent {
  type: "deploy" | "lead";
  tenantId: string | null;
  label: string;
  status?: string;
  at: string;
}

export interface SurveillanceSnapshot {
  generatedAt: string;
  fleet: {
    agencies: number;
    live: number;
    active: number;
    idle: number;
    offline: number;
    conversations24h: number;
    messages24h: number;
    leads24h: number;
    conversationsTotal: number;
    leadsTotal: number;
    avgConversion: number; // fleet-wide leads/conversations, 0..100
    health: { healthy: number; idle: number; attention: number; empty: number };
    lastDeployAt: string | null;
  };
  bots: SurveillanceBot[];
  deployments: DeploymentEvent[];
  activity: ActivityEvent[];
}

const CACHE_MS = Number(process.env.PRIV_SURVEILLANCE_CACHE_MS ?? 6000);
const DAY_MS = 24 * 60 * 60 * 1000;
// "live" = real activity in the last LIVE_WINDOW (near real-time), default 15 min.
const LIVE_WINDOW_MS = Number(process.env.PRIV_LIVE_WINDOW_MS ?? 15 * 60 * 1000);
// "idle" upper bound = the same active window the fleet uses (default 7 days).
const IDLE_WINDOW_MS =
  Number(process.env.PRIV_ACTIVE_WINDOW_DAYS ?? 7) * DAY_MS;

let cache: { at: number; data: SurveillanceSnapshot } | null = null;

function toMillis(value: unknown): number {
  if (!value) return 0;
  const t = new Date(value as any).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isoOrNull(value: unknown): string | null {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

async function safeQuery<T = any>(sql: string): Promise<T[]> {
  try {
    const r = await pool.query(sql);
    return r.rows as T[];
  } catch {
    // Table may not exist yet, or DB temporarily unavailable — degrade to empty.
    return [];
  }
}

/**
 * Classify a bot's live status from its most recent REAL activity timestamp.
 * Pure function (no DB) so it is unit-testable and deterministic.
 */
export function deriveLiveStatus(
  lastActivityMs: number,
  now: number = Date.now(),
): BotLiveStatus {
  if (!lastActivityMs || lastActivityMs <= 0) return "offline";
  const age = now - lastActivityMs;
  if (age < 0) return "live"; // clock skew → treat as just-now
  if (age < LIVE_WINDOW_MS) return "live";
  if (age < DAY_MS) return "active";
  if (age < IDLE_WINDOW_MS) return "idle";
  return "offline";
}

const LIVE_ORDER: Record<BotLiveStatus, number> = {
  live: 0,
  active: 1,
  idle: 2,
  offline: 3,
};

export async function collectSurveillanceSnapshot(): Promise<SurveillanceSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const generatedAt = new Date().toISOString();
  const now = Date.now();

  // Per-agency base (health, totals, conversion, widgets) — cached internally.
  const fleet = await collectFleetSnapshot();

  if (!isDatabaseConfigured) {
    const empty: SurveillanceSnapshot = {
      generatedAt,
      fleet: {
        agencies: 0,
        live: 0,
        active: 0,
        idle: 0,
        offline: 0,
        conversations24h: 0,
        messages24h: 0,
        leads24h: 0,
        conversationsTotal: 0,
        leadsTotal: 0,
        avgConversion: 0,
        health: { healthy: 0, idle: 0, attention: 0, empty: 0 },
        lastDeployAt: null,
      },
      bots: [],
      deployments: [],
      activity: [],
    };
    cache = { at: Date.now(), data: empty };
    return empty;
  }

  // ── Additional grouped real-time queries (one round-trip each) ────────────
  const [msgRows, conv24Rows, lead24Rows, deployRows, recentLeadRows] =
    await Promise.all([
      safeQuery<{
        tenant_id: string;
        messages_24h: number;
        last_message_at: string | null;
      }>(`
        SELECT tenant_id,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS messages_24h,
               MAX(created_at) AS last_message_at
        FROM messages
        GROUP BY tenant_id
      `),
      safeQuery<{ tenant_id: string; conversations_24h: number }>(`
        SELECT tenant_id,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS conversations_24h
        FROM conversations
        GROUP BY tenant_id
      `),
      safeQuery<{ tenant_id: string; leads_24h: number }>(`
        SELECT tenant_id,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS leads_24h
        FROM leads
        GROUP BY tenant_id
      `),
      safeQuery<{
        build_id: string;
        agent_name: string | null;
        status: "success" | "failure" | "partial";
        production_ready: boolean;
        crm_provider: string | null;
        llm_provider: string | null;
        duration_ms: number | null;
        created_at: string;
      }>(`
        SELECT build_id, agent_name, status, production_ready,
               crm_provider, llm_provider, duration_ms, created_at
        FROM factory_builds
        ORDER BY created_at DESC
        LIMIT 20
      `),
      safeQuery<{ tenant_id: string; created_at: string }>(`
        SELECT tenant_id, created_at
        FROM leads
        ORDER BY created_at DESC
        LIMIT 12
      `),
    ]);

  const msgMap = new Map(msgRows.map((r) => [r.tenant_id, r]));
  const conv24Map = new Map(
    conv24Rows.map((r) => [r.tenant_id, r.conversations_24h]),
  );
  const lead24Map = new Map(lead24Rows.map((r) => [r.tenant_id, r.leads_24h]));

  const counts = { live: 0, active: 0, idle: 0, offline: 0 };
  let conversations24h = 0;
  let messages24h = 0;
  let leads24h = 0;

  const bots: SurveillanceBot[] = fleet.agencies.map((a) => {
    const m = msgMap.get(a.tenantId);
    const m24 = m?.messages_24h ?? 0;
    const c24 = conv24Map.get(a.tenantId) ?? 0;
    const l24 = lead24Map.get(a.tenantId) ?? 0;

    const lastMsgMs = toMillis(m?.last_message_at);
    const lastActivityMs = Math.max(lastMsgMs, toMillis(a.lastActivityAt));
    const liveStatus = deriveLiveStatus(lastActivityMs, now);

    counts[liveStatus]++;
    messages24h += m24;
    conversations24h += c24;
    leads24h += l24;

    return {
      tenant_id: a.tenantId,
      widgetIds: a.widgetIds,
      conversation_count: a.conversationCount,
      lead_count: a.leadCount,
      property_count: a.propertyCount,
      available: a.available,
      retired: a.retired,
      last_import: a.lastImportAt,
      last_updated: a.lastActivityAt,
      health: a.health,
      active: a.active,
      conversionRate: a.conversionRate,
      lastImportErrors: a.lastImportErrors,
      lastImportAt: a.lastImportAt,
      lastActivityAt:
        lastActivityMs > 0
          ? new Date(lastActivityMs).toISOString()
          : a.lastActivityAt,
      liveStatus,
      messages24h: m24,
      conversations24h: c24,
      leads24h: l24,
      lastMessageAt: isoOrNull(m?.last_message_at),
    };
  });

  // Operator-friendly order: live first, then by 24h volume, then name.
  bots.sort(
    (x, y) =>
      LIVE_ORDER[x.liveStatus] - LIVE_ORDER[y.liveStatus] ||
      y.messages24h - x.messages24h ||
      x.tenant_id.localeCompare(y.tenant_id),
  );

  const deployments: DeploymentEvent[] = deployRows.map((d) => ({
    buildId: d.build_id,
    agentName: d.agent_name ?? null,
    status: d.status,
    productionReady: !!d.production_ready,
    crmProvider: d.crm_provider ?? null,
    llmProvider: d.llm_provider ?? null,
    durationMs: d.duration_ms ?? null,
    at: new Date(d.created_at).toISOString(),
  }));

  // ── Fleet activity feed (PII-free: no emails/phones, only tenant + time) ───
  const activity: ActivityEvent[] = [];
  for (const d of deployments.slice(0, 8)) {
    const ready = d.productionReady ? " · prod-ready" : "";
    activity.push({
      type: "deploy",
      tenantId: null,
      label: `Déploiement ${d.agentName ?? "agent"} — ${d.status}${ready}`,
      status: d.status,
      at: d.at,
    });
  }
  for (const l of recentLeadRows) {
    activity.push({
      type: "lead",
      tenantId: l.tenant_id,
      label: `Nouveau lead · ${l.tenant_id}`,
      at: new Date(l.created_at).toISOString(),
    });
  }
  activity.sort((a, b) => toMillis(b.at) - toMillis(a.at));

  const conversationsTotal = fleet.summary.conversations;
  const leadsTotal = fleet.summary.leads;
  const avgConversion =
    conversationsTotal > 0
      ? Math.round((leadsTotal / conversationsTotal) * 100)
      : 0;

  const snapshot: SurveillanceSnapshot = {
    generatedAt,
    fleet: {
      agencies: bots.length,
      live: counts.live,
      active: counts.active,
      idle: counts.idle,
      offline: counts.offline,
      conversations24h,
      messages24h,
      leads24h,
      conversationsTotal,
      leadsTotal,
      avgConversion,
      health: fleet.summary.health,
      lastDeployAt: deployments[0]?.at ?? null,
    },
    bots,
    deployments,
    activity: activity.slice(0, 20),
  };

  cache = { at: Date.now(), data: snapshot };
  return snapshot;
}

/** Test/ops helper: drop the cached snapshot so the next call recomputes. */
export function resetSurveillanceCache(): void {
  cache = null;
}
