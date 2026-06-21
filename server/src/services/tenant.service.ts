// ============================================================================
// tenant.service.ts — Agency provisioning (R19, Wave 1 / T3)
// ============================================================================
// Provisions a new agency (tenant): derives a stable tenantId, mints a unique
// widget_id, inserts the row (status 'active'), and returns a copyable embed
// snippet. Also exposes read helpers + a FAIL-OPEN servability check used by
// the widget hot path.
//
// SAFETY:
//   - The `tenants` table holds NO secrets; this service never logs or returns
//     secret material. Error logging is limited to messages (never payloads).
//   - isTenantServable() FAILS OPEN: a missing row OR any DB error => `true`,
//     so historical tenants (e.g. 'default') and transient DB hiccups never
//     break serving. Only an explicit 'suspended'/'archived' status => `false`.
//   - All DB-touching reads are defensive (try/catch) and degrade gracefully.
// ============================================================================

import { pool } from "../db/pool";
import { randomBytes } from "crypto";

export type TenantStatus = "active" | "suspended" | "archived";

export interface TenantRecord {
  tenantId: string;
  name: string;
  widgetId: string;
  status: TenantStatus;
  plan: string;
  createdAt: string;
  updatedAt: string;
}

// ── Constants / validation ───────────────────────────────────────────────────

const VALID_STATUSES: readonly TenantStatus[] = [
  "active",
  "suspended",
  "archived",
];
// R19 tenantId shape: must start alphanumeric, then [a-zA-Z0-9_-], 1..100 chars.
const TENANT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const DEFAULT_PLAN = "starter";
const DEFAULT_BASE_URL = "https://api.oraclesentinel.com";
const MAX_NAME = 160;
const PROVISION_MAX_ATTEMPTS = 5;
const SERVABLE_TTL_MS = Number(process.env.TENANT_SERVABLE_CACHE_MS ?? 30000);

// Small in-memory TTL cache for the servability hot path (declared up here so
// setTenantStatus can invalidate an entry the moment a status changes).
const servableCache = new Map<string, { at: number; value: boolean }>();

function isValidStatus(s: unknown): s is TenantStatus {
  return typeof s === "string" && (VALID_STATUSES as readonly string[]).includes(s);
}

const COLUMNS =
  "tenant_id, name, widget_id, status, plan, created_at, updated_at";

function toIso(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value as string);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : "";
}

/** Map a raw DB row into a typed TenantRecord (no secrets in this table). */
function mapRow(row: any): TenantRecord {
  return {
    tenantId: String(row.tenant_id),
    name: String(row.name ?? ""),
    widgetId: String(row.widget_id ?? ""),
    status: isValidStatus(row.status) ? row.status : "active",
    plan: String(row.plan ?? DEFAULT_PLAN),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function cleanPlan(plan: unknown): string {
  if (typeof plan !== "string") return DEFAULT_PLAN;
  const cleaned = plan.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return cleaned || DEFAULT_PLAN;
}

/** Slugify an agency name into a candidate tenantId base (R19-compatible). */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alnum runs → single hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, 80);
}

// ── Read helpers (defensive) ─────────────────────────────────────────────────

export async function listTenants(): Promise<TenantRecord[]> {
  try {
    const r = await pool.query(
      `SELECT ${COLUMNS} FROM tenants ORDER BY created_at DESC`,
    );
    return r.rows.map(mapRow);
  } catch (err: any) {
    console.error("[tenant.service] listTenants failed:", err?.message);
    return [];
  }
}

