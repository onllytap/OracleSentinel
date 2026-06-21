// ============================================================================
// Infra Monitor Service — OracleSentinel Command Center (/priv)
// ============================================================================
// Actively probes every piece of infrastructure declared in the environment
// and reports live status to the super-admin Command Center.
//
// SECURITY CONTRACT (non-negotiable):
//   - This service reads secret env vars to *connect*, but NEVER returns a
//     secret value to the client. Identifiers are masked (e.g. npg_••••BGO).
//   - Only host / port / region / database-name style metadata is exposed.
//   - All probes are time-boxed so a hung service cannot stall the dashboard.
// ============================================================================

import net from "net";
import tls from "tls";
import http from "http";
import https from "https";
import { pool, isDatabaseConfigured } from "../db/pool";

export type ServiceStatus =
  | "operational"
  | "degraded"
  | "down"
  | "not_configured";

export interface ServiceReport {
  id: string;
  name: string;
  category: "database" | "cache" | "storage" | "automation" | "email" | "crm" | "observability" | "esign";
  status: ServiceStatus;
  /** Masked, non-sensitive identifier (host, masked user, region…). */
  endpoint: string;
  latencyMs: number | null;
  /** Human description of what this service does in the platform. */
  purpose: string;
  /** What the operator can do with this service from the platform. */
  capabilities: string[];
  /** Short status detail — never contains secrets. */
  detail: string;
}

export interface InfraSnapshot {
  generatedAt: string;
  environment: string;
  summary: {
    total: number;
    operational: number;
    degraded: number;
    down: number;
    notConfigured: number;
    healthScore: number; // 0..100
  };
  services: ServiceReport[];
}

const PROBE_TIMEOUT_MS = Number(process.env.PRIV_PROBE_TIMEOUT_MS ?? 4000);

// ── Masking helpers ─────────────────────────────────────────────────────────

/** Masks a sensitive token, keeping a tiny prefix/suffix for recognition. */
function mask(value: string | undefined | null): string {
  if (!value) return "—";
  const v = String(value);
  if (v.length <= 6) return "••••";
  return `${v.slice(0, 3)}••••${v.slice(-3)}`;
}

/** Extracts non-sensitive parts of a connection URL (host/port/user masked). */
function describeUrl(raw: string | undefined): { host: string; port: number | null; label: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const port = u.port ? Number(u.port) : null;
    const user = u.username ? mask(u.username) : "";
    const db = u.pathname && u.pathname !== "/" ? u.pathname.replace(/^\//, "") : "";
    const parts = [u.hostname];
    if (port) parts[0] = `${u.hostname}:${port}`;
    let label = parts[0];
    if (user) label = `${user}@${label}`;
    if (db) label = `${label}/${db}`;
    return { host: u.hostname, port, label };
  } catch {
    return null;
  }
}

// ── Low-level probes (built-ins only, no new deps) ───────────────────────────

/** TCP connect probe — resolves true if a socket opens before the timeout. */
function probeTcp(host: string, port: number, useTls = false): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve({ ok, ms: Date.now() - start });
    };
    const socket = useTls
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => finish(true))
      : net.connect({ host, port }, () => finish(true));
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

/** HTTP(S) reachability probe — any response (even 401/404) counts as "reachable". */
function probeHttp(rawUrl: string, path = "/"): Promise<{ ok: boolean; ms: number; code: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let base: URL;
    try {
      base = new URL(rawUrl);
    } catch {
      return resolve({ ok: false, ms: 0, code: null });
    }
    const lib = base.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: base.hostname,
        port: base.port || (base.protocol === "https:" ? 443 : 80),
        path: path || base.pathname || "/",
        timeout: PROBE_TIMEOUT_MS,
        // We only check reachability; do not fail on self-signed certs.
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (res) => {
        const code = res.statusCode ?? null;
        res.resume(); // drain
        resolve({ ok: true, ms: Date.now() - start, code });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, ms: Date.now() - start, code: null }); });
    req.on("error", () => resolve({ ok: false, ms: Date.now() - start, code: null }));
    req.end();
  });
}

// ── Host resolution helpers (Docker-awareness) ───────────────────────────────
//
// En production Dockerisée, le backend tourne dans son propre conteneur : donc
// "localhost"/"127.0.0.1" désigne le *loopback du conteneur* — ni la machine
// hôte, ni un conteneur voisin. Sonder le loopback dans ce cas est trompeur :
// un service réellement actif (conteneur voisin) apparaîtrait quand même "down".
// Ces helpers permettent à chaque sonde de viser un hôte configurable et, quand
// elle ne voit que le loopback, de le dire explicitement plutôt que d'afficher
// un "down" nu et mensonger.

