// ============================================================================
// Cloudflare Service — read-only Workers visibility for the Command Center (/qg)
// ============================================================================
// Phase 1 of the "remote control" roadmap (bibliotheque/ROADMAP_QG_REMOTE_CONTROL.md):
// LIST the deployed Cloudflare Workers and report a REAL live status by
// health-pinging their public *.workers.dev URL (HTTP reachability + latency).
// No writes, no deploys, no deletes — those are later phases.
//
// DESIGN (mirrors infra-monitor / fleet services):
//   - Uses a scoped Cloudflare API token from env. The MCP is a dev tool only;
//     production talks to the Cloudflare REST API directly.
//   - Degrades gracefully: if the token/account is missing, returns a
//     `configured:false` snapshot instead of throwing (the QG shows a hint).
//   - Never returns secret binding VALUES — only their type + name.
//   - Short cache so the wall can poll without hammering the API / network.
// ============================================================================

const CF_API = "https://api.cloudflare.com/client/v4";

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
// workers.dev subdomain (e.g. "neverdiscord666") used to build health-ping URLs.
const SUBDOMAIN = (process.env.CLOUDFLARE_WORKERS_SUBDOMAIN || "").trim();

export const isCloudflareConfigured = Boolean(TOKEN && ACCOUNT_ID);

const PROBE_TIMEOUT_MS = Number(process.env.PRIV_WORKER_PROBE_TIMEOUT_MS ?? 6000);
const API_TIMEOUT_MS = Number(process.env.PRIV_CF_API_TIMEOUT_MS ?? 8000);
const CACHE_MS = Number(process.env.PRIV_WORKERS_CACHE_MS ?? 15000);

export type WorkerStatus = "online" | "degraded" | "down" | "unknown";

export interface WorkerBinding {
  type: string;
  name: string;
}

export interface WorkerReport {
  name: string;
  createdOn: string | null;
  modifiedOn: string | null;
  compatibilityDate: string | null;
  handlers: string[];
  url: string | null;
  status: WorkerStatus;
  httpCode: number | null;
  latencyMs: number | null;
}

export interface WorkersSnapshot {
  generatedAt: string;
  configured: boolean;
  subdomain: string | null;
  summary: { total: number; online: number; degraded: number; down: number; unknown: number };
  workers: WorkerReport[];
  error?: string;
}

export interface WorkerDetail {
  configured: boolean;
  name: string;
  compatibilityDate: string | null;
  compatibilityFlags: string[];
  usageModel: string | null;
  bindings: WorkerBinding[]; // type + name only — never values
  url: string | null;
  status: WorkerStatus;
  httpCode: number | null;
  latencyMs: number | null;
  error?: string;
}

let cache: { at: number; data: WorkersSnapshot } | null = null;

/**
 * Classify a worker's edge status from the HTTP code of a health-ping.
 * Pure function (no I/O) so it is unit-testable.
 * - null code (no response / timeout / DNS)         → down
 * - 5xx (worker throwing / origin error)            → degraded
 * - any other HTTP response (2xx/3xx/4xx reachable) → online
 */
export function classifyWorkerStatus(httpCode: number | null): WorkerStatus {
  if (httpCode == null) return "down";
  if (httpCode >= 500) return "degraded";
  return "online";
}

/** Build the public workers.dev URL for a script, or null if no subdomain known. */
function workerUrl(name: string): string | null {
  if (!SUBDOMAIN) return null;
  return `https://${name}.${SUBDOMAIN}.workers.dev/`;
}

