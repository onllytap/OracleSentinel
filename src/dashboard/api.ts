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
