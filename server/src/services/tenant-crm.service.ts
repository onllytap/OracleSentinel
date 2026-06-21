// ============================================================================
// tenant-crm.service.ts — Per-agency CRM configuration & push (R17 / T1)
// ============================================================================
// Stores a per-tenant CRM configuration in `tenant_crm_configs` (created at boot
// by ensure-db.ts). Secrets (API keys, webhook URLs) are encrypted at rest with
// AES-256-GCM (utils/crypto) and are NEVER returned by the API nor logged.
//
// The public shape exposes only `hasCredentials` (a boolean) — never the secret
// values themselves (R17.3). `pushLeadForTenant` is a fallback-friendly hook:
// when a tenant has no usable CRM it returns `{ handled:false }` so the caller
// keeps the existing GLOBAL push path unchanged (R17 / T6).
//
// Connectors are REUSED from services/crm (AirtableConnector, TwentyConnector).
// A lightweight `WebhookConnector` (defined below) covers generic HTTP webhooks.
// ============================================================================

import { pool } from "../db/pool";
import {
  encryptJson,
  decryptJson,
  isEncryptionConfigured,
} from "../utils/crypto";
import { AirtableConnector, TwentyConnector } from "./crm";
import type {
  CRMConnector,
  CdmLead,
  CdmPerson,
  CdmCompany,
  CdmOpportunity,
  CrmPushResult,
} from "./crm";

// ── Public types ────────────────────────────────────────────────────────────

export type TenantCrmProvider = "none" | "twenty" | "airtable" | "webhook";

/** Canonical field → provider field name mapping (R17.4). */
export interface TenantCrmFieldMapping {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  need?: string;
  qualification?: string;
  notes?: string;
}