/** Retourne la première valeur d'env définie et non vide parmi `envVars`, sinon `fallback`. */
function resolveHost(envVars: string[], fallback: string): string {
  for (const name of envVars) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return fallback;
}

/** Vrai quand un hôte pointe sur le loopback du conteneur (localhost/127.0.0.1/::1). */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * Suffixe de `detail` affiché quand une sonde ne peut atteindre que le loopback
 * du conteneur. À préfixer par le résultat de la sonde,
 * ex. `Sonde sur le ${loopbackHint("REDIS_HOST")}`.
 */
function loopbackHint(hostVar: string): string {
  return `loopback du conteneur — configurez ${hostVar} pour viser le vrai service.`;
}

// ── Per-service probes ───────────────────────────────────────────────────────

async function probeNeon(): Promise<ServiceReport> {
  const raw = process.env.NEXT_PRIVATE_DATABASE_URL || process.env.DATABASE_URL;
  const meta = describeUrl(raw);
  const region = meta?.host.match(/\.([a-z]+-[a-z]+-\d)\./)?.[1] || "unknown";
  const base: Omit<ServiceReport, "status" | "latencyMs" | "detail" | "endpoint"> = {
    id: "neon",
    name: "Neon PostgreSQL",
    category: "database",
    purpose: "Base de données principale — agences, leads, conversations, catalogues.",
    capabilities: ["Lecture/écriture leads", "Catalogues immobiliers", "Sessions & auth", "Analytics SQL"],
  };
  if (!meta) {
    return { ...base, status: "not_configured", latencyMs: null, endpoint: "—", detail: "Aucune URL de base de données configurée." };
  }
  // Prefer a real SQL round-trip via the existing pool when this is the app DB.
  if (isDatabaseConfigured) {
    const start = Date.now();
    try {
      await pool.query("SELECT 1");
      return { ...base, status: "operational", latencyMs: Date.now() - start, endpoint: `${meta.label} · ${region}`, detail: "SELECT 1 OK." };
    } catch {
      // fall through to TCP probe
    }
  }
  const tcp = await probeTcp(meta.host, meta.port ?? 5432, true);
  return {
    ...base,
    status: tcp.ok ? "degraded" : "down",
    latencyMs: tcp.ok ? tcp.ms : null,
    endpoint: `${meta.label} · ${region}`,
    detail: tcp.ok ? "Port TLS joignable (pas de requête SQL validée)." : "Connexion impossible.",
  };
}

async function probeLocalPostgres(): Promise<ServiceReport> {
  const host = resolveHost(["POSTGRES_HOST"], "localhost");
  const loopback = isLoopbackHost(host);
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  const user = mask(process.env.POSTGRES_USER);
  const db = process.env.POSTGRES_DB || "—";
  const tcp = await probeTcp(host, port);
  let detail: string;
  if (tcp.ok) {
    detail = loopback ? `Port ouvert sur le ${loopbackHint("POSTGRES_HOST")}` : "Port ouvert.";
  } else {
    detail = loopback ? `Sonde sur le ${loopbackHint("POSTGRES_HOST")}` : "Service arrêté ou injoignable.";
  }
  return {
    id: "postgres-local",
    name: "PostgreSQL (local)",
    category: "database",
    status: tcp.ok ? "operational" : "down",
    latencyMs: tcp.ok ? tcp.ms : null,
    endpoint: `${user}@${host}:${port}/${db}`,
    purpose: "Base PostgreSQL locale de développement (dev/test).",
    capabilities: ["Données dev locales", "Tests d'intégration"],
    detail,
  };
}

async function probeRedis(): Promise<ServiceReport> {
  const meta = describeUrl(process.env.REDIS_URL);
  const host = meta?.host || resolveHost(["REDIS_HOST"], "localhost");
  const port = meta?.port || Number(process.env.REDIS_PORT ?? 6379);
  const configured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  const loopback = isLoopbackHost(host);
  const tcp = await probeTcp(host, port);
  let detail: string;
  if (tcp.ok) {
    detail = loopback ? `Port ouvert sur le ${loopbackHint("REDIS_HOST/REDIS_URL")}` : "Port ouvert.";
  } else if (!configured) {
    detail = "Redis non configuré — définissez REDIS_HOST ou REDIS_URL.";
  } else {
    detail = loopback ? `Sonde sur le ${loopbackHint("REDIS_HOST/REDIS_URL")}` : "Redis injoignable.";
  }
  return {
    id: "redis",
    name: "Redis",
    category: "cache",
    status: tcp.ok ? "operational" : (configured ? "down" : "not_configured"),
    latencyMs: tcp.ok ? tcp.ms : null,
    endpoint: `${host}:${port}`,
    purpose: "Cache & files d'attente — rate-limiting, sessions volatiles, jobs.",
    capabilities: ["Cache réponses LLM", "Rate limiting", "File de jobs", "Pub/Sub temps réel"],
    detail,
  };
}

