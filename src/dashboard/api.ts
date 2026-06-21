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