/** PUBLIC shape returned by the API — contains NO secret value (R17.3). */
export interface TenantCrmConfigPublic {
  tenantId: string;
  provider: TenantCrmProvider;
  enabled: boolean;
  /** Boolean only — true when encrypted credentials exist. Never the value. */
  hasCredentials: boolean;
  fieldMappings: TenantCrmFieldMapping;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Plaintext secrets — ONLY held in memory on the save path; encrypted at rest.
 *   twenty:   { apiUrl, apiKey }
 *   airtable: { webhookUrl }
 *   webhook:  { url, secret?, headerName? }
 */
export interface TenantCrmSecretsInput {
  [k: string]: string | undefined;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

const PROVIDERS: readonly TenantCrmProvider[] = [
  "none",
  "twenty",
  "airtable",
  "webhook",
];

const FIELD_MAPPING_KEYS: readonly (keyof TenantCrmFieldMapping)[] = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "need",
  "qualification",
  "notes",
];

/** Narrow an arbitrary value to a known provider; unknown → 'none'. */
function normalizeProvider(value: unknown): TenantCrmProvider {
  const s = String(value ?? "none").toLowerCase().trim();
  return (PROVIDERS as readonly string[]).includes(s)
    ? (s as TenantCrmProvider)
    : "none";
}

/** Coerce a DB timestamp (Date | string | null) into an ISO string or null. */
function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    const d = new Date(value as string);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Keep only known mapping keys with non-empty string values. */
function sanitizeMappings(m?: TenantCrmFieldMapping): TenantCrmFieldMapping {
  const out: TenantCrmFieldMapping = {};
  if (!m || typeof m !== "object") return out;
  for (const k of FIELD_MAPPING_KEYS) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

/** Drop empty/undefined/non-string entries so we never persist blanks. */
function cleanSecrets(secrets: TenantCrmSecretsInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets || {})) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

/** True when at least one secret value is present. */
function hasAnySecret(secrets?: TenantCrmSecretsInput): boolean {
  if (!secrets || typeof secrets !== "object") return false;
  return Object.values(secrets).some(
    (v) => typeof v === "string" && v.trim() !== "",
  );
}

interface TenantCrmRow {
  tenant_id?: string;
  provider?: string;
  enabled?: boolean;
  config_encrypted?: string | null;
  field_mappings?: unknown;
  updated_at?: unknown;
  updated_by?: string | null;
}

function readMappings(value: unknown): TenantCrmFieldMapping {
  return value && typeof value === "object"
    ? (value as TenantCrmFieldMapping)
    : {};
}

/** Map a DB row to the PUBLIC shape (never includes secrets). */
function rowToPublic(tenantId: string, row: TenantCrmRow): TenantCrmConfigPublic {
  return {
    tenantId,
    provider: normalizeProvider(row.provider),
    enabled: !!row.enabled,
    hasCredentials: !!row.config_encrypted,
    fieldMappings: readMappings(row.field_mappings),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by ?? null,
  };
}

/** SELECT the raw row (incl. encrypted blob) for internal use only. */
async function selectRow(tenantId: string): Promise<TenantCrmRow | null> {
  const res = await pool.query(
    `SELECT tenant_id, provider, enabled, config_encrypted, field_mappings, updated_at, updated_by
       FROM tenant_crm_configs
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return (res.rows && res.rows[0]) || null;
}

function emptyPublic(tenantId: string): TenantCrmConfigPublic {
  return {
    tenantId,
    provider: "none",
    enabled: false,
    hasCredentials: false,
    fieldMappings: {},
    updatedAt: null,
    updatedBy: null,
  };
}

// ── WebhookConnector — generic HTTP webhook (defined inside this file) ────────
// Stateless adapter implementing CRMConnector: POSTs a mapped JSON payload to
// `secrets.url`, optionally adding an auth header `secrets.headerName:
// secrets.secret`. Granular CRM ops are unsupported (single-shot webhook).

const WEBHOOK_TIMEOUT_MS = 10000;

class WebhookConnector implements CRMConnector {
  readonly providerName = "webhook";

  private readonly url: string;
  private readonly secret?: string;
  private readonly headerName?: string;
  private readonly mappings: TenantCrmFieldMapping;

  constructor(secrets: TenantCrmSecretsInput, fieldMappings: TenantCrmFieldMapping) {
    this.url = typeof secrets?.url === "string" ? secrets.url.trim() : "";
    this.secret =
      typeof secrets?.secret === "string" && secrets.secret !== ""
        ? secrets.secret
        : undefined;
    this.headerName =
      typeof secrets?.headerName === "string" && secrets.headerName.trim() !== ""
        ? secrets.headerName.trim()
        : undefined;
    this.mappings = fieldMappings || {};
  }

  isConfigured(): boolean {
    return this.url.length > 0;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.headerName && this.secret) {
      headers[this.headerName] = this.secret;
    }
    return headers;
  }

  /** Map CdmLead canonical fields to the configured (or default) field names. */
  private mapLead(lead: CdmLead): Record<string, unknown> {
    const m = this.mappings;
    const payload: Record<string, unknown> = {};
    payload[m.firstName || "firstName"] = lead.person?.firstName ?? "";
    payload[m.lastName || "lastName"] = lead.person?.lastName ?? "";
    payload[m.phone || "phone"] = lead.person?.phone ?? "";
    if (lead.person?.email) {
      payload[m.email || "email"] = lead.person.email;
    }
    payload[m.need || "need"] = lead.need ?? "";
    payload[m.qualification || "qualification"] = lead.qualificationScore ?? 0;
    payload[m.notes || "notes"] = lead.notes ?? "";
    return payload;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await this.fetchWithTimeout(this.url, {
        method: "HEAD",
        headers: this.buildHeaders(),
      });
      // Reachable + endpoint not erroring server-side.
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async pushLead(lead: CdmLead, _sessionId: string): Promise<CrmPushResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "webhook_not_configured" };
    }
    try {
      const res = await this.fetchWithTimeout(this.url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(this.mapLead(lead)),
      });
      if (res.ok || res.status < 400) {
        return { success: true };
      }
      return { success: false, error: `webhook_http_${res.status}` };
    } catch {
      // Non-secret error only.
      return { success: false, error: "webhook_request_failed" };
    }
  }

  // ── Granular ops are not supported by a single-shot webhook ──────────────
  async upsertPerson(_person: CdmPerson): Promise<CrmPushResult> {
    return { success: false, error: "unsupported" };
  }

  async upsertCompany(_company: CdmCompany): Promise<CrmPushResult> {
    return { success: false, error: "unsupported" };
  }

  async upsertOpportunity(
    _opportunity: CdmOpportunity,
    _personId?: string,
    _companyId?: string,
  ): Promise<CrmPushResult> {
    return { success: false, error: "unsupported" };
  }

  async linkPersonToCompany(
    _personId: string,
    _companyId: string,
  ): Promise<CrmPushResult> {
    return { success: false, error: "unsupported" };
  }

  async searchByUniqueField(
    _objectType: "person" | "company" | "opportunity",
    _field: string,
    _value: string,
  ): Promise<string | null> {
    return null;
  }

  async checkDuplicate(_phone: string): Promise<boolean> {
    return false;
  }

  hasBeenPushed(_sessionId: string): boolean {
    return false;
  }

  getFailedLeadsCount(): number {
    return 0;
  }

  async retryFailedLeads(): Promise<void> {
    /* stateless webhook — nothing to retry */
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the per-tenant CRM config. NEVER returns secrets — only `hasCredentials`.
 * No row → a safe `{ provider:'none', enabled:false, ... }` default.
 */
export async function getTenantCrmConfig(
  tenantId: string,
): Promise<TenantCrmConfigPublic> {
  const row = await selectRow(tenantId);
  if (!row) return emptyPublic(tenantId);
  return rowToPublic(tenantId, row);
}

/**
 * Upsert the per-tenant CRM config. When `secrets` carry any value, encryption
 * MUST be configured (else throws `encryption_not_configured`) and the secrets
 * are stored encrypted. When no secrets are provided, any existing credentials
 * are preserved. Returns the PUBLIC shape (no secrets).
 */
export async function saveTenantCrmConfig(
  tenantId: string,
  input: {
    provider: TenantCrmProvider;
    enabled: boolean;
    fieldMappings?: TenantCrmFieldMapping;
    secrets?: TenantCrmSecretsInput;
  },
  updatedBy: string | null,
): Promise<TenantCrmConfigPublic> {
  const provider = normalizeProviderStrict(input?.provider);
  const enabled = !!input?.enabled;
  const fieldMappings = sanitizeMappings(input?.fieldMappings);

  // Encrypt secrets only when present; otherwise preserve existing creds.
  let configEncrypted: string | null = null;
  if (hasAnySecret(input?.secrets)) {
    if (!isEncryptionConfigured()) {
      throw new Error("encryption_not_configured");
    }
    configEncrypted = encryptJson(cleanSecrets(input!.secrets!));
  }

  const res = await pool.query(
    `INSERT INTO tenant_crm_configs
        (tenant_id, provider, enabled, config_encrypted, field_mappings, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), $6)
     ON CONFLICT (tenant_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        enabled = EXCLUDED.enabled,
        config_encrypted = COALESCE(EXCLUDED.config_encrypted, tenant_crm_configs.config_encrypted),
        field_mappings = EXCLUDED.field_mappings,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
     RETURNING tenant_id, provider, enabled, config_encrypted, field_mappings, updated_at, updated_by`,
    [
      tenantId,
      provider,
      enabled,
      configEncrypted,
      JSON.stringify(fieldMappings),
      updatedBy,
    ],
  );

  const row = res.rows && res.rows[0];
  if (!row) {
    // Defensive fallback (RETURNING should always yield a row).
    return {
      tenantId,
      provider,
      enabled,
      hasCredentials: configEncrypted != null,
      fieldMappings,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy ?? null,
    };
  }
  return rowToPublic(tenantId, row);
}

/** Like normalizeProvider but throws on unknown — used on the write path. */
function normalizeProviderStrict(value: unknown): TenantCrmProvider {
  const s = String(value ?? "").toLowerCase().trim();
  if (!(PROVIDERS as readonly string[]).includes(s)) {
    throw new Error("invalid_provider");
  }
  return s as TenantCrmProvider;
}

/**
 * Build a connector for a tenant, REUSING the existing connector classes.
 * Returns null for 'none' (or unknown). Never throws.
 */
export function buildTenantConnector(
  provider: TenantCrmProvider,
  secrets: TenantCrmSecretsInput,
  fieldMappings: TenantCrmFieldMapping,
): CRMConnector | null {
  const s = secrets || {};
  switch (provider) {
    case "twenty":
      return new TwentyConnector({
        provider: "twenty",
        enabled: true,
        baseUrl: s.apiUrl || "",
        apiKey: s.apiKey || "",
        timeoutMs: 10000,
      });
    case "airtable":
      return new AirtableConnector({
        provider: "airtable",
        enabled: true,
        baseUrl: s.webhookUrl || "",
        apiKey: "",
        timeoutMs: 10000,
      });
    case "webhook":
      return new WebhookConnector(s, fieldMappings || {});
    case "none":
    default:
      return null;
  }
}

/**
 * Push a lead through the tenant's own CRM, if configured & usable.
 *   - Not configured / disabled / no encryption / no credentials → { handled:false }
 *     (the caller keeps the existing GLOBAL push, unchanged).
 *   - Otherwise decrypt secrets, build the connector and push.
 * NEVER throws — any failure is reported as a non-secret result and logged
 * without credentials.
 */
export async function pushLeadForTenant(
  tenantId: string,
  lead: CdmLead,
  sessionId: string,
): Promise<{ handled: boolean; result?: CrmPushResult }> {
  try {
    const row = await selectRow(tenantId);
    const provider = normalizeProvider(row?.provider);
    const enabled = !!row?.enabled;
    const configEncrypted = (row?.config_encrypted ?? null) as string | null;

    if (
      provider === "none" ||
      !enabled ||
      !isEncryptionConfigured() ||
      !configEncrypted
    ) {
      return { handled: false };
    }

    const secrets = decryptJson<TenantCrmSecretsInput>(configEncrypted);
    const connector = buildTenantConnector(
      provider,
      secrets,
      readMappings(row?.field_mappings),
    );
    if (!connector) return { handled: false };

    const result = await connector.pushLead(lead, sessionId);
    return { handled: true, result };
  } catch (err) {
    // Non-secret diagnostic only — never log credentials.
    console.error(
      "[tenant-crm] pushLeadForTenant failed",
      tenantId,
      (err as Error)?.message,
    );
    return {
      handled: true,
      result: { success: false, error: "tenant_crm_push_failed" },
    };
  }
}

/**
 * Test the tenant's CRM connection. Returns a generic, NON-secret message.
 */
export async function testTenantCrmConnection(
  tenantId: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const row = await selectRow(tenantId);
    const provider = normalizeProvider(row?.provider);
    const configEncrypted = (row?.config_encrypted ?? null) as string | null;

    if (provider === "none") {
      return { ok: false, message: "No CRM provider configured for this tenant" };
    }
    if (!configEncrypted) {
      return { ok: false, message: "No credentials configured for this tenant" };
    }
    if (!isEncryptionConfigured()) {
      return { ok: false, message: "Encryption is not configured on this server" };
    }

    const secrets = decryptJson<TenantCrmSecretsInput>(configEncrypted);
    const connector = buildTenantConnector(
      provider,
      secrets,
      readMappings(row?.field_mappings),
    );
    if (!connector) {
      return { ok: false, message: "Unsupported CRM provider" };
    }

    const ok = await connector.testConnection();
    return {
      ok,
      message: ok ? "Connection successful" : "Connection failed",
    };
  } catch (err) {
    console.error(
      "[tenant-crm] testTenantCrmConnection failed",
      tenantId,
      (err as Error)?.message,
    );
    return { ok: false, message: "Connection test error" };
  }
}
