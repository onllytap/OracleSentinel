// ============================================================================
// Client / CRM Service — customer registry + chatbot ownership (Command Center)
// ============================================================================
// Lets the super-admin QG (/priv) manage end customers ("clients") and know
// which chatbot (tenant) belongs to which client, plus store French legal info
// (legal name, SIREN, VAT number, DPA signed...).
//
// SAFETY:
//   - Every payload goes through sanitizeClientInput(): unknown fields are
//     dropped, strings are trimmed + clamped to the column sizes, status is
//     constrained to a small enum, SIREN is reduced to digits. So a malformed
//     or hostile body can never inject extra columns or oversized data.
//   - All queries are parameterized ($1, $2 ...) — no string interpolation of
//     user values. Column lists come from a hardcoded whitelist.
//   - No secret is ever stored or returned (this module only holds CRM data).
//   - Read paths degrade gracefully (return []/null/{}) when the tables do not
//     exist yet or the DB hiccups — mirrors the other services so the QG never
//     hard-crashes on a cold/partial database.
// ============================================================================

import { pool } from "../db/pool";

// ── Types ────────────────────────────────────────────────────────────────────

export const CLIENT_STATUSES = ["active", "prospect", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface ClientRecord {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  legalName: string | null;
  siren: string | null;
  vatNumber: string | null;
  address: string | null;
  contractRef: string | null;
  dpaSigned: boolean;
  documentsUrl: string | null;
  notes: string | null;
  status: ClientStatus;
  createdAt: string | null;
  updatedAt: string | null;
  /** Tenant (chatbot) ids owned by this client. */
  tenantIds: string[];
  /** Convenience count = tenantIds.length. */
  botCount: number;
}

export interface TenantOwner {
  clientId: number;
  clientName: string;
}

// ── Validation / sanitization ────────────────────────────────────────────────
// Column sizes mirror the DDL in db/ensure-db.ts. TEXT columns get a generous
// soft cap to prevent abuse while staying well within reason.
const LIMITS = {
  name: 160,
  company: 160,
  email: 200,
  phone: 60,
  legal_name: 200,
  siren: 20,
  vat_number: 30,
  contract_ref: 120,
  address: 2000,
  documents_url: 2000,
  notes: 8000,
} as const;

// Canonical tenant id format used across the project (see tenant-config.service
// SEED_TENANT_ID_RE): starts alphanumeric, then [a-zA-Z0-9_-], max 100 chars.
const TENANT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

type FieldKind = "str" | "bool" | "siren" | "status";

interface FieldSpec {
  /** DB column name (whitelisted — never user-controlled). */
  col: string;
  /** Accepted input keys (camelCase first, snake_case alias for robustness). */
  keys: string[];
  kind: FieldKind;
  max?: number;
}

const FIELD_SPECS: FieldSpec[] = [
  { col: "name", keys: ["name"], kind: "str", max: LIMITS.name },
  { col: "company", keys: ["company"], kind: "str", max: LIMITS.company },
  { col: "email", keys: ["email"], kind: "str", max: LIMITS.email },
  { col: "phone", keys: ["phone"], kind: "str", max: LIMITS.phone },
  { col: "legal_name", keys: ["legalName", "legal_name"], kind: "str", max: LIMITS.legal_name },
  { col: "siren", keys: ["siren"], kind: "siren", max: LIMITS.siren },
  { col: "vat_number", keys: ["vatNumber", "vat_number"], kind: "str", max: LIMITS.vat_number },
  { col: "address", keys: ["address"], kind: "str", max: LIMITS.address },
  { col: "contract_ref", keys: ["contractRef", "contract_ref"], kind: "str", max: LIMITS.contract_ref },
  { col: "dpa_signed", keys: ["dpaSigned", "dpa_signed"], kind: "bool" },
  { col: "documents_url", keys: ["documentsUrl", "documents_url"], kind: "str", max: LIMITS.documents_url },
  { col: "notes", keys: ["notes"], kind: "str", max: LIMITS.notes },
  { col: "status", keys: ["status"], kind: "status" },
];

function normStr(v: unknown, max: number): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v).slice(0, max);
  }
  return null; // null / undefined / boolean / object → cleared
}

function normBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    return ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
  }
  return false;
}

function normSiren(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits ? digits.slice(0, max) : null;
}

