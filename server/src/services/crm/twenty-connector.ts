// ============================================================================
// TwentyConnector — Twenty CRM adapter (REST + GraphQL)
// ============================================================================

import { pool } from "../../db/pool";
import type { CRMConnector } from "./crm-connector.interface";
import type {
  CdmLead,
  CdmPerson,
  CdmCompany,
  CdmOpportunity,
  CrmPushResult,
  CrmProviderConfig,
  TwentySchemaSnapshot,
} from "./types";
import {
  generateRequestId,
  getLeadKey,
  logDispatchStart,
  logDispatchResult,
  logDispatchError,
  logReadAfterWrite,
  type DispatchContext,
  type DispatchResult,
} from "./instrumentation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number, cfg: RetryConfig): number {
  const delay = cfg.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * cfg.baseDelayMs;
  return Math.min(delay + jitter, cfg.maxDelayMs);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatPhoneNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("33")) digits = digits.substring(2);
  if (digits.startsWith("0")) digits = digits.substring(1);
  if (digits.length >= 9) {
    return `(+33) ${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, 9)}`;
  }
  return `(+33) ${digits}`;
}

// ---------------------------------------------------------------------------
// Failed-lead retry queue
// ---------------------------------------------------------------------------

interface FailedLead {
  lead: CdmLead;
  sessionId: string;
  attempts: number;
  lastAttempt: Date;
  error: string;
}

// ---------------------------------------------------------------------------
// TwentyConnector
// ---------------------------------------------------------------------------

export class TwentyConnector implements CRMConnector {
  readonly providerName = "twenty";

  private config: CrmProviderConfig;
  private pushedSessions = new Map<string, number>(); // sessionId → timestamp
  private failedQueue: FailedLead[] = [];
  private dbInitialized = false;
  private schemaSnapshot: TwentySchemaSnapshot | null = null;
  private configurationValidated = false;

  constructor(config: CrmProviderConfig) {
    this.config = config;
    // Start periodic retry
    setInterval(() => this.retryFailedLeads(), 5 * 60 * 1000);
    // Validate configuration on startup
    this.validateConfiguration();
  }

  // ── Configuration Validation ────────────────────────────────────────

  /**
   * Parse JWT payload without verifying signature (for diagnostic purposes only)
   */
  private parseJwtPayload(): {
    workspaceId?: string;
    type?: string;
    exp?: number;
  } | null {
    try {
      const parts = this.config.apiKey.split(".");
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], "base64").toString("utf-8");
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  /**
   * Validate configuration and log warnings for common misconfigurations
   */
  private validateConfiguration(): void {
    if (this.configurationValidated) return;
    this.configurationValidated = true;

    // Check API key format
    if (!this.config.apiKey) {
      console.error("[Twenty] ⚠️ TWENTY_API_KEY is not set");
      return;
    }

    const jwtPayload = this.parseJwtPayload();
    const baseUrl = this.config.baseUrl.toLowerCase();
    const isCloudUrl = baseUrl.includes("api.twenty.com");

    if (jwtPayload) {
      // Log configuration info (without exposing sensitive data)
      console.log("[Twenty] Configuration:");
      console.log(`  Base URL: ${this.config.baseUrl}`);
      console.log(`  Token Type: JWT (${jwtPayload.type || "unknown"})`);
      console.log(
        `  Workspace: ${jwtPayload.workspaceId?.slice(0, 8) || "N/A"}...`,
      );

      if (jwtPayload.exp) {
        const expDate = new Date(jwtPayload.exp * 1000);
        const isExpired = expDate < new Date();
        if (isExpired) {
          console.error("[Twenty] ⚠️ TOKEN EXPIRED on", expDate.toISOString());
        }
      }

      // Warn if using cloud URL with self-hosted token
      if (isCloudUrl && jwtPayload.workspaceId) {
        console.warn("[Twenty] ⚠️ CONFIGURATION WARNING:");
        console.warn(
          "  Your API key contains a workspace ID, which suggests it was",
        );
        console.warn("  generated on a self-hosted Twenty instance.");
        console.warn("  But TWENTY_API_URL points to api.twenty.com (cloud).");
        console.warn("  ");
        console.warn(
          "  FIX: Update TWENTY_API_URL to your self-hosted domain, OR",
        );
        console.warn("       generate a new API key from api.twenty.com.");
      }
    } else {
      console.log("[Twenty] Configuration:");
      console.log(`  Base URL: ${this.config.baseUrl}`);
      console.log(`  Token Type: Simple (non-JWT)`);
    }
  }

  isConfigured(): boolean {
    return (
      this.config.enabled &&
      this.config.apiKey.length > 0 &&
      this.config.baseUrl.length > 0
    );
  }

  // ── DB dedup table ─────────────────────────────────────────────────