async function cfApi<T = any>(path: string): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const msg =
      (json?.errors || []).map((e: any) => e?.message).filter(Boolean).join("; ") ||
      `Cloudflare API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.result as T;
}

/** Health-ping a worker URL: real HTTP reachability + latency. Never throws. */
async function pingWorker(
  url: string | null,
): Promise<{ status: WorkerStatus; httpCode: number | null; latencyMs: number | null }> {
  if (!url) return { status: "unknown", httpCode: null, latencyMs: null };
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    return { status: classifyWorkerStatus(res.status), httpCode: res.status, latencyMs };
  } catch {
    return { status: "down", httpCode: null, latencyMs: null };
  }
}

function emptySnapshot(error?: string): WorkersSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    configured: isCloudflareConfigured,
    subdomain: SUBDOMAIN || null,
    summary: { total: 0, online: 0, degraded: 0, down: 0, unknown: 0 },
    workers: [],
    ...(error ? { error } : {}),
  };
}

/** List all Workers + real health status. Cached briefly. Never throws. */
export async function collectWorkersSnapshot(): Promise<WorkersSnapshot> {
  if (!isCloudflareConfigured) return emptySnapshot();
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let scripts: any[];
  try {
    scripts = await cfApi<any[]>(`/accounts/${ACCOUNT_ID}/workers/scripts`);
  } catch (err: any) {
    // API error (bad token, network) → degrade with a message, don't throw.
    return emptySnapshot(err?.message || "Cloudflare API error");
  }

  const workers: WorkerReport[] = await Promise.all(
    (scripts || []).map(async (s: any) => {
      const name = String(s.id);
      const url = workerUrl(name);
      const ping = await pingWorker(url);
      return {
        name,
        createdOn: s.created_on ?? null,
        modifiedOn: s.modified_on ?? null,
        compatibilityDate: s.compatibility_date ?? null,
        handlers: Array.isArray(s.handlers) ? s.handlers : [],
        url,
        status: ping.status,
        httpCode: ping.httpCode,
        latencyMs: ping.latencyMs,
      };
    }),
  );

  workers.sort((a, b) => a.name.localeCompare(b.name));

  const summary = { total: workers.length, online: 0, degraded: 0, down: 0, unknown: 0 };
  for (const w of workers) summary[w.status]++;

  const snapshot: WorkersSnapshot = {
    generatedAt: new Date().toISOString(),
    configured: true,
    subdomain: SUBDOMAIN || null,
    summary,
    workers,
  };
  cache = { at: Date.now(), data: snapshot };
  return snapshot;
}

/** Worker name guard — only safe chars, mirrors the route-level validation. */
export function isValidWorkerName(name: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,128}$/.test(name);
}

/** Detail of one worker: config/bindings (type+name only) + health. Never throws. */
export async function getWorkerDetail(name: string): Promise<WorkerDetail> {
  const base: WorkerDetail = {
    configured: isCloudflareConfigured,
    name,
    compatibilityDate: null,
    compatibilityFlags: [],
    usageModel: null,
    bindings: [],
    url: workerUrl(name),
    status: "unknown",
    httpCode: null,
    latencyMs: null,
  };
  if (!isCloudflareConfigured) return base;
  if (!isValidWorkerName(name)) return { ...base, error: "Invalid worker name" };

  try {
    const settings = await cfApi<any>(
      `/accounts/${ACCOUNT_ID}/workers/scripts/${name}/settings`,
    );
    base.compatibilityDate = settings?.compatibility_date ?? null;
    base.compatibilityFlags = Array.isArray(settings?.compatibility_flags)
      ? settings.compatibility_flags
      : [];
    base.usageModel = settings?.usage_model ?? null;
    // SECURITY: expose only type + name, never the value (plain_text/secret_text).
    base.bindings = (settings?.bindings || []).map((b: any) => ({
      type: String(b?.type ?? "unknown"),
      name: String(b?.name ?? ""),
    }));
  } catch (err: any) {
    return { ...base, error: err?.message || "Cloudflare API error" };
  }

  const ping = await pingWorker(base.url);
  base.status = ping.status;
  base.httpCode = ping.httpCode;
  base.latencyMs = ping.latencyMs;
  return base;
}

/** Test/ops helper: drop the cached snapshot so the next call recomputes. */
export function resetWorkersCache(): void {
  cache = null;
}