function normStatus(v: unknown): ClientStatus {
  const s = String(v ?? "").trim().toLowerCase();
  return (CLIENT_STATUSES as readonly string[]).includes(s)
    ? (s as ClientStatus)
    : "active";
}

interface SanitizedPair {
  col: string;
  value: string | boolean | null;
}

/**
 * Whitelist + normalize an arbitrary payload into a list of (column, value)
 * pairs. Only keys actually PRESENT in the input are returned, so the caller
 * can update just the provided columns. Pure + deterministic.
 */
export function sanitizeClientInput(raw: any): SanitizedPair[] {
  const out: SanitizedPair[] = [];
  if (!raw || typeof raw !== "object") return out;

  for (const spec of FIELD_SPECS) {
    let present = false;
    let rawVal: unknown;
    for (const k of spec.keys) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) {
        present = true;
        rawVal = (raw as Record<string, unknown>)[k];
        break;
      }
    }
    if (!present) continue;

    let value: string | boolean | null;
    switch (spec.kind) {
      case "bool":
        value = normBool(rawVal);
        break;
      case "siren":
        value = normSiren(rawVal, spec.max ?? LIMITS.siren);
        break;
      case "status":
        value = normStatus(rawVal);
        break;
      case "str":
      default:
        value = normStr(rawVal, spec.max ?? 200);
        break;
    }
    out.push({ col: spec.col, value });
  }

  return out;
}

/** True for a syntactically valid, positive integer client id. */
function isValidId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

// ── Row mapping ──────────────────────────────────────────────────────────────

const CLIENT_COLUMNS =
  "id, name, company, email, phone, legal_name, siren, vat_number, " +
  "address, contract_ref, dpa_signed, documents_url, notes, status, " +
  "created_at, updated_at";