export async function getTenant(tenantId: string): Promise<TenantRecord | null> {
  if (!tenantId) return null;
  try {
    const r = await pool.query(
      `SELECT ${COLUMNS} FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  } catch (err: any) {
    console.error("[tenant.service] getTenant failed:", err?.message);
    return null;
  }
}

export async function getTenantByWidgetId(
  widgetId: string,
): Promise<TenantRecord | null> {
  if (!widgetId) return null;
  try {
    const r = await pool.query(
      `SELECT ${COLUMNS} FROM tenants WHERE widget_id = $1`,
      [widgetId],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  } catch (err: any) {
    console.error("[tenant.service] getTenantByWidgetId failed:", err?.message);
    return null;
  }
}

// ── Widget id + embed snippet (pure) ─────────────────────────────────────────

/** Mint a url-safe, collision-resistant widget id (e.g. 'wgt_<32 hex>'). */
export function generateWidgetId(): string {
  return "wgt_" + randomBytes(16).toString("hex");
}

/**
 * Build a copyable embed snippet (script loader + <noscript> iframe fallback)
 * that loads /embed?widget_id=<id> from the public base url. Pure function.
 */
export function buildEmbedSnippet(widgetId: string, baseUrl: string): string {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const wid = String(widgetId || "");
  const embedUrl = `${base}/embed?widget_id=${encodeURIComponent(wid)}`;
  return [
    "<!-- OracleSentinel chat widget — paste before </body> -->",
    `<script src="${embedUrl}" data-widget-id="${wid}" async></script>`,
    "<noscript>",
    `  <iframe src="${embedUrl}" title="Assistant" loading="lazy" style="border:0;width:100%;height:600px"></iframe>`,
    "</noscript>",
  ].join("\n");
}

// ── Provisioning ─────────────────────────────────────────────────────────────

async function tenantIdExists(tenantId: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM tenants WHERE tenant_id = $1`, [
    tenantId,
  ]);
  return (r.rowCount ?? r.rows?.length ?? 0) > 0;
}

/**
 * Resolve a stable, unique tenantId. If `provided` is given it is validated
 * (R19 shape) and checked for uniqueness; otherwise we slugify the name and
 * append a numeric (then random) suffix until free.
 */
async function resolveTenantId(
  provided: string | undefined,
  name: string,
): Promise<string> {
  if (provided !== undefined && provided !== null && String(provided).trim() !== "") {
    const id = String(provided).trim();
    if (!TENANT_ID_RE.test(id)) {
      throw new Error("Invalid tenantId");
    }
    if (await tenantIdExists(id)) {
      throw new Error("tenantId already exists");
    }
    return id;
  }

  let base = slugify(name);
  if (!base || !TENANT_ID_RE.test(base)) base = "tenant";

  if (!(await tenantIdExists(base))) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`.slice(0, 100);
    if (!(await tenantIdExists(candidate))) return candidate;
  }
  // Extremely unlikely fallback: random suffix (collision-resistant).
  return `${base}-${randomBytes(4).toString("hex")}`.slice(0, 100);
}

/**
 * True when a unique violation is on the tenant_id / primary key (so retrying
 * with the same id is futile). Anything else (notably widget_id) is retryable.
 */
function isTenantIdConflict(err: any): boolean {
  const constraint = String(err?.constraint ?? "").toLowerCase();
  const detail = String(err?.detail ?? "").toLowerCase();
  return (
    constraint.includes("pkey") ||
    constraint.includes("_tenant_id") ||
    detail.includes("(tenant_id)")
  );
}

/**
 * Provision a new agency. Inserts a row with status 'active' and a unique
 * widget_id (retrying on a widget_id unique-violation). Returns the record plus
 * a copyable embed snippet built from PUBLIC_BASE_URL.
 */
export async function provisionTenant(input: {
  name: string;
  plan?: string;
  tenantId?: string;
}): Promise<{ tenant: TenantRecord; embedSnippet: string }> {
  const name = String(input?.name ?? "").trim().slice(0, MAX_NAME);
  if (!name) {
    throw new Error("Tenant name is required");
  }
  const plan = cleanPlan(input?.plan);
  const baseUrl = process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL;

  // Validation / uniqueness errors here propagate to the caller (4xx at route).
  const tenantId = await resolveTenantId(input?.tenantId, name);

  let lastErr: any = null;
  for (let attempt = 0; attempt < PROVISION_MAX_ATTEMPTS; attempt++) {
    const widgetId = generateWidgetId();
    try {
      const r = await pool.query(
        `INSERT INTO tenants (tenant_id, name, widget_id, status, plan, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())
         RETURNING ${COLUMNS}`,
        [tenantId, name, widgetId, plan],
      );
      const tenant = mapRow(r.rows[0]);
      return { tenant, embedSnippet: buildEmbedSnippet(tenant.widgetId, baseUrl) };
    } catch (err: any) {
      lastErr = err;
      // 23505 = unique_violation. Retry only when it's NOT the tenant_id/PK
      // (a fresh widget_id is minted on the next loop). A tenant_id race is not
      // retryable, so bail out immediately.
      if (err?.code === "23505" && !isTenantIdConflict(err)) {
        continue;
      }
      break;
    }
  }
  console.error("[tenant.service] provisionTenant failed:", lastErr?.message);
  throw new Error("Failed to provision tenant");
}

// ── Status management ────────────────────────────────────────────────────────

/** Validate + apply a new status. Throws 'Tenant not found' when no row. */
export async function setTenantStatus(
  tenantId: string,
  status: TenantStatus,
  actor: string | null,
): Promise<TenantRecord> {
  if (!tenantId || !TENANT_ID_RE.test(tenantId)) {
    throw new Error("Invalid tenantId");
  }
  if (!isValidStatus(status)) {
    throw new Error("Invalid status");
  }

  let rows: any[];
  try {
    const r = await pool.query(
      `UPDATE tenants
          SET status = $2, updated_at = NOW()
        WHERE tenant_id = $1
        RETURNING ${COLUMNS}`,
      [tenantId, status],
    );
    rows = r.rows;
  } catch (err: any) {
    console.error("[tenant.service] setTenantStatus failed:", err?.message);
    throw new Error("Failed to update tenant status");
  }

  if (!rows[0]) {
    throw new Error("Tenant not found");
  }

  // Reflect the change immediately on the servability hot path.
  servableCache.delete(tenantId);
  // Audit breadcrumb (no secrets): who changed what, to which status.
  console.info(
    `[tenant.service] status updated tenant=${tenantId} status=${status} actor=${actor ?? "unknown"}`,
  );
  return mapRow(rows[0]);
}

// ── Servability (FAIL-OPEN) + small TTL cache ────────────────────────────────

/**
 * Is this tenant allowed to be served? FAIL-OPEN by design:
 *   - no tenantId            → true (nothing to gate on)
 *   - no row in `tenants`    → true (historical tenants like 'default')
 *   - any DB error           → true (never break serving on a hiccup)
 *   - status suspended/archived → false (the ONLY way to return false)
 * Successful reads are cached for ~30s; errors are NOT cached (re-checked next).
 */
export async function isTenantServable(tenantId: string): Promise<boolean> {
  if (!tenantId) return true;

  const hit = servableCache.get(tenantId);
  if (hit && Date.now() - hit.at < SERVABLE_TTL_MS) {
    return hit.value;
  }

  try {
    const r = await pool.query(
      `SELECT status FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = r.rows[0];
    if (!row) {
      servableCache.set(tenantId, { at: Date.now(), value: true });
      return true; // fail-open: unknown tenant stays servable
    }
    const status = String(row.status ?? "").toLowerCase();
    const value = !(status === "suspended" || status === "archived");
    servableCache.set(tenantId, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    // FAIL-OPEN on error; do NOT cache so a transient failure can't pin "true".
    console.error(
      "[tenant.service] isTenantServable check failed (fail-open):",
      err?.message,
    );
    return true;
  }
}

/** Test/ops helper — clears the servability TTL cache. */
export function resetTenantCache(): void {
  servableCache.clear();
}