async function probeMinio(): Promise<ServiceReport> {
  const host = resolveHost(["MINIO_ENDPOINT"], "localhost");
  const configured = Boolean(process.env.MINIO_ENDPOINT);
  const loopback = isLoopbackHost(host);
  const port = Number(process.env.MINIO_API_PORT ?? process.env.MINIO_PORT ?? 9000);
  const useSsl = String(process.env.MINIO_USE_SSL).toLowerCase() === "true";
  const http = await probeHttp(`${useSsl ? "https" : "http"}://${host}:${port}`, "/minio/health/live");
  let detail: string;
  if (http.ok) {
    detail = loopback
      ? `Health endpoint répond (HTTP ${http.code ?? "?"}) sur le ${loopbackHint("MINIO_ENDPOINT")}`
      : `Health endpoint répond (HTTP ${http.code ?? "?"}).`;
  } else if (!configured) {
    detail = "MinIO non configuré — définissez MINIO_ENDPOINT.";
  } else {
    detail = loopback ? `Sonde sur le ${loopbackHint("MINIO_ENDPOINT")}` : "MinIO injoignable.";
  }
  return {
    id: "minio",
    name: "MinIO (S3)",
    category: "storage",
    status: http.ok ? "operational" : (configured ? "down" : "not_configured"),
    latencyMs: http.ok ? http.ms : null,
    endpoint: `${host}:${port} · bucket=${process.env.MINIO_BUCKET || "—"}`,
    purpose: "Stockage objet S3 — documents, médias, exports, backups.",
    capabilities: ["Upload documents", "Stockage médias", "Backups", "Exports CSV/PDF"],
    detail,
  };
}

async function probeN8n(): Promise<ServiceReport> {
  const host = resolveHost(["N8N_HOST"], "localhost");
  const loopback = isLoopbackHost(host);
  const port = Number(process.env.N8N_PORT ?? 5678);
  const proto = process.env.N8N_PROTOCOL || "http";
  const res = await probeHttp(`${proto}://${host}:${port}`, "/healthz");
  let detail: string;
  if (res.ok) {
    detail = loopback
      ? `Joignable (HTTP ${res.code ?? "?"}) sur le ${loopbackHint("N8N_HOST")}`
      : `Joignable (HTTP ${res.code ?? "?"}).`;
  } else {
    detail = loopback ? `Sonde sur le ${loopbackHint("N8N_HOST")}` : "n8n injoignable.";
  }
  return {
    id: "n8n",
    name: "n8n Automation",
    category: "automation",
    status: res.ok ? "operational" : "down",
    latencyMs: res.ok ? res.ms : null,
    endpoint: `${proto}://${host}:${port}`,
    purpose: "Orchestration des workflows — la 'canne à pêche automatique'.",
    capabilities: ["Workflows de closing", "Sync CRM", "Webhooks entrants", "Notifications"],
    detail,
  };
}

async function probeSmtp(): Promise<ServiceReport> {
  const host = process.env.NEXT_PRIVATE_SMTP_HOST || process.env.SMTP_HOST || "";
  const port = Number(process.env.NEXT_PRIVATE_SMTP_PORT ?? process.env.SMTP_PORT ?? 587);
  if (!host) {
    return {
      id: "smtp", name: "Brevo SMTP", category: "email", status: "not_configured",
      latencyMs: null, endpoint: "—", purpose: "Envoi des emails transactionnels.",
      capabilities: [], detail: "SMTP non configuré.",
    };
  }
  const tcp = await probeTcp(host, port);
  const user = mask(process.env.NEXT_PRIVATE_SMTP_USERNAME || process.env.SMTP_USER);
  return {
    id: "smtp",
    name: "Brevo SMTP",
    category: "email",
    status: tcp.ok ? "operational" : "down",
    latencyMs: tcp.ok ? tcp.ms : null,
    endpoint: `${user}@${host}:${port}`,
    purpose: "Emails transactionnels — confirmations leads, signatures, alertes.",
    capabilities: ["Confirmations lead", "Emails de signature", "Alertes système", "Rapports"],
    detail: tcp.ok ? "Relais SMTP joignable." : "Relais SMTP injoignable.",
  };
}