function mapRow(row: any): Omit<ClientRecord, "tenantIds" | "botCount"> {
  return {
    id: Number(row.id),
    name: row.name,
    company: row.company ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    legalName: row.legal_name ?? null,
    siren: row.siren ?? null,
    vatNumber: row.vat_number ?? null,
    address: row.address ?? null,
    contractRef: row.contract_ref ?? null,
    dpaSigned: Boolean(row.dpa_signed),
    documentsUrl: row.documents_url ?? null,
    notes: row.notes ?? null,
    status: normStatus(row.status),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function getTenantIdsForClient(clientId: number): Promise<string[]> {
  try {
    const res = await pool.query(
      `SELECT tenant_id FROM client_tenants WHERE client_id = $1 ORDER BY tenant_id`,
      [clientId],
    );
    return res.rows.map((r: any) => String(r.tenant_id));
  } catch {
    return [];
  }
}

// ── Reads (resilient: never throw on a missing/cold table) ───────────────────

/**
 * All clients (newest first), each augmented with their tenantIds + botCount.
 * Uses 2 grouped queries stitched in JS — no N+1.
 */
export async function listClients(): Promise<ClientRecord[]> {
  try {
    const clientsRes = await pool.query(
      `SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY created_at DESC, id DESC`,
    );

    let links: any[] = [];
    try {
      const linksRes = await pool.query(
        `SELECT client_id, tenant_id FROM client_tenants`,
      );
      links = linksRes.rows;
    } catch {
      links = [];
    }

    const byClient = new Map<number, string[]>();
    for (const row of links) {
      const cid = Number(row.client_id);
      const arr = byClient.get(cid) ?? [];
      arr.push(String(row.tenant_id));
      byClient.set(cid, arr);
    }

    return clientsRes.rows.map((row: any) => {
      const base = mapRow(row);
      const tenantIds = (byClient.get(base.id) ?? []).sort();
      return { ...base, tenantIds, botCount: tenantIds.length };
    });
  } catch (err: any) {
    console.error("[client.service] listClients failed:", err?.message);
    return [];
  }
}

/** One client + its tenantIds, or null if missing / on DB error. */
export async function getClient(id: number): Promise<ClientRecord | null> {
  if (!isValidId(id)) return null;
  try {
    const res = await pool.query(
      `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    const tenantIds = await getTenantIdsForClient(id);
    const base = mapRow(row);
    return { ...base, tenantIds, botCount: tenantIds.length };
  } catch (err: any) {
    console.error("[client.service] getClient failed:", err?.message);
    return null;
  }
}

/**
 * Map of tenant_id -> owner ({ clientId, clientName }) via a JOIN. Used to label
 * bots with their owning client. Resilient: returns {} on any DB error.
 */
export async function getTenantOwners(): Promise<Record<string, TenantOwner>> {
  try {
    const res = await pool.query(
      `SELECT ct.tenant_id AS tenant_id, c.id AS client_id, c.name AS client_name
       FROM client_tenants ct
       JOIN clients c ON c.id = ct.client_id`,
    );
    const out: Record<string, TenantOwner> = {};
    for (const row of res.rows) {
      out[String(row.tenant_id)] = {
        clientId: Number(row.client_id),
        clientName: String(row.client_name),
      };
    }
    return out;
  } catch (err: any) {
    console.error("[client.service] getTenantOwners failed:", err?.message);
    return {};
  }
}

// ── Writes (throw on real failure → route returns 500) ───────────────────────

/** Insert a sanitized client. Returns the created record (tenantIds: []). */
export async function createClient(input: any): Promise<ClientRecord> {
  const pairs = sanitizeClientInput(input);
  const byCol = new Map(pairs.map((p) => [p.col, p.value]));
  const name = byCol.get("name");
  if (typeof name !== "string" || !name) {
    throw new Error("Client name is required");
  }

  const cols = pairs.map((p) => p.col);
  const placeholders = pairs.map((_, i) => `$${i + 1}`);
  const values = pairs.map((p) => p.value);

  const res = await pool.query(
    `INSERT INTO clients (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING ${CLIENT_COLUMNS}`,
    values,
  );
  const base = mapRow(res.rows[0]);
  return { ...base, tenantIds: [], botCount: 0 };
}

/**
 * Update only the sanitized, PROVIDED keys + updated_at. Returns the updated
 * record (with tenantIds) or null if the client does not exist. A request with
 * no updatable field is a no-op that returns the current record.
 */
export async function updateClient(
  id: number,
  input: any,
): Promise<ClientRecord | null> {
  if (!isValidId(id)) return null;

  const pairs = sanitizeClientInput(input);
  if (pairs.length === 0) {
    // Nothing to change — return the current record as-is.
    return getClient(id);
  }

  const setClauses = pairs.map((p, i) => `${p.col} = $${i + 1}`);
  const values: (string | boolean | null | number)[] = pairs.map((p) => p.value);
  setClauses.push("updated_at = NOW()");
  const idParam = `$${values.length + 1}`;
  values.push(id);

  const res = await pool.query(
    `UPDATE clients SET ${setClauses.join(", ")}
     WHERE id = ${idParam}
     RETURNING ${CLIENT_COLUMNS}`,
    values,
  );
  const row = res.rows[0];
  if (!row) return null;
  const tenantIds = await getTenantIdsForClient(id);
  const base = mapRow(row);
  return { ...base, tenantIds, botCount: tenantIds.length };
}

/** Delete a client (cascade removes its client_tenants links). */
export async function deleteClient(id: number): Promise<boolean> {
  if (!isValidId(id)) return false;
  const res = await pool.query(`DELETE FROM clients WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Assign a tenant (chatbot) to a client. A tenant has a SINGLE owner: any prior
 * ownership row for that tenant is removed first, atomically, then the new link
 * is inserted (ON CONFLICT DO NOTHING as a final safety net).
 */
export async function assignTenant(
  clientId: number,
  tenantId: string,
): Promise<void> {
  if (!isValidId(clientId)) {
    throw new Error("Invalid client id");
  }
  const tid = String(tenantId ?? "").trim();
  if (!TENANT_ID_RE.test(tid)) {
    throw new Error("Invalid tenant id");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Single owner per tenant: drop any existing ownership for this tenant.
    await client.query(`DELETE FROM client_tenants WHERE tenant_id = $1`, [tid]);
    await client.query(
      `INSERT INTO client_tenants (client_id, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT (client_id, tenant_id) DO NOTHING`,
      [clientId, tid],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Remove a tenant<->client link. Returns true if a row was removed. */
export async function unassignTenant(
  clientId: number,
  tenantId: string,
): Promise<boolean> {
  if (!isValidId(clientId)) return false;
  const tid = String(tenantId ?? "").trim();
  if (!tid) return false;
  const res = await pool.query(
    `DELETE FROM client_tenants WHERE client_id = $1 AND tenant_id = $2`,
    [clientId, tid],
  );
  return (res.rowCount ?? 0) > 0;
}