  private async ensureTable(): Promise<void> {
    if (this.dbInitialized) return;
    try {
      await pool.query(`
                CREATE TABLE IF NOT EXISTS crm_pushed_leads (
                    phone VARCHAR(50) PRIMARY KEY,
                    provider VARCHAR(20) NOT NULL DEFAULT 'twenty',
                    session_id VARCHAR(255),
                    record_id VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);
      await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_crm_pushed_leads_created
                ON crm_pushed_leads (created_at)
            `);
      this.dbInitialized = true;
    } catch (e) {
      console.error("[Twenty] Failed to init dedup table:", e);
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Build REST URL for Twenty API.
   * Twenty Core API uses /rest/ prefix for all CRUD operations:
   * /rest/people, /rest/companies, /rest/opportunities
   */
  private restUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    return `${base}/rest/${cleanPath}`;
  }

  private graphqlUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}/graphql`;
  }

  /**
   * Build metadata API URL.
   * Twenty uses /rest/metadata/ for schema discovery
   */
  private metadataUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    return `${base}/rest/metadata/${cleanPath}`;
  }

  /** Generic REST call with retry */
  private async restCall(
    method: string,
    path: string,
    body?: unknown,
    retry: RetryConfig = DEFAULT_RETRY,
  ): Promise<{ ok: boolean; status: number; data: any }> {
    const url = this.restUrl(path);

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = backoff(attempt - 1, retry);
        console.log(
          `[Twenty] Retry ${attempt}/${retry.maxRetries} after ${Math.round(delay)}ms`,
        );
        await sleep(delay);
      }

      try {
        const init: RequestInit = {
          method,
          headers: this.headers(),
        };
        if (body !== undefined) {
          init.body = JSON.stringify(body);
        }

        const res = await fetchWithTimeout(url, init, this.config.timeoutMs);

        // Rate-limited → retry
        if (res.status === 429 && attempt < retry.maxRetries) {
          const retryAfter = parseInt(
            res.headers.get("Retry-After") || "5",
            10,
          );
          await sleep(retryAfter * 1000);
          continue;
        }

        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }

        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        if (attempt === retry.maxRetries) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, status: 0, data: { error: msg } };
        }
      }
    }
    return { ok: false, status: 0, data: { error: "Unknown" } };
  }

  /** Generic GraphQL call */
  private async gqlCall(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ data?: any; errors?: any[] }> {
    const url = this.graphqlUrl();
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ query, variables }),
        },
        this.config.timeoutMs,
      );

      const json = (await res.json()) as { data?: any; errors?: any[] };
      return json;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { errors: [{ message: msg }] };
    }
  }

  // ── Test connection ────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const result = await this.restCall("GET", "people?limit=1");
      if (result.ok) {
        // Verify we can parse the response (proves auth + schema)
        const people = result.data?.data?.people;
        console.log(
          `[Twenty] testConnection OK — found ${Array.isArray(people) ? people.length : "?"} record(s)`,
        );
      }
      return result.ok;
    } catch {
      return false;
    }
  }

  // ── Schema discovery ───────────────────────────────────────────────

  async discoverSchema(): Promise<TwentySchemaSnapshot | null> {
    if (!this.isConfigured()) return null;
    try {
      // Use direct metadata endpoint URL
      const base = this.config.baseUrl.replace(/\/+$/, "");
      const url = `${base}/api/rest/metadata/objects`;

      const res = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: this.headers(),
        },
        this.config.timeoutMs,
      );

      if (!res.ok) {
        console.error("[Twenty] Schema discovery failed:", res.status);
        return null;
      }

      const result = (await res.json()) as any;
      const objects = Array.isArray(result?.data?.objects)
        ? result.data.objects
        : Array.isArray(result?.data)
          ? result.data
          : [];

      const snapshot: TwentySchemaSnapshot = {
        version: "1",
        fetchedAt: new Date().toISOString(),
        objects: objects.map((obj: any) => ({
          nameSingular: obj.nameSingular || obj.name || "",
          namePlural: obj.namePlural || "",
          fields: Array.isArray(obj.fields)
            ? obj.fields.map((f: any) => ({
              name: f.name || "",
              type: f.type || "TEXT",
              isRequired: !!f.isRequired,
              isCustom: !!f.isCustom,
            }))
            : [],
        })),
      };

      this.schemaSnapshot = snapshot;
      console.log(
        `[Twenty] Schema discovered: ${snapshot.objects.length} objects`,
      );
      return snapshot;
    } catch (err) {
      console.error("[Twenty] Schema discovery error:", err);
      return null;
    }
  }

  // ── Dedup ──────────────────────────────────────────────────────────

  async checkDuplicate(phone: string): Promise<boolean> {
    await this.ensureTable();
    try {
      const normalized = formatPhoneNumber(phone);
      const res = await pool.query(
        `SELECT COUNT(*) AS count FROM crm_pushed_leads WHERE phone = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [normalized],
      );
      return parseInt(res.rows[0]?.count || "0") > 0;
    } catch {
      return false;
    }
  }

  // ── Twenty response shape helpers ──────────────────────────────────
  // Twenty REST API has consistent response shapes:
  //   POST /rest/people   → { data: { createPerson: { id, ... } } }
  //   GET  /rest/people   → { data: { people: [...] }, totalCount, pageInfo }
  //   GET  /rest/people/X → { data: { person: { id, ... } } }
  //   PATCH /rest/people/X → { data: { updatePerson: { id, ... } } }

  /** Extract array of records from a GET /rest/{plural} response */
  private extractListRecords(data: any, objectNamePlural: string): any[] {
    // Shape: { data: { people: [...] }, totalCount, pageInfo }
    const nested = data?.data?.[objectNamePlural];
    if (Array.isArray(nested)) return nested;
    // Fallback: data itself is array
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  /** Extract single record from a GET /rest/{plural}/{id} response */
  private extractSingleRecord(
    data: any,
    objectNameSingular: string,
  ): any | null {
    // Shape: { data: { person: { id, ... } } }
    const nested = data?.data?.[objectNameSingular];
    if (nested && typeof nested === "object" && nested.id) return nested;
    // Fallback shapes
    if (data?.data?.id) return data.data;
    if (data?.id) return data;
    return null;
  }

  /** Extract ID from a POST /rest/{plural} (create) response */
  private extractCreateId(data: any, createOpName: string): string | undefined {
    // Shape: { data: { createPerson: { id, ... } } }
    const created = data?.data?.[createOpName];
    if (created?.id) return created.id;
    // Fallback shapes
    if (data?.data?.id) return data.data.id;
    if (data?.id) return data.id;
    return undefined;
  }

  /** Extract ID from a PATCH /rest/{plural}/{id} (update) response */
  private extractUpdateId(data: any, updateOpName: string): string | undefined {
    // Shape: { data: { updatePerson: { id, ... } } }
    const updated = data?.data?.[updateOpName];
    if (updated?.id) return updated.id;
    // Fallback
    if (data?.data?.id) return data.data.id;
    return undefined;
  }

  hasBeenPushed(sessionId: string): boolean {
    return this.pushedSessions.has(sessionId);
  }

  private markPushed(sessionId: string): void {
    this.pushedSessions.set(sessionId, Date.now());
    // Prevent memory leak: purge sessions older than 24h
    if (this.pushedSessions.size > 5000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [key, ts] of this.pushedSessions) {
        if (ts < cutoff) this.pushedSessions.delete(key);
      }
    }
  }

  private async recordPush(
    phone: string,
    sessionId: string,
    recordId?: string,
  ): Promise<void> {
    await this.ensureTable();
    try {
      const normalized = formatPhoneNumber(phone);
      await pool.query(
        `INSERT INTO crm_pushed_leads (phone, provider, session_id, record_id, created_at)
                 VALUES ($1, 'twenty', $2, $3, NOW())
                 ON CONFLICT (phone) DO UPDATE SET session_id = $2, record_id = $3, created_at = NOW()`,
        [normalized, sessionId, recordId || null],
      );
    } catch (e) {
      console.error("[Twenty] Record push error:", e);
    }
  }

  // ── Search ─────────────────────────────────────────────────────────

  async searchByUniqueField(
    objectType: "person" | "company" | "opportunity",
    field: string,
    value: string,
  ): Promise<string | null> {
    const endpoint =
      objectType === "person"
        ? "people"
        : objectType === "company"
          ? "companies"
          : "opportunities";
    const singularMap: Record<string, string> = {
      people: "person",
      companies: "company",
      opportunities: "opportunity",
    };

    // Use REST filter
    const filterParam = encodeURIComponent(
      JSON.stringify({
        [field]: { eq: value },
      }),
    );
    const result = await this.restCall(
      "GET",
      `${endpoint}?filter=${filterParam}&limit=1`,
    );

    if (result.ok) {
      // Use extractListRecords for consistent parsing
      const records = this.extractListRecords(result.data, endpoint);
      if (records.length > 0) return records[0].id;
    }
    return null;
  }

  // ── Upsert Person ──────────────────────────────────────────────────

  /**
   * Compute qualification level from score (0-100)
   * - < 40 → COLD
   * - 40-69 → WARM
   * - >= 70 → HOT
   */
  private computeQualificationLevel(score: number): "COLD" | "WARM" | "HOT" {
    if (score < 40) return "COLD";
    if (score < 70) return "WARM";
    return "HOT";
  }

  async upsertPerson(person: CdmPerson): Promise<CrmPushResult> {
    // Compute derived fields
    const qualificationLevel =
      person.qualificationLevel ||
      (person.qualificationScore != null
        ? this.computeQualificationLevel(person.qualificationScore)
        : undefined);
    // Normalize score to 0-1 range (Twenty displays as percentage)
    const qualificationScoreNormalized =
      person.qualificationScore != null
        ? Math.min(1, Math.max(0, person.qualificationScore / 100))
        : undefined;

    // Build Twenty person payload with all custom fields
    const phoneCountry = process.env.TWENTY_DEFAULT_PHONE_COUNTRY || "FR";

    const payload: Record<string, any> = {
      name: {
        firstName: person.firstName,
        lastName: person.lastName,
      },
      phones: {
        primaryPhoneNumber: person.phone.replace(/\D/g, ""),
        primaryPhoneCountryCode: phoneCountry,
      },
    };

    // ── Custom fields ──────────────────────────────────────────────
    // Read custom field API names from env (defaults match Twenty lowercase)
    const fieldExternalId = process.env.TWENTY_FIELD_EXTERNALID || "externalid";
    const fieldSource = process.env.TWENTY_FIELD_SOURCE || "source";
    const fieldQualificationScore =
      process.env.TWENTY_FIELD_QUALIFICATIONSCORE || "qualificationscore";
    const fieldQualificationLevel =
      process.env.TWENTY_FIELD_QUALIFICATIONLEVEL || "qualificationlevel";
    const defaultSource = process.env.TWENTY_DEFAULT_SOURCE || "CHATBOT";

    const customFieldsEnv = (process.env.TWENTY_CUSTOM_FIELDS || "")
      .trim()
      .toLowerCase();
    const customFieldsEnabled =
      customFieldsEnv === "true" || customFieldsEnv === "1";

    let wroteCustomFields = false;

    if (customFieldsEnabled) {
      console.log("[Twenty] Custom fields ENABLED — adding to payload:");

      if (person.externalId) {
        payload[fieldExternalId] = person.externalId;
        console.log(
          `[Twenty]   ${fieldExternalId} = ${person.externalId.slice(0, 24)}...`,
        );
      }

      payload[fieldSource] = person.source || defaultSource;
      console.log(`[Twenty]   ${fieldSource} = ${payload[fieldSource]}`);

      if (qualificationScoreNormalized != null) {
        payload[fieldQualificationScore] = qualificationScoreNormalized;
        console.log(
          `[Twenty]   ${fieldQualificationScore} = ${qualificationScoreNormalized}`,
        );
      }

      if (qualificationLevel) {
        payload[fieldQualificationLevel] = qualificationLevel;
        console.log(
          `[Twenty]   ${fieldQualificationLevel} = ${qualificationLevel}`,
        );
      }

      // Notes → notesExpertise
      const fieldNotes =
        process.env.TWENTY_FIELD_NOTESEXPERTISE || "notesExpertise";
      const notesValue =
        (person.notes || "").trim() ||
        "Premier contact — à qualifier.";
      payload[fieldNotes] = notesValue;
      console.log(
        `[Twenty]   ${fieldNotes} = ${notesValue.slice(0, 60)}...`,
      );

      wroteCustomFields = true;
    } else {
      console.warn(
        "[Twenty] ⚠️ Custom fields DISABLED (TWENTY_CUSTOM_FIELDS != true)",
      );
      console.warn(
        "[Twenty]   → externalid, source, qualificationscore, qualificationlevel will NOT be written",
      );
      console.warn(
        "[Twenty]   → To enable: set TWENTY_CUSTOM_FIELDS=true in server/.env",
      );
    }

    // Email
    if (person.email) {
      payload.emails = { primaryEmail: person.email };
    }

    // Log final payload keys (no PII values)
    console.log(
      `[Twenty] Payload keys: ${Object.keys(payload).join(", ")} (customFields=${wroteCustomFields})`,
    );

    // ── Idempotent upsert: externalId → email → phone → create ──
    let existingId: string | null = null;

    // 1. Search by externalId (only if custom fields enabled — field must exist)
    if (customFieldsEnabled && person.externalId) {
      existingId = await this.searchByExternalId(person.externalId);
      if (existingId) {
        console.log(
          `[Twenty] Found existing person by externalId: ${person.externalId.slice(0, 20)}`,
        );
      }
    }

    // 2. Fallback: Search by email
    if (!existingId && person.email) {
      existingId = await this.searchByEmail(person.email);
      if (existingId) {
        console.log(`[Twenty] Found existing person by email`);
      }
    }

    // 3. Fallback: Search by phone
    if (!existingId && person.phone) {
      existingId = await this.searchByPhone(person.phone);
      if (existingId) {
        console.log(`[Twenty] Found existing person by phone`);
      }
    }

    // ── UPDATE existing ────────────────────────────────────────────
    if (existingId) {
      const result = await this.restCall(
        "PATCH",
        `people/${existingId}`,
        payload,
      );
      if (result.ok) {
        const confirmedId =
          this.extractUpdateId(result.data, "updatePerson") || existingId;
        console.log(
          `[Twenty] Updated person: ${confirmedId} (customFields=${wroteCustomFields})`,
        );
        return { success: true, recordId: confirmedId };
      }
      console.error(
        `[Twenty] Update FAILED: HTTP ${result.status} — ${JSON.stringify(result.data).slice(0, 300)}`,
      );
      return { success: false, error: `Update failed: HTTP ${result.status}` };
    }

    // ── CREATE new ─────────────────────────────────────────────────
    const result = await this.restCall("POST", "people", payload);
    if (result.ok) {
      // Twenty POST returns: { data: { createPerson: { id, ... } } }
      const id = this.extractCreateId(result.data, "createPerson");

      if (id) {
        console.log(
          `[Twenty] Created person: ${id} (customFields=${wroteCustomFields})`,
        );
        return { success: true, recordId: id };
      }

      // Fallback: search for the record we just created
      console.warn(
        "[Twenty] CREATE response missing ID, searching for record...",
      );
      let fallbackId: string | null = null;
      if (person.externalId && customFieldsEnabled) {
        fallbackId = await this.searchByExternalId(person.externalId);
      }
      if (!fallbackId && person.phone) {
        await sleep(300); // Brief delay for propagation
        fallbackId = await this.searchByPhone(person.phone);
      }

      if (fallbackId) {
        console.log(
          `[Twenty] Found created person via fallback search: ${fallbackId}`,
        );
        return { success: true, recordId: fallbackId };
      }

      // Strict mode: no personId = failure
      const strictRequireId = (process.env.CRM_STRICT_REQUIRE_ID || "")
        .trim()
        .toLowerCase();
      if (strictRequireId === "true" || strictRequireId === "1") {
        console.error(
          "[Twenty] STRICT_REQUIRE_ID: personId not returned and not found — FAIL",
        );
        return {
          success: false,
          error: "STRICT_REQUIRE_ID: personId not returned after create",
        };
      }

      console.warn(
        "[Twenty] Person created but personId unknown — success with degraded tracking",
      );
      return { success: true, recordId: undefined };
    }

    // ── Handle DUPLICATE (400 + duplicate message) ─────────────────
    const resultStr = JSON.stringify(result.data);
    if (result.status === 400 && resultStr.includes("duplicate")) {
      console.log(
        "[Twenty] Duplicate detected on create — searching for existing record...",
      );

      let dupId: string | null = null;
      if (person.phone) {
        dupId = await this.searchByPhone(person.phone);
      }
      if (!dupId && person.email) {
        dupId = await this.searchByEmail(person.email);
      }

      if (dupId) {
        console.log(`[Twenty] Found duplicate: ${dupId}, updating...`);
        const updateResult = await this.restCall(
          "PATCH",
          `people/${dupId}`,
          payload,
        );
        if (updateResult.ok) {
          console.log(
            `[Twenty] Updated duplicate person: ${dupId} (customFields=${wroteCustomFields})`,
          );
          return { success: true, recordId: dupId };
        }
        return {
          success: false,
          error: `Update duplicate failed: HTTP ${updateResult.status}`,
        };
      }

      // Cannot find duplicate — this is a FAILURE, not a silent success
      console.error(
        "[Twenty] Duplicate exists but cannot find by phone/email — recordId unknown",
      );
      return {
        success: false,
        error: "Duplicate detected but record not found for update",
        duplicate: true,
      };
    }

    // ── Handle SCHEMA ERROR (custom field rejected) ────────────────
    if (
      result.status === 400 &&
      (resultStr.includes("doesn't have any") ||
        resultStr.includes("not found in schema"))
    ) {
      console.warn(
        "[Twenty] Custom field rejected by schema — retrying with base fields only",
      );
      console.warn(
        "[Twenty] ⚠️ Create custom fields in Twenty: Settings > Data model > People",
      );
      console.warn(
        `[Twenty] ⚠️ Fields needed: ${fieldExternalId}, ${fieldSource}, ${fieldQualificationScore}, ${fieldQualificationLevel}`,
      );

      const basePayload: Record<string, any> = {
        name: { firstName: person.firstName, lastName: person.lastName },
        phones: {
          primaryPhoneNumber: person.phone.replace(/\D/g, ""),
          primaryPhoneCountryCode: phoneCountry,
        },
      };
      if (person.email) {
        basePayload.emails = { primaryEmail: person.email };
      }

      const retryResult = await this.restCall("POST", "people", basePayload);
      if (retryResult.ok) {
        const id = this.extractCreateId(retryResult.data, "createPerson");
        let finalId = id;

        if (!finalId && person.phone) {
          await sleep(300);
          finalId = (await this.searchByPhone(person.phone)) || undefined;
        }

        console.log(
          `[Twenty] Created person (BASE FIELDS ONLY, no custom): ${finalId || "UNKNOWN"}`,
        );
        return { success: true, recordId: finalId };
      }

      return {
        success: false,
        error: `Create failed even with base fields: HTTP ${retryResult.status}`,
      };
    }

    console.error(
      `[Twenty] Create person FAILED: HTTP ${result.status} — ${resultStr.slice(0, 300)}`,
    );
    return {
      success: false,
      error: `Create person failed: HTTP ${result.status}`,
    };
  }

  // ── Search helpers ──────────────────────────────────────────────────

  /** Search person by externalId (primary idempotence key) */
  private async searchByExternalId(externalId: string): Promise<string | null> {
    try {
      // Use the env-configured field name (default: externalid, all lowercase)
      const fieldName = process.env.TWENTY_FIELD_EXTERNALID || "externalid";
      const filter = encodeURIComponent(
        JSON.stringify({ [fieldName]: { eq: externalId } }),
      );
      const result = await this.restCall(
        "GET",
        `people?filter=${filter}&limit=1`,
      );

      if (result.ok) {
        // Twenty GET list: { data: { people: [...] }, totalCount, pageInfo }
        const records = this.extractListRecords(result.data, "people");
        if (records.length > 0) {
          console.log(`[Twenty] searchByExternalId found: ${records[0].id}`);
          return records[0].id;
        }
      }
      return null;
    } catch (err) {
      console.warn(
        `[Twenty] searchByExternalId error: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Search person by email (fallback idempotence key) */
  private async searchByEmail(email: string): Promise<string | null> {
    if (!email) return null;
    try {
      // Twenty email filter - exact match
      const filter = encodeURIComponent(
        JSON.stringify({
          emails: { primaryEmail: { eq: email.toLowerCase() } },
        }),
      );
      let result = await this.restCall(
        "GET",
        `people?filter=${filter}&limit=1`,
      );

      if (result.ok) {
        const records = this.extractListRecords(result.data, "people");
        if (records.length > 0) {
          console.log(
            `[Twenty] searchByEmail found by filter: ${records[0].id}`,
          );
          return records[0].id;
        }
      }

      // Fallback: manual search through recent records
      result = await this.restCall("GET", "people?limit=50");
      if (!result.ok) return null;

      const allRecords = this.extractListRecords(result.data, "people");
      for (const rec of allRecords) {
        const primaryEmail = rec?.emails?.primaryEmail?.toLowerCase();
        if (primaryEmail === email.toLowerCase()) {
          console.log(`[Twenty] searchByEmail found by scan: ${rec.id}`);
          return rec.id;
        }
      }
      return null;
    } catch (err) {
      console.warn(
        `[Twenty] searchByEmail error: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Search person by phone (last fallback) */
  private async searchByPhone(phone: string): Promise<string | null> {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) return null;

    try {
      // Twenty stores phones in various formats — search manually
      const result = await this.restCall("GET", "people?limit=50");
      if (!result.ok) return null;

      // Use extractListRecords (same as searchByEmail) — fixes response parsing
      const records = this.extractListRecords(result.data, "people");
      if (records.length === 0) return null;

      // Match on last 9 digits (French phone numbers)
      const searchDigits = digits.slice(-9);
      for (const rec of records) {
        const primary = rec?.phones?.primaryPhoneNumber || "";
        const recDigits = primary.replace(/\D/g, "");
        if (recDigits.endsWith(searchDigits)) {
          console.log(`[Twenty] searchByPhone found: ${rec.id}`);
          return rec.id;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Upsert Company ─────────────────────────────────────────────────

  async upsertCompany(company: CdmCompany): Promise<CrmPushResult> {
    const payload: Record<string, any> = {
      name: company.name,
    };
    if (company.domain) {
      payload.domainName = {
        primaryLinkUrl: company.domain,
        primaryLinkLabel: company.name,
      };
    }
    if (company.address) {
      payload.address = {
        addressStreet1: company.address.street || "",
        addressCity: company.address.city || "",
        addressPostcode: company.address.postalCode || "",
        addressCountry: company.address.country || "FR",
      };
    }

    // Try find by domain
    if (company.domain) {
      const existingId = await this.searchByUniqueField(
        "company",
        "domainName",
        company.domain,
      );
      if (existingId) {
        const res = await this.restCall(
          "PATCH",
          `companies/${existingId}`,
          payload,
        );
        return res.ok
          ? { success: true, recordId: existingId }
          : { success: false, error: `Update company failed: ${res.status}` };
      }
    }

    const res = await this.restCall("POST", "companies", payload);
    if (res.ok) {
      const id = res.data?.data?.id || res.data?.id;
      return { success: true, recordId: id };
    }

    // Handle duplicate - company already exists
    if (res.status === 400 && JSON.stringify(res.data).includes("duplicate")) {
      console.log("[Twenty] Company duplicate, treating as success");
      return { success: true, duplicate: true };
    }

    return { success: false, error: `Create company failed: ${res.status}` };
  }

  // ── Upsert Opportunity ─────────────────────────────────────────────

  async upsertOpportunity(
    opp: CdmOpportunity,
    personId?: string,
    companyId?: string,
  ): Promise<CrmPushResult> {
    const stageMap: Record<string, string> = {
      new: "NEW",
      qualified: "QUALIFIED",
      proposal: "PROPOSAL",
      won: "WON",
      lost: "LOST",
    };

    const payload: Record<string, any> = {
      name: opp.name,
      stage: stageMap[opp.stage] || "NEW",
    };
    if (opp.amount != null)
      payload.amount = {
        amountMicros: Math.round(opp.amount * 1_000_000),
        currencyCode: "EUR",
      };
    if (opp.closeDate) payload.closeDate = opp.closeDate;
    if (companyId) payload.companyId = companyId;
    if (personId) payload.pointOfContactId = personId;

    const res = await this.restCall("POST", "opportunities", payload);
    if (res.ok) {
      const id = res.data?.data?.id || res.data?.id;
      return { success: true, recordId: id };
    }
    return {
      success: false,
      error: `Create opportunity failed: ${res.status}`,
    };
  }

  // ── Link person to company ─────────────────────────────────────────

  async linkPersonToCompany(
    personId: string,
    companyId: string,
  ): Promise<CrmPushResult> {
    const res = await this.restCall("PATCH", `people/${personId}`, {
      companyId,
    });
    return res.ok
      ? { success: true, recordId: personId }
      : { success: false, error: `Link failed: ${res.status}` };
  }

  // ── Push full lead (orchestrator) ──────────────────────────────────

  async pushLead(lead: CdmLead, sessionId: string): Promise<CrmPushResult> {
    const startTime = Date.now();
    const requestId = generateRequestId();
    const leadKey = getLeadKey(
      lead.person.externalId,
      lead.person.email,
      lead.person.phone,
    );

    // Build dispatch context for structured logging
    const ctx: DispatchContext = {
      requestId,
      provider: this.providerName,
      sessionId,
      score: lead.qualificationScore || 0,
      missingCount: 0, // Lead is already qualified
    };

    // Log dispatch start
    logDispatchStart(ctx, leadKey);

    // Early exit: not configured
    if (!this.isConfigured()) {
      const result: DispatchResult = {
        ok: false,
        mode: "noop",
        error: "Twenty not configured",
        durationMs: Date.now() - startTime,
      };
      logDispatchResult(ctx, result);
      return { success: false, error: "Twenty not configured" };
    }

    // NOTE: Removed hasBeenPushed(sessionId) check that was blocking updates
    // The upsertPerson method handles idempotency via externalId/phone search
    // This allows subsequent pushes in the same session to UPDATE the record

    // NOTE: Removed checkDuplicate(phone) check that was blocking updates for 30 days
    // Idempotency is now handled by upsertPerson via externalId or phone search

    try {
      // 1) Upsert company (if provided)
      let companyId: string | undefined;
      if (lead.company) {
        const compRes = await this.upsertCompany(lead.company);
        if (compRes.success) companyId = compRes.recordId;
      }

      // 2) Upsert person
      const personRes = await this.upsertPerson(lead.person);
      if (!personRes.success) {
        const result: DispatchResult = {
          ok: false,
          mode: "error",
          error: personRes.error,
          durationMs: Date.now() - startTime,
        };
        logDispatchResult(ctx, result);
        logDispatchError(ctx, personRes.error || "Person upsert failed");
        this.enqueueFailed(
          lead,
          sessionId,
          personRes.error || "Person upsert failed",
        );
        return personRes;
      }
      const personId = personRes.recordId;
      const isUpdate = personRes.duplicate === true;

      // 3) Read-after-write verification
      if (personId) {
        const verified = await this.verifyWriteSuccess(
          personId,
          lead.person,
          ctx,
        );
        if (!verified) {
          console.warn("[Twenty] Read-after-write verification FAILED");
          // Continue anyway but log the warning
        }
      }

      // 4) Link person → company
      if (personId && companyId) {
        await this.linkPersonToCompany(personId, companyId);
      }

      // 5) Create opportunity
      const oppName = `${lead.projectType} — ${lead.person.fullName}`.substring(
        0,
        120,
      );
      await this.upsertOpportunity(
        {
          externalId: sessionId,
          name: oppName,
          stage: lead.qualificationScore >= 50 ? "qualified" : "new",
          closeDate: lead.appointmentDate,
          notes: [lead.summary, lead.notes].filter(Boolean).join("\n\n"),
        },
        personId,
        companyId,
      );

      // 6) Add a note with full details
      if (personId) {
        await this.createNote(personId, lead);
      }

      // Success - log result
      const result: DispatchResult = {
        ok: true,
        personId,
        mode: isUpdate ? "update" : "create",
        durationMs: Date.now() - startTime,
      };
      logDispatchResult(ctx, result);

      console.log(
        `[Twenty] Lead pushed successfully — mode=${result.mode}, personId=${personId?.slice(0, 8)}...`,
      );
      this.markPushed(sessionId);
      await this.recordPush(lead.person.phone, sessionId, personId);

      return { success: true, recordId: personId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result: DispatchResult = {
        ok: false,
        mode: "error",
        error: msg,
        durationMs: Date.now() - startTime,
      };
      logDispatchResult(ctx, result);
      logDispatchError(ctx, err instanceof Error ? err : msg);

      console.error("[Twenty] pushLead error:", msg);
      this.enqueueFailed(lead, sessionId, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Read-after-write verification: fetch the person by ID and verify key fields
   */
  private async verifyWriteSuccess(
    personId: string,
    person: CdmPerson,
    ctx: DispatchContext,
  ): Promise<boolean> {
    try {
      const res = await this.restCall("GET", `people/${personId}`);
      if (!res.ok) {
        logReadAfterWrite(ctx, personId, false, ["GET_FAILED"]);
        return false;
      }

      // Use extractSingleRecord for consistent parsing
      // GET /rest/people/{id} → { data: { person: { id, ... } } }
      const record = this.extractSingleRecord(res.data, "person") || res.data?.data || res.data;
      const mismatches: string[] = [];

      // Verify externalId
      if (person.externalId && record.externalId !== person.externalId) {
        mismatches.push(
          `externalId: expected=${person.externalId?.slice(0, 8)}, got=${record.externalId?.slice(0, 8) || "null"}`,
        );
      }

      // Verify source
      if (person.source && record.source !== person.source) {
        mismatches.push(
          `source: expected=${person.source}, got=${record.source || "null"}`,
        );
      }

      // Verify qualificationLevel
      if (
        person.qualificationLevel &&
        record.qualificationLevel !== person.qualificationLevel
      ) {
        mismatches.push(
          `qualificationLevel: expected=${person.qualificationLevel}, got=${record.qualificationLevel || "null"}`,
        );
      }

      const verified = mismatches.length === 0;
      logReadAfterWrite(ctx, personId, verified, mismatches);

      if (!verified) {
        console.warn(
          `[Twenty] Read-after-write mismatches: ${mismatches.join(", ")}`,
        );
      }

      return verified;
    } catch (err) {
      logReadAfterWrite(ctx, personId, false, ["EXCEPTION"]);
      return false;
    }
  }

  /**
   * Create a FORCED structured note attached to a person.
   *
   * P0-B: Every push MUST create a note with:
   * - Problème exprimé / intention
   * - Contexte métier (domaine)
   * - Récap des champs collectés + missingFields + score
   * - Horodatage + sessionId + externalId
   */
  private async createNote(personId: string, lead: CdmLead): Promise<void> {
    const timestamp = new Date().toISOString();
    const qualLevel = lead.person.qualificationLevel || "N/A";

    // ─── Build structured note (P0-B requirement) ───────────────────────
    const body = [
      `══════════════════════════════════════════════════`,
      `📋 FICHE LEAD CHATBOT — ${lead.person.fullName}`,
      `══════════════════════════════════════════════════`,
      ``,
      `🏷️ CONTEXTE MÉTIER`,
      `   Domaine: ${lead.domainName || lead.domain || "Non spécifié"}`,
      `   Type de projet: ${lead.projectType}`,
      ``,
      `🎯 INTENTION / BESOIN`,
      `   ${lead.need || "Non exprimé"}`,
      ``,
      `📍 LOCALISATION`,
      `   ${lead.location || "Non précisée"}`,
      ``,
      `══════════════════════════════════════════════════`,
      `📊 QUALIFICATION`,
      `══════════════════════════════════════════════════`,
      `   Score: ${lead.qualificationScore}/100 (${qualLevel})`,
      `   Statut: ${(lead.missingFields?.length || 0) === 0 ? "COMPLET ✅" : "INCOMPLET ❌"}`,
      ``,
      `📝 CHAMPS COLLECTÉS`,
      `   - Prénom: ${lead.person.firstName || "❌"}`,
      `   - Nom: ${lead.person.lastName || "❌"}`,
      `   - Téléphone: ${lead.person.phone || "❌"}`,
      `   - Email: ${lead.person.email || "❌"}`,
      `   - Type: ${lead.projectType || "❌"}`,
      `   - Besoin: ${lead.need ? "✅" : "❌"}`,
      `   - Localisation: ${lead.location ? "✅" : "❌"}`,
      lead.appointmentDate ? `   - RDV: ${lead.appointmentDate}` : null,
      ``,
      (lead.missingFields?.length || 0) > 0
        ? `⚠️ CHAMPS MANQUANTS: ${lead.missingFields?.join(", ")}`
        : null,
      ``,
      lead.tags?.length ? `🏷️ Tags: ${lead.tags.join(", ")}` : null,
      ``,
      `══════════════════════════════════════════════════`,
      `💬 IMPRESSION AGENT`,
      `══════════════════════════════════════════════════`,
      lead.agentNote || "Nouveau contact, à qualifier.",
      ``,
      `══════════════════════════════════════════════════`,
      `📝 RÉSUMÉ CONVERSATION`,
      `══════════════════════════════════════════════════`,
      lead.summary || "Pas de résumé disponible.",
      ``,
      lead.notes ? `══════════════════════════════════════════════════` : null,
      lead.notes ? `📎 NOTES ADDITIONNELLES` : null,
      lead.notes ? `══════════════════════════════════════════════════` : null,
      lead.notes || null,
      ``,
      `══════════════════════════════════════════════════`,
      `🔍 TRAÇABILITÉ (SYSTÈME)`,
      `══════════════════════════════════════════════════`,
      `   SessionId: ${lead.sessionId || "N/A"}`,
      `   ExternalId: ${lead.person.externalId || "N/A"}`,
      `   Source: ${lead.person.source || "CHATBOT"}`,
      `   Horodatage: ${timestamp}`,
      `══════════════════════════════════════════════════`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    // Log note creation for proof
    console.log(
      `[Twenty] Creating structured note for person ${personId?.slice(0, 8)}...`
    );
    console.log(
      `[Twenty]   Domain: ${lead.domain}, Score: ${lead.qualificationScore}, Missing: ${lead.missingFields?.length || 0}`
    );

    // Twenty uses a "notes" object with body and relations
    const notePayload = {
      title: `Lead ${lead.domainName || "Chatbot"} — ${lead.person.fullName} — ${new Date().toLocaleDateString("fr-FR")}`,
      body,
    };

    const noteRes = await this.restCall("POST", "notes", notePayload);
    if (noteRes.ok) {
      const noteId =
        this.extractCreateId(noteRes.data, "createNote") ||
        noteRes.data?.data?.id ||
        noteRes.data?.id;
      // Attach note to person via noteTarget
      if (noteId) {
        const targetRes = await this.restCall("POST", "noteTargets", {
          noteId,
          personId,
        });
        if (targetRes.ok) {
          console.log(
            `[Twenty] Note created and attached: ${noteId?.slice(0, 8)}...`
          );
        } else {
          console.warn(
            `[Twenty] Note created but attachment failed: ${targetRes.status}`
          );
        }
      }
    } else {
      console.error(
        `[Twenty] Note creation FAILED: HTTP ${noteRes.status} — ${JSON.stringify(noteRes.data).slice(0, 200)}`
      );
    }
  }

  // ── Retry queue ────────────────────────────────────────────────────

  private enqueueFailed(lead: CdmLead, sessionId: string, error: string): void {
    this.failedQueue.push({
      lead,
      sessionId,
      attempts: 1,
      lastAttempt: new Date(),
      error,
    });
  }

  getFailedLeadsCount(): number {
    return this.failedQueue.length;
  }

  async retryFailedLeads(): Promise<void> {
    if (this.failedQueue.length === 0) return;
    console.log(`[Twenty] Retrying ${this.failedQueue.length} failed leads`);

    const batch = [...this.failedQueue];
    this.failedQueue.length = 0;

    for (const item of batch) {
      const result = await this.pushLead(item.lead, item.sessionId);
      if (!result.success && !result.duplicate) {
        if (item.attempts < 10) {
          this.failedQueue.push({
            ...item,
            attempts: item.attempts + 1,
            lastAttempt: new Date(),
            error: result.error || "Unknown",
          });
        } else {
          console.error(
            `[Twenty] Lead permanently failed after ${item.attempts} attempts`,
          );
        }
      }
    }
  }
}