async function probeTwenty(): Promise<ServiceReport> {
  const url = process.env.TWENTY_API_URL;
  if (!url) {
    return {
      id: "twenty", name: "Twenty CRM", category: "crm", status: "not_configured",
      latencyMs: null, endpoint: "—", purpose: "CRM cible des leads générés.",
      capabilities: [], detail: "API Twenty non configurée.",
    };
  }
  const res = await probeHttp(url);
  const meta = describeUrl(url);
  return {
    id: "twenty",
    name: "Twenty CRM",
    category: "crm",
    status: res.ok ? "operational" : "down",
    latencyMs: res.ok ? res.ms : null,
    endpoint: `${meta?.host || url} · key ${mask(process.env.TWENTY_API_KEY)}`,
    purpose: "CRM — destination finale des leads qualifiés par les bots.",
    capabilities: ["Création de leads", "Mise à jour opportunités", "Sync bidirectionnelle", "Pipeline closing"],
    detail: res.ok ? `API joignable (HTTP ${res.code ?? "?"}).` : "API Twenty injoignable.",
  };
}

async function probeSentry(): Promise<ServiceReport> {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return {
      id: "sentry", name: "Sentry", category: "observability", status: "not_configured",
      latencyMs: null, endpoint: "—", purpose: "Monitoring des erreurs & traces.",
      capabilities: [], detail: "DSN Sentry non configuré.",
    };
  }
  const meta = describeUrl(dsn);
  const host = meta?.host || "";
  const res = host ? await probeHttp(`https://${host}`) : { ok: false, ms: 0, code: null };
  return {
    id: "sentry",
    name: "Sentry",
    category: "observability",
    status: res.ok ? "operational" : "degraded",
    latencyMs: res.ok ? res.ms : null,
    endpoint: `${host} · org=${process.env.SENTRY_ORG || "—"}`,
    purpose: "Observabilité — erreurs, performance, traces OTLP.",
    capabilities: ["Capture d'exceptions", "Tracing perf", "Alertes incidents", "Logs OTLP"],
    detail: res.ok ? "Ingest joignable." : "Ingest non confirmé (peut être normal).",
  };
}

async function probeDocumenso(): Promise<ServiceReport> {
  const url = process.env.DOCUMENSO_PUBLIC_URL || process.env.NEXT_PUBLIC_DOCUMENSO_URL;
  if (!url) {
    return {
      id: "documenso", name: "Documenso", category: "esign", status: "not_configured",
      latencyMs: null, endpoint: "—", purpose: "Signature électronique des mandats.",
      capabilities: [], detail: "Documenso non configuré.",
    };
  }
  const res = await probeHttp(url);
  const meta = describeUrl(url);
  return {
    id: "documenso",
    name: "Documenso E-Sign",
    category: "esign",
    status: res.ok ? "operational" : "down",
    latencyMs: res.ok ? res.ms : null,
    endpoint: `${meta?.host || url}:${meta?.port ?? ""} · token ${mask(process.env.DOCUMENSO_API_TOKEN)}`,
    purpose: "Signature électronique — mandats, mandats de vente, contrats.",
    capabilities: ["Envoi à signer", "Suivi des signatures", "Webhooks signature", "Archivage légal"],
    detail: res.ok ? `Reachable (HTTP ${res.code ?? "?"}).` : "Documenso injoignable.",
  };
}

// ── Aggregator ───────────────────────────────────────────────────────────────

export async function collectInfraSnapshot(): Promise<InfraSnapshot> {
  const services = await Promise.all([
    probeNeon(),
    probeLocalPostgres(),
    probeRedis(),
    probeMinio(),
    probeN8n(),
    probeSmtp(),
    probeTwenty(),
    probeSentry(),
    probeDocumenso(),
  ]);

  const counts = { operational: 0, degraded: 0, down: 0, notConfigured: 0 };
  for (const s of services) {
    if (s.status === "operational") counts.operational++;
    else if (s.status === "degraded") counts.degraded++;
    else if (s.status === "down") counts.down++;
    else counts.notConfigured++;
  }

  const scoreable = services.filter((s) => s.status !== "not_configured").length || 1;
  const healthScore = Math.round(
    ((counts.operational + counts.degraded * 0.5) / scoreable) * 100,
  );

  return {
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || process.env.APP_ENV || "development",
    summary: {
      total: services.length,
      operational: counts.operational,
      degraded: counts.degraded,
      down: counts.down,
      notConfigured: counts.notConfigured,
      healthScore,
    },
    services,
  };
}
