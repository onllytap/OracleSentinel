// ============================================================================
// Command Center API client — talks to the backend (proxied /api → :3001).
// Cookie-based session (admin_session HttpOnly) + CSRF double-submit.
// ============================================================================

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

function readCookie(name: string): string {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const method = (opts.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (!["GET", "HEAD"].includes(method)) {
    headers["X-CSRF-Token"] = readCookie("csrf_token");
    if (opts.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }
  return fetch(path, { ...opts, method, headers, credentials: "same-origin" });
}

export async function getJSON<T = any>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function login(key: string): Promise<void> {
  const res = await apiFetch("/api/admin/session", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Clé invalide.");
    if (res.status === 503) throw new Error("ADMIN_API_KEY non configurée côté serveur.");
    throw new Error(`Échec de connexion (${res.status}).`);
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
}

export async function checkSession(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/admin/status");
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Passkey (WebAuthn) — passwordless QG login. ADMIN_API_KEY stays as fallback.
// ============================================================================

/** True when the current browser exposes the WebAuthn API at all. */
export function passkeySupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** Whether at least one passkey is enrolled server-side (drives the login UI). */
export async function passkeyAvailable(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/admin/passkey/available");
    if (!res.ok) return false;
    const j = await res.json();
    return !!j?.available;
  } catch {
    return false;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    return j?.error || fallback;
  } catch {
    return fallback;
  }
}

/** Full passkey login ceremony → on success the admin_session cookie is set. */
export async function passkeyLogin(): Promise<void> {
  const optRes = await apiFetch("/api/admin/passkey/auth/options", {
    method: "POST",
    body: "{}",
  });
  if (!optRes.ok) {
    throw new Error(await readError(optRes, "Impossible de démarrer la connexion par passkey."));
  }
  const optionsJSON = await optRes.json();

  const response = await startAuthentication({ optionsJSON });

  const verifyRes = await apiFetch("/api/admin/passkey/auth/verify", {
    method: "POST",
    body: JSON.stringify({ response }),
  });
  if (!verifyRes.ok) {
    throw new Error(await readError(verifyRes, "Connexion par passkey refusée."));
  }
}

/** Full passkey enrollment ceremony (requires an active admin session). */
export async function passkeyRegister(label?: string): Promise<void> {
  const optRes = await apiFetch("/api/admin/passkey/register/options", {
    method: "POST",
    body: "{}",
  });
  if (!optRes.ok) {
    throw new Error(await readError(optRes, "Impossible de démarrer l'enrôlement."));
  }
  const optionsJSON = await optRes.json();

  const response = await startRegistration({ optionsJSON });

  const verifyRes = await apiFetch("/api/admin/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({ response, label }),
  });
  if (!verifyRes.ok) {
    throw new Error(await readError(verifyRes, "Enrôlement de la passkey refusé."));
  }
}

export interface PasskeyInfo {
  credentialId: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export async function passkeyList(): Promise<PasskeyInfo[]> {
  const res = await apiFetch("/api/admin/passkey/list");
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.passkeys) ? j.passkeys : [];
}

export async function passkeyDelete(credentialId: string): Promise<void> {
  const res = await apiFetch(`/api/admin/passkey/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res, `Suppression impossible (HTTP ${res.status}).`));
}

// ============================================================================
// Clients (CRM) — owner records that group one or more chatbots (tenants).
// Reads go through getJSON; writes through apiFetch (CSRF auto-sent) and throw a
// helpful message on !res.ok. Mirrors the passkey* helpers above.
// ============================================================================

export interface ClientInfo {
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
  status: "active" | "prospect" | "archived";
  createdAt: string | null;
  updatedAt: string | null;
  tenantIds: string[];
  botCount: number;
}

/** Writable client fields (camelCase). `name` is required when creating. */
export interface ClientInput {
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  legalName?: string | null;
  siren?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  contractRef?: string | null;
  dpaSigned?: boolean;
  documentsUrl?: string | null;
  notes?: string | null;
  status?: ClientInfo["status"];
}

export interface TenantOwner {
  clientId: number;
  clientName: string;
}

export async function listClients(): Promise<ClientInfo[]> {
  const j = await getJSON<{ success: boolean; clients: ClientInfo[] }>("/api/priv/clients");
  return Array.isArray(j?.clients) ? j.clients : [];
}

export async function getClient(id: number): Promise<ClientInfo> {
  const j = await getJSON<{ success: boolean; client: ClientInfo }>(
    `/api/priv/clients/${encodeURIComponent(id)}`,
  );
  return j.client;
}

export async function createClient(input: ClientInput): Promise<ClientInfo> {
  const res = await apiFetch("/api/priv/clients", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Création du client impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return j.client;
}

export async function updateClient(id: number, input: ClientInput): Promise<ClientInfo> {
  const res = await apiFetch(`/api/priv/clients/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Mise à jour du client impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return j.client;
}

export async function deleteClient(id: number): Promise<void> {
  const res = await apiFetch(`/api/priv/clients/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res, `Suppression du client impossible (HTTP ${res.status}).`));
}

export async function assignTenantToClient(clientId: number, tenantId: string): Promise<void> {
  const res = await apiFetch(`/api/priv/clients/${encodeURIComponent(clientId)}/tenants`, {
    method: "POST",
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) throw new Error(await readError(res, `Assignation impossible (HTTP ${res.status}).`));
}

export async function unassignTenantFromClient(clientId: number, tenantId: string): Promise<void> {
  const res = await apiFetch(
    `/api/priv/clients/${encodeURIComponent(clientId)}/tenants/${encodeURIComponent(tenantId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res, `Retrait impossible (HTTP ${res.status}).`));
}

export async function getTenantOwners(): Promise<Record<string, TenantOwner>> {
  const j = await getJSON<{ success: boolean; owners: Record<string, TenantOwner> }>(
    "/api/priv/tenant-owners",
  );
  return j?.owners || {};
}

// ============================================================================
// Wave 3 — per-agency QG screens: tenant CRM, billing, provisioning, metrics,
// redeploy, TOTP, RGPD.
// Reads use getJSON (response is the backend's { success, ...payload }); writes
// use apiFetch (CSRF auto-sent) and throw a helpful message on !res.ok.
// SECURITY: none of these ever return a secret value. The CRM state exposes only
// `hasCredentials` (boolean) — never the key/token/webhook secret.
// ============================================================================

// ── Tenant CRM (R17) ─────────────────────────────────────────────────────────
export type TenantCrmProvider = "none" | "twenty" | "airtable" | "webhook";

export interface TenantCrmConfig {
  tenantId: string;
  provider: TenantCrmProvider;
  enabled: boolean;
  /** Boolean ONLY — true when encrypted credentials exist. Never the value. */
  hasCredentials: boolean;
  fieldMappings: Record<string, string>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TenantCrmInput {
  provider: TenantCrmProvider;
  enabled: boolean;
  fieldMappings?: Record<string, string>;
  /** Sent ONLY on save; encrypted server-side; never returned afterwards. */
  secrets?: Record<string, string>;
}

export async function getTenantCrm(tenantId: string): Promise<TenantCrmConfig> {
  return getJSON<TenantCrmConfig>(`/api/priv/tenants/${encodeURIComponent(tenantId)}/crm`);
}

export async function saveTenantCrm(tenantId: string, input: TenantCrmInput): Promise<TenantCrmConfig> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/crm`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Enregistrement CRM impossible (HTTP ${res.status}).`));
  return res.json();
}

export async function testTenantCrm(tenantId: string): Promise<{ ok: boolean; message: string }> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/crm/test`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res, `Test de connexion impossible (HTTP ${res.status}).`));
  return res.json();
}

// ── Billing & quotas (R18) ─────────────────────────────────────────────────────
export type PlanId = "starter" | "pro" | "scale";
export type UsageKind = "message" | "lead" | "conversation";

export interface PlanDef {
  id: PlanId;
  priceEur: number;
  quotas: Record<UsageKind, number>;
  stripePriceId?: string;
}

export interface TenantBilling {
  plan: PlanId;
  status: string;
  usage: Record<UsageKind, number>;
  quota: Record<UsageKind, number>;
  overQuota: boolean;
  subscription: {
    tenantId: string;
    plan: PlanId;
    status: string;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
  } | null;
}

export async function getPlans(): Promise<PlanDef[]> {
  const j = await getJSON<{ success: boolean; plans: PlanDef[] }>("/api/priv/billing/plans");
  return Array.isArray(j?.plans) ? j.plans : [];
}

export async function getTenantBilling(tenantId: string): Promise<TenantBilling> {
  return getJSON<TenantBilling>(`/api/priv/tenants/${encodeURIComponent(tenantId)}/billing`);
}

export async function setTenantPlan(tenantId: string, plan: PlanId): Promise<TenantBilling> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/billing/plan`, {
    method: "PUT",
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) throw new Error(await readError(res, `Changement de plan impossible (HTTP ${res.status}).`));
  return res.json();
}

// ── Provisioning (R19) ──────────────────────────────────────────────────────────
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

export async function listTenants(): Promise<TenantRecord[]> {
  const j = await getJSON<{ success: boolean; tenants: TenantRecord[] }>("/api/priv/tenants");
  return Array.isArray(j?.tenants) ? j.tenants : [];
}

export async function provisionTenant(input: {
  name: string;
  plan?: string;
  tenantId?: string;
}): Promise<{ tenant: TenantRecord; embedSnippet: string }> {
  const res = await apiFetch("/api/priv/tenants/provision", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Provisioning impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return { tenant: j.tenant, embedSnippet: j.embedSnippet };
}

export async function setTenantStatusApi(tenantId: string, status: TenantStatus): Promise<TenantRecord> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await readError(res, `Changement de statut impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return j.tenant;
}

// ── Real metrics (R6/R7) ──────────────────────────────────────────────────────────
export interface BotMetrics {
  tenantId: string;
  messageCount: number;
  measuredLatencyMs: number | null;
  responseRate: number;
  lastActivityAt: string | null;
  hostingLocation: string;
}

export async function getFleetMetrics(): Promise<BotMetrics[]> {
  const j = await getJSON<{ success: boolean; metrics: BotMetrics[] }>("/api/priv/metrics");
  return Array.isArray(j?.metrics) ? j.metrics : [];
}

export async function getTenantMetrics(tenantId: string): Promise<BotMetrics> {
  return getJSON<BotMetrics>(`/api/priv/tenants/${encodeURIComponent(tenantId)}/metrics`);
}

// ── Redeploy (R3/R4) ────────────────────────────────────────────────────────────────
export type RedeployStatus = "pending" | "in_progress" | "succeeded" | "failed" | "rolled_back";

export interface RedeployState {
  tenantId: string;
  status: RedeployStatus;
  configVersion: number | null;
  activeVersion: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string;
}

export async function getRedeploy(
  tenantId: string,
): Promise<{ state: RedeployState; latestVersion: number | null; outOfDate: boolean }> {
  const j = await getJSON<{
    success: boolean;
    state: RedeployState;
    latestVersion: number | null;
    outOfDate: boolean;
  }>(`/api/priv/tenants/${encodeURIComponent(tenantId)}/redeploy`);
  return { state: j.state, latestVersion: j.latestVersion ?? null, outOfDate: !!j.outOfDate };
}

export async function triggerRedeploy(tenantId: string): Promise<RedeployState> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/redeploy`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  if (!res.ok) throw new Error(await readError(res, `Redéploiement impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return j.state;
}

// ── TOTP (R11–R14) ───────────────────────────────────────────────────────────────────
export interface TotpStatusInfo {
  enrolled: boolean;
  activated: boolean;
}

export async function totpStatus(): Promise<TotpStatusInfo> {
  const j = await getJSON<{ success: boolean; enrolled: boolean; activated: boolean }>(
    "/api/admin/totp/status",
  );
  return { enrolled: !!j?.enrolled, activated: !!j?.activated };
}

export async function totpBegin(): Promise<{ secret: string; otpauthUri: string }> {
  const res = await apiFetch("/api/admin/totp/begin", { method: "POST", body: "{}" });
  if (!res.ok) throw new Error(await readError(res, `Démarrage de l'enrôlement TOTP impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return { secret: j.secret, otpauthUri: j.otpauthUri };
}

export async function totpActivate(code: string): Promise<string[]> {
  const res = await apiFetch("/api/admin/totp/activate", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await readError(res, `Activation TOTP refusée (HTTP ${res.status}).`));
  const j = await res.json();
  return Array.isArray(j?.recoveryCodes) ? j.recoveryCodes : [];
}

export async function totpDisable(opts: { code?: string; recoveryCode?: string }): Promise<void> {
  const res = await apiFetch("/api/admin/totp/disable", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await readError(res, `Désactivation TOTP refusée (HTTP ${res.status}).`));
}

// ── RGPD (export / anonymisation par tenant) ─────────────────────────────────────────
export async function rgpdExport(tenantId: string): Promise<any> {
  return getJSON(`/api/priv/tenants/${encodeURIComponent(tenantId)}/rgpd/export`);
}

export async function rgpdAnonymize(tenantId: string): Promise<{ anonymized: number }> {
  const res = await apiFetch(`/api/priv/tenants/${encodeURIComponent(tenantId)}/rgpd`, {
    method: "DELETE",
    body: JSON.stringify({ confirm: true, confirmTenantId: tenantId }),
  });
  if (!res.ok) throw new Error(await readError(res, `Anonymisation impossible (HTTP ${res.status}).`));
  const j = await res.json();
  return { anonymized: j.anonymized ?? 0 };
}
