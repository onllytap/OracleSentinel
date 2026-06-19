// ============================================================================
// Command Center API client — talks to the backend (proxied /api → :3001).
// Cookie-based session (admin_session HttpOnly) + CSRF double-submit.
// ============================================================================

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
