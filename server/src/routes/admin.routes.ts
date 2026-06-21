import { Router } from "express";
import express from "express";
import { SignJWT } from "jose";
import { timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import {
  requireAdminSession,
  generateCSRFToken,
  requireCSRF,
  resolveAdminSessionSecret,
} from "../middleware/admin-session";
import { CatalogImportService } from "../services/catalog-import.service";
import { pool } from "../db/pool";
import { safeCount } from "./admin-utils";
import {
  buildRegistrationOptions,
  confirmRegistration,
  buildAuthenticationOptions,
  confirmAuthentication,
  signChallengeToken,
  verifyChallengeToken,
  listPasskeys,
  countPasskeys,
  deletePasskey,
  PASSKEY_CHALLENGE_COOKIE,
} from "../services/passkey.service";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return v == null || v === "" ? fallback || "" : v;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function parseWidgetTenants(): Record<string, string> {
  const raw = getEnv("WIDGET_TENANT_MAP", "default:default");
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [widgetId, tenantId] = trimmed.split(":").map((s) => s.trim());
    if (widgetId && tenantId) map[widgetId] = tenantId;
  }
  return map;
}

// ── Safe env display for the admin overview ─────────────────────────────────
// Never surface secret-looking values in the admin UI. Values whose key OR
// content looks sensitive are masked; benign config values are shown (truncated).
function looksLikeSecretEnv(key: string, value: string): boolean {
  if (
    /(secret|token|key|password|passwd|pwd|auth|credential|api[_-]?key|dsn|private|cookie|session)/i.test(
      key,
    )
  ) {
    return true;
  }
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) {
    // Plain URLs are not secrets — mask only if credentials are embedded (user:pass@host).
    return /:\/\/[^/\s]*:[^/\s]*@/.test(v);
  }
  if (/:\/\/[^/\s]*:[^/\s]*@/.test(v)) return true; // connection string with credentials
  if (v.length >= 40 && !/\s/.test(v) && /^[A-Za-z0-9_\-+/=.:]+$/.test(v)) return true; // long opaque token
  return false;
}

function maskEnvValue(value: string): string {
  const v = String(value);
  if (v.length <= 6) return "••••";
  return `${v.slice(0, 3)}••••${v.slice(-3)}`;
}

function displayEnvValue(key: string, rawValue: string): string {
  if (looksLikeSecretEnv(key, rawValue)) return maskEnvValue(rawValue);
  return rawValue.length > 80 ? rawValue.slice(0, 77) + "..." : rawValue;
}

function cookieBaseAttrs() {
  const secure = process.env.NODE_ENV === "production";
  // Strict: the admin/CSRF cookies are only sent on same-site requests. The
  // login POST and the QG pages are same-origin, so this hardens CSRF defense
  // without breaking the flow (a cross-site link to /priv simply re-prompts login).
  const sameSite = "Strict";
  return { secure, sameSite } as const;
}

function setCookie(
  res: any,
  name: string,
  value: string,
  opts: { maxAgeSeconds: number } & ReturnType<typeof cookieBaseAttrs>,
) {
  const parts: string[] = [];
  parts.push(`${name}=${encodeURIComponent(value)}`);
  parts.push(`Path=/`);
  parts.push(`HttpOnly`);
  parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res: any, name: string) {
  const { secure, sameSite } = cookieBaseAttrs();
  const parts: string[] = [];
  parts.push(`${name}=`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  parts.push("Max-Age=0");
  res.setHeader("Set-Cookie", parts.join("; "));
}

// Build a single Set-Cookie string sharing the admin cookie attributes.
// csrf_token must remain readable by JS (httpOnly:false) for the double-submit
// pattern; admin_session and the passkey challenge stay HttpOnly.
function buildCookieString(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; httpOnly?: boolean },
): string {
  const { secure, sameSite } = cookieBaseAttrs();
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join("; ");
}

function readReqCookie(req: any, name: string): string {
  const header = req?.headers?.cookie;
  if (!header || typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

async function signAdminSessionToken(): Promise<string> {
  const secretRaw = resolveAdminSessionSecret();
  const secret = new TextEncoder().encode(secretRaw);
  return await new SignJWT({ typ: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret);
}

// ============================================================================
// Admin Page Handler — loads admin.html from views (like factory-ui)
// ============================================================================

let cachedAdminHtml: string | null = null;

function resolveAdminHtmlPath(): string {
  const candidates = [
    path.join(__dirname, "../views/admin.html"),
    path.join(__dirname, "../../src/views/admin.html"),
    path.join(__dirname, "../../views/admin.html"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function loadAdminHtml(): string {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    const htmlPath = resolveAdminHtmlPath();
    try {
      return fs.readFileSync(htmlPath, "utf-8");
    } catch (err: any) {
      console.error(`[Admin UI] Failed to read ${htmlPath}:`, err.message);
      return getFallbackErrorHtml(htmlPath, err.message);
    }
  }

  if (cachedAdminHtml !== null) {
    return cachedAdminHtml;
  }

  const htmlPath = resolveAdminHtmlPath();
  try {
    cachedAdminHtml = fs.readFileSync(htmlPath, "utf-8");
    console.log(
      `[Admin UI] Loaded admin.html from ${htmlPath} (${cachedAdminHtml.length} bytes, cached)`,
    );
    return cachedAdminHtml;
  } catch (err: any) {
    console.error(`[Admin UI] Failed to read ${htmlPath}:`, err.message);
    return getFallbackErrorHtml(htmlPath, err.message);
  }
}

function getFallbackErrorHtml(attemptedPath: string, errorMessage: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><title>Admin — Error</title>
<style>body{font-family:system-ui;background:#050a18;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.e{background:#0b1228;border:1px solid #ef4444;border-radius:12px;padding:32px;max-width:600px}
h1{color:#ef4444;font-size:18px}p{color:#8892b0;font-size:14px}code{background:#1a2a50;padding:2px 8px;border-radius:4px;font-size:13px;color:#f59e0b}</style>
</head><body><div class="e">
<h1>Admin UI Failed to Load</h1>
<p>Could not read: <code>${attemptedPath.replace(/</g, "&lt;")}</code></p>
<p>Error: <code>${errorMessage.replace(/</g, "&lt;")}</code></p>
<p>Ensure <code>src/views/admin.html</code> exists.</p>
</div></body></html>`;
}

export const adminPageHandler = (_req: any, res: any) => {
  if (!getEnv("ADMIN_API_KEY")) {
    res.status(503);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(
      getFallbackErrorHtml("ADMIN_API_KEY", "Admin API key not configured"),
    );
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(loadAdminHtml());
};

// ============================================================================
// Router
// ============================================================================

const router = Router();

// ── Auth endpoints (no session required) ────────────────────────────────────

router.post("/session", express.json({ limit: "10kb" }), async (req, res) => {
  const required = getEnv("ADMIN_API_KEY");
  if (!required) {
    return res.status(503).json({ error: "Admin API key not configured" });
  }

  const provided = typeof req.body?.key === "string" ? req.body.key : "";
  if (!provided || !safeEqual(provided, required)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = await signAdminSessionToken();
  const csrfToken = generateCSRFToken();

  setCookie(res, "admin_session", token, {
    maxAgeSeconds: 30 * 60,
    ...cookieBaseAttrs(),
  });

  const csrfParts: string[] = [];
  csrfParts.push(`csrf_token=${csrfToken}`);
  csrfParts.push("Path=/");
  csrfParts.push(`SameSite=${cookieBaseAttrs().sameSite}`);
  if (cookieBaseAttrs().secure) csrfParts.push("Secure");
  csrfParts.push(`Max-Age=${30 * 60}`);
  res.append("Set-Cookie", csrfParts.join("; "));

  return res.json({ success: true });
});

router.post("/logout", requireAdminSession(), requireCSRF(), async (_req, res) => {
  clearCookie(res, "admin_session");
  return res.json({ success: true });
});

router.get("/status", requireAdminSession(), async (_req, res) => {
  return res.json({ authenticated: true });
});

// ── Passkey (WebAuthn / FIDO2) endpoints ────────────────────────────────────
// Passwordless QG login. ADMIN_API_KEY (POST /session) stays as the break-glass
// fallback. The per-ceremony challenge is held in a short-lived signed cookie.

const CHALLENGE_COOKIE_MAX_AGE = 5 * 60;

// Whether at least one passkey is enrolled (PUBLIC). Lets the login UI decide
// to show the "Sign in with a passkey" button. Reveals only existence, which is
// acceptable for a single-admin tool.
router.get("/passkey/available", async (_req, res) => {
  const count = await countPasskeys();
  return res.json({ available: count > 0, count });
});

// List enrolled passkeys (metadata only — never the public key). Gated.
router.get("/passkey/list", requireAdminSession(), async (_req, res) => {
  const rows = await listPasskeys();
  return res.json({
    success: true,
    passkeys: rows.map((p) => ({
      credentialId: p.credentialId,
      label: p.label,
      deviceType: p.deviceType,
      backedUp: p.backedUp,
      transports: p.transports,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    })),
  });
});

// Begin enrollment (gated): generate options + stash challenge in a cookie.
router.post(
  "/passkey/register/options",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "50kb" }),
  async (_req, res) => {
    try {
      const options = await buildRegistrationOptions();
      const token = await signChallengeToken(options.challenge, "register");
      res.setHeader(
        "Set-Cookie",
        buildCookieString(PASSKEY_CHALLENGE_COOKIE, token, {
          maxAgeSeconds: CHALLENGE_COOKIE_MAX_AGE,
          httpOnly: true,
        }),
      );
      return res.json(options);
    } catch (err: any) {
      console.error("[Passkey] register/options failed:", err?.message);
      return res
        .status(500)
        .json({ error: "Impossible de générer les options d'enrôlement." });
    }
  },
);

// Finish enrollment (gated): verify attestation + persist the credential.
router.post(
  "/passkey/register/verify",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "50kb" }),
  async (req, res) => {
    const challenge = await verifyChallengeToken(
      readReqCookie(req, PASSKEY_CHALLENGE_COOKIE),
      "register",
    );
    clearCookie(res, PASSKEY_CHALLENGE_COOKIE);
    if (!challenge) {
      return res
        .status(400)
        .json({ error: "Défi d'enrôlement expiré ou absent. Réessayez." });
    }

    const response = req.body?.response ?? req.body;
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;
    if (!response || typeof response !== "object") {
      return res.status(400).json({ error: "Réponse d'enrôlement manquante." });
    }

    const result = await confirmRegistration({
      response,
      expectedChallenge: challenge,
      label,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Enrôlement refusé." });
    }
    return res.json({ success: true });
  },
);

// Delete an enrolled passkey (gated).
router.delete(
  "/passkey/:credentialId",
  requireAdminSession(),
  requireCSRF(),
  async (req, res) => {
    const raw = req.params.credentialId;
    const credentialId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!credentialId) {
      return res.status(400).json({ error: "credentialId requis." });
    }
    const deleted = await deletePasskey(credentialId);
    return res.json({ success: true, deleted });
  },
);

// Begin authentication (PUBLIC): generate options + stash challenge in a cookie.
router.post(
  "/passkey/auth/options",
  express.json({ limit: "10kb" }),
  async (_req, res) => {
    try {
      if ((await countPasskeys()) === 0) {
        return res.status(400).json({ error: "Aucune passkey enregistrée." });
      }
      const options = await buildAuthenticationOptions();
      const token = await signChallengeToken(options.challenge, "auth");
      res.setHeader(
        "Set-Cookie",
        buildCookieString(PASSKEY_CHALLENGE_COOKIE, token, {
          maxAgeSeconds: CHALLENGE_COOKIE_MAX_AGE,
          httpOnly: true,
        }),
      );
      return res.json(options);
    } catch (err: any) {
      console.error("[Passkey] auth/options failed:", err?.message);
      return res
        .status(500)
        .json({ error: "Impossible de générer les options de connexion." });
    }
  },
);

// Finish authentication (PUBLIC): verify assertion. On success, emit the same
// admin_session + csrf_token cookies as POST /session and clear the challenge.
router.post(
  "/passkey/auth/verify",
  express.json({ limit: "50kb" }),
  async (req, res) => {
    const challenge = await verifyChallengeToken(
      readReqCookie(req, PASSKEY_CHALLENGE_COOKIE),
      "auth",
    );
    if (!challenge) {
      clearCookie(res, PASSKEY_CHALLENGE_COOKIE);
      return res
        .status(400)
        .json({ error: "Défi de connexion expiré ou absent. Réessayez." });
    }

    const response = req.body?.response ?? req.body;
    if (!response || typeof response !== "object") {
      clearCookie(res, PASSKEY_CHALLENGE_COOKIE);
      return res.status(400).json({ error: "Réponse de connexion manquante." });
    }

    const result = await confirmAuthentication({
      response,
      expectedChallenge: challenge,
    });
    if (!result.ok) {
      clearCookie(res, PASSKEY_CHALLENGE_COOKIE);
      return res.status(401).json({ error: result.error || "Connexion refusée." });
    }

    // Success → issue the admin session (same shape as the API-key login).
    const sessionToken = await signAdminSessionToken();
    const csrfToken = generateCSRFToken();
    res.setHeader("Set-Cookie", [
      buildCookieString("admin_session", sessionToken, {
        maxAgeSeconds: 30 * 60,
        httpOnly: true,
      }),
      buildCookieString("csrf_token", csrfToken, {
        maxAgeSeconds: 30 * 60,
        httpOnly: false,
      }),
      buildCookieString(PASSKEY_CHALLENGE_COOKIE, "", {
        maxAgeSeconds: 0,
        httpOnly: true,
      }),
    ]);
    return res.json({ success: true });
  },
);

// ── Catalog Import endpoints (existing) ─────────────────────────────────────

router.post(
  "/catalog/import/dry-run",
  requireAdminSession(),
  requireCSRF(),
  express.text({
    type: ["application/xml", "text/xml", "text/plain"],
    limit: "20mb",
  }),
  async (req, res) => {
    try {
      const tenantId =
        typeof req.query.tenant_id === "string"
          ? req.query.tenant_id.trim()
          : "";
      if (!tenantId) {
        return res.status(400).json({ error: "tenant_id requis" });
      }

      const xmlText = typeof req.body === "string" ? req.body : "";
      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({ error: "XML requis" });
      }

      const result = await CatalogImportService.runImport({
        tenantId,
        xmlText,
        mode: "dry_run",
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      console.error("Admin catalog dry-run failed:", error);
      return res
        .status(500)
        .json({ success: false, error: "Import dry-run failed" });
    }
  },
);

router.post(
  "/catalog/import/commit",
  requireAdminSession(),
  requireCSRF(),
  express.text({
    type: ["application/xml", "text/xml", "text/plain"],
    limit: "20mb",
  }),
  async (req, res) => {
    try {
      const tenantId =
        typeof req.query.tenant_id === "string"
          ? req.query.tenant_id.trim()
          : "";
      if (!tenantId) {
        return res.status(400).json({ error: "tenant_id requis" });
      }

      const xmlText = typeof req.body === "string" ? req.body : "";
      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({ error: "XML requis" });
      }

      const result = await CatalogImportService.runImport({
        tenantId,
        xmlText,
        mode: "commit",
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      console.error("Admin catalog commit failed:", error);
      return res
        .status(500)
        .json({ success: false, error: "Import commit failed" });
    }
  },
);

// ============================================================================
// DATABASE VISUALIZATION API ENDPOINTS
// ============================================================================

// ── GET /db/overview — Full database overview stats ─────────────────────────

router.get("/db/overview", requireAdminSession(), async (_req, res) => {
  try {
    const [properties, tenants, imports, conversations, messages, leads] =
      await Promise.all([
        safeCount("catalog_properties"),
        pool
          .query(
            "SELECT COUNT(DISTINCT tenant_id)::int AS c FROM catalog_properties",
          )
          .then((r) => r.rows[0]?.c ?? 0)
          .catch(() => 0),
        safeCount("catalog_import_runs"),
        safeCount("conversations"),
        safeCount("messages"),
        safeCount("leads"),
      ]);

    // Tenant breakdown
    let tenantBreakdown: Array<{ tenant_id: string; count: number }> = [];
    try {
      const tbResult = await pool.query(
        `SELECT tenant_id, COUNT(*)::int AS count
         FROM catalog_properties
         GROUP BY tenant_id
         ORDER BY count DESC`,
      );
      tenantBreakdown = tbResult.rows;
    } catch {
      // table may not exist
    }

    // Env info (safe keys only)
    const envKeys = [
      "BOT_DOMAIN",
      "WIDGET_TENANT_MAP",
      "KNOWLEDGE_URLS",
      "LLM_PROVIDER",
      "CRM_PROVIDER",
      "TWENTY_ENABLED",
    ];
    const envInfo = envKeys
      .map((key) => {
        const val = process.env[key];
        if (val == null || val === "") return null;
        return { key, value: displayEnvValue(key, val) };
      })
      .filter(Boolean);

    // Also add VAR_* keys (values masked when the key or content looks secret)
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("VAR_")) {
        const val = process.env[key] || "";
        envInfo.push({ key, value: displayEnvValue(key, val) });
      }
    }

    return res.json({
      success: true,
      properties,
      tenants,
      imports,
      conversations,
      messages,
      leads,
      tenantBreakdown,
      envInfo,
    });
  } catch (err: any) {
    console.error("[Admin DB] Overview failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /db/tenants — List all tenants with detailed stats ──────────────────

router.get("/db/tenants", requireAdminSession(), async (_req, res) => {
  try {
    // Properties per tenant
    const propsResult = await pool.query(`
      SELECT
        tenant_id,
        COUNT(*)::int AS property_count,
        COUNT(*) FILTER (WHERE statut = 'disponible')::int AS available,
        COUNT(*) FILTER (WHERE statut = 'retire')::int AS retired,
        MAX(updated_at) AS last_updated
      FROM catalog_properties
      GROUP BY tenant_id
      ORDER BY tenant_id
    `);

    // Conversations per tenant
    let convCounts: Record<string, number> = {};
    try {
      const convResult = await pool.query(
        `SELECT tenant_id, COUNT(*)::int AS c FROM conversations GROUP BY tenant_id`,
      );
      for (const row of convResult.rows) {
        convCounts[row.tenant_id] = row.c;
      }
    } catch {
      // OK
    }

    // Leads per tenant
    let leadCounts: Record<string, number> = {};
    try {
      const leadResult = await pool.query(
        `SELECT tenant_id, COUNT(*)::int AS c FROM leads GROUP BY tenant_id`,
      );
      for (const row of leadResult.rows) {
        leadCounts[row.tenant_id] = row.c;
      }
    } catch {
      // OK
    }

    // Last import per tenant
    let lastImports: Record<string, string> = {};
    try {
      const impResult = await pool.query(
        `SELECT DISTINCT ON (tenant_id) tenant_id, COALESCE(committed_at, created_at) AS ts
         FROM catalog_import_runs
         ORDER BY tenant_id, created_at DESC`,
      );
      for (const row of impResult.rows) {
        lastImports[row.tenant_id] = row.ts;
      }
    } catch {
      // OK
    }

    // Widget map reverse lookup
    const widgetMap = parseWidgetTenants();
    const reverseMap: Record<string, string[]> = {};
    for (const [wid, tid] of Object.entries(widgetMap)) {
      if (!reverseMap[tid]) reverseMap[tid] = [];
      reverseMap[tid].push(wid);
    }

    // Merge all tenant IDs (from properties + from widget map)
    const allTenantIds = new Set<string>();
    for (const row of propsResult.rows) allTenantIds.add(row.tenant_id);
    for (const tid of Object.values(widgetMap)) allTenantIds.add(tid);

    const tenants = Array.from(allTenantIds)
      .sort()
      .map((tid) => {
        const propRow = propsResult.rows.find(
          (r: any) => r.tenant_id === tid,
        );
        return {
          tenant_id: tid,
          property_count: propRow?.property_count ?? 0,
          available: propRow?.available ?? 0,
          retired: propRow?.retired ?? 0,
          conversation_count: convCounts[tid] ?? 0,
          lead_count: leadCounts[tid] ?? 0,
          last_import: lastImports[tid] || null,
          last_updated: propRow?.last_updated || null,
          widgetIds: reverseMap[tid] || [],
        };
      });

    return res.json({ success: true, tenants });
  } catch (err: any) {
    console.error("[Admin DB] Tenants list failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /db/properties — Paginated property browser ─────────────────────────

router.get("/db/properties", requireAdminSession(), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (typeof req.query.tenant_id === "string" && req.query.tenant_id.trim()) {
      where.push(`tenant_id = $${idx++}`);
      values.push(req.query.tenant_id.trim());
    }

    if (typeof req.query.status === "string" && req.query.status.trim()) {
      where.push(`statut = $${idx++}`);
      values.push(req.query.status.trim());
    }

    if (typeof req.query.type === "string" && req.query.type.trim()) {
      where.push(`type = $${idx++}`);
      values.push(req.query.type.trim());
    }

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const searchVal = req.query.search.trim();
      where.push(
        `(id_unique ILIKE $${idx} OR ville ILIKE $${idx} OR title ILIKE $${idx} OR description ILIKE $${idx} OR code_postal ILIKE $${idx})`,
      );
      values.push(`%${searchVal}%`);
      idx++;
    }

    const whereClause =
      where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    // Count
    const countSql = `SELECT COUNT(*)::int AS total FROM catalog_properties ${whereClause}`;
    const countResult = await pool.query(countSql, values);
    const total = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    // Rows
    const dataSql = `
      SELECT
        tenant_id, id_unique, type, transaction, statut,
        url_annonce, date_maj, prix, charges, tax_year,
        surface_m2, pieces, chambres, floor, elevator,
        ville, code_postal, country, lat, lon,
        flags, title, description, tags, photos_urls,
        created_at, updated_at
      FROM catalog_properties
      ${whereClause}
      ORDER BY updated_at DESC NULLS LAST, tenant_id, id_unique
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);
    const dataResult = await pool.query(dataSql, values);

    const rows = dataResult.rows.map((r: any) => ({
      tenant_id: r.tenant_id,
      id_unique: r.id_unique,
      type: r.type,
      transaction: r.transaction,
      statut: r.statut,
      url_annonce: r.url_annonce,
      date_maj: r.date_maj,
      prix: r.prix,
      charges: r.charges,
      tax_year: r.tax_year,
      surface_m2: r.surface_m2 != null ? Number(r.surface_m2) : null,
      pieces: r.pieces,
      chambres: r.chambres,
      floor: r.floor,
      elevator: r.elevator,
      ville: r.ville,
      code_postal: r.code_postal,
      country: r.country,
      lat: r.lat != null ? Number(r.lat) : null,
      lon: r.lon != null ? Number(r.lon) : null,
      flags: r.flags || {},
      title: r.title,
      description: r.description,
      tags: Array.isArray(r.tags) ? r.tags : [],
      photos_urls: Array.isArray(r.photos_urls) ? r.photos_urls : [],
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.json({
      success: true,
      rows,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err: any) {
    console.error("[Admin DB] Properties query failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /db/imports — Import history ────────────────────────────────────────

router.get("/db/imports", requireAdminSession(), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const where: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (typeof req.query.tenant_id === "string" && req.query.tenant_id.trim()) {
      where.push(`tenant_id = $${idx++}`);
      values.push(req.query.tenant_id.trim());
    }

    const whereClause =
      where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const sql = `
      SELECT id, tenant_id, mode, source_name, seen_count, error_count, created_at, committed_at
      FROM catalog_import_runs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++}
    `;
    values.push(limit);

    const result = await pool.query(sql, values);

    return res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err: any) {
    console.error("[Admin DB] Imports query failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /db/conversations — Recent conversations + leads ────────────────────

router.get("/db/conversations", requireAdminSession(), async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    // Conversations with message count
    let conversations: any[] = [];
    try {
      const convResult = await pool.query(
        `SELECT
           c.id, c.session_id, c.tenant_id, c.status, c.created_at, c.updated_at,
           (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         ORDER BY c.updated_at DESC NULLS LAST
         LIMIT $1`,
        [limit],
      );
      conversations = convResult.rows;
    } catch {
      // table may not exist
    }

    // Leads
    let leads: any[] = [];
    try {
      const leadResult = await pool.query(
        `SELECT id, tenant_id, email, phone, automation_needs, timeline, chat_summary, created_at
         FROM leads
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );
      leads = leadResult.rows;
    } catch {
      // table may not exist
    }

    return res.json({
      success: true,
      conversations,
      leads,
    });
  } catch (err: any) {
    console.error("[Admin DB] Conversations query failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /db/property/:tenantId/:idUnique — Delete a single property ──────

router.delete(
  "/db/property/:tenantId/:idUnique",
  requireAdminSession(),
  requireCSRF(),
  async (req, res) => {
    const tenantIdParam = req.params.tenantId;
    const idUniqueParam = req.params.idUnique;
    const tenantId = (Array.isArray(tenantIdParam) ? tenantIdParam[0] : tenantIdParam)?.trim();
    const idUnique = (Array.isArray(idUniqueParam) ? idUniqueParam[0] : idUniqueParam)?.trim();

    if (!tenantId || !idUnique) {
      return res
        .status(400)
        .json({ success: false, error: "tenant_id and id_unique are required" });
    }

    try {
      const result = await pool.query(
        `DELETE FROM catalog_properties WHERE tenant_id = $1 AND id_unique = $2`,
        [tenantId, idUnique],
      );

      const deleted = result.rowCount || 0;
      console.log(
        `[Admin DB] Deleted property ${idUnique} from tenant ${tenantId} (${deleted} rows)`,
      );

      return res.json({
        success: true,
        deleted,
        message:
          deleted > 0
            ? `Property ${idUnique} deleted`
            : `Property ${idUnique} not found`,
      });
    } catch (err: any) {
      console.error("[Admin DB] Delete property failed:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── DELETE /db/tenant/:tenantId — Purge all data for a tenant ───────────────

router.delete(
  "/db/tenant/:tenantId",
  requireAdminSession(),
  requireCSRF(),
  async (req, res) => {
    const tenantIdParam = req.params.tenantId;
    const tenantId = (Array.isArray(tenantIdParam) ? tenantIdParam[0] : tenantIdParam)?.trim();
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, error: "tenant_id is required" });
    }

    const widgetMap = parseWidgetTenants();
    const configuredTenantIds = new Set(Object.values(widgetMap));

    console.log(
      `[Admin DB] Tenant deletion requested: ${tenantId} (configured: ${configuredTenantIds.has(tenantId)})`,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Delete catalog_import_errors linked to this tenant's import runs
      const errorDeleteResult = await client.query(
        `DELETE FROM catalog_import_errors
         WHERE import_run_id IN (
           SELECT id FROM catalog_import_runs WHERE tenant_id = $1
         )`,
        [tenantId],
      );
      const errorsDeleted = errorDeleteResult.rowCount || 0;

      // 2. Delete catalog_import_runs
      const runsDeleteResult = await client.query(
        `DELETE FROM catalog_import_runs WHERE tenant_id = $1`,
        [tenantId],
      );
      const runsDeleted = runsDeleteResult.rowCount || 0;

      // 3. Delete catalog_properties
      const propsDeleteResult = await client.query(
        `DELETE FROM catalog_properties WHERE tenant_id = $1`,
        [tenantId],
      );
      const propertiesDeleted = propsDeleteResult.rowCount || 0;

      // 4. Delete messages
      const msgsDeleteResult = await client.query(
        `DELETE FROM messages WHERE tenant_id = $1`,
        [tenantId],
      );
      const messagesDeleted = msgsDeleteResult.rowCount || 0;

      // 5. Delete conversations
      const convsDeleteResult = await client.query(
        `DELETE FROM conversations WHERE tenant_id = $1`,
        [tenantId],
      );
      const conversationsDeleted = convsDeleteResult.rowCount || 0;

      // 6. Delete leads
      const leadsDeleteResult = await client.query(
        `DELETE FROM leads WHERE tenant_id = $1`,
        [tenantId],
      );
      const leadsDeleted = leadsDeleteResult.rowCount || 0;

      await client.query("COMMIT");

      const summary = {
        tenantId,
        propertiesDeleted,
        runsDeleted,
        errorsDeleted,
        messagesDeleted,
        conversationsDeleted,
        leadsDeleted,
      };

      console.log(
        `[Admin DB] Tenant ${tenantId} purged:`,
        JSON.stringify(summary),
      );

      return res.json({
        success: true,
        message: `Tenant "${tenantId}" purged successfully`,
        ...summary,
        hint: configuredTenantIds.has(tenantId)
          ? `Note: "${tenantId}" is still in WIDGET_TENANT_MAP. Remove it from .env if no longer needed.`
          : undefined,
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `[Admin DB] Failed to delete tenant ${tenantId}:`,
        err.message,
      );
      return res.status(500).json({
        success: false,
        error: `Failed to purge tenant: ${err.message}`,
      });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /db/lead/:id — RGPD erasure of a single lead (right to be forgotten)
// Session + CSRF + explicit confirmation. The lead row holds PII (email/phone);
// with ?cascade=true the linked conversation and its messages (which may also
// contain PII typed by the visitor) are erased too. Erasure is intentionally
// PERMANENT (right to erasure). The action is audited WITHOUT logging any PII —
// only ids + counts. Note: when RLS is enabled (DB_RLS_ENABLED), admin routes
// like this one must run via withAdminBypass (see server/src/db/rls.ts).
router.delete(
  "/db/lead/:id",
  requireAdminSession(),
  requireCSRF(),
  async (req, res) => {
    const idParam = req.params.id;
    const id = (Array.isArray(idParam) ? idParam[0] : idParam)?.trim();

    // leads.id is a uuid — reject anything that is not a well-formed uuid.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !UUID_RE.test(id)) {
      return res
        .status(400)
        .json({ success: false, error: "A valid lead id (uuid) is required" });
    }

    // Explicit confirmation guards against accidental destructive calls.
    const confirmBody =
      req.body?.confirm === true || req.body?.confirm === "true";
    const confirmQuery = req.query.confirm === "true";
    if (!confirmBody && !confirmQuery) {
      return res.status(400).json({
        success: false,
        error:
          'Confirmation required: pass { "confirm": true } in the body or ?confirm=true',
      });
    }

    const cascade =
      req.query.cascade === "true" ||
      req.body?.cascade === true ||
      req.body?.cascade === "true";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Erase the lead row; capture tenant + conversation for audit/cascade.
      const leadRes = await client.query(
        `DELETE FROM leads WHERE id = $1 RETURNING tenant_id, conversation_id`,
        [id],
      );

      if ((leadRes.rowCount || 0) === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, error: "Lead not found" });
      }

      const tenantId = leadRes.rows[0].tenant_id as string;
      const conversationId = leadRes.rows[0].conversation_id as string | null;

      let messagesDeleted = 0;
      let conversationsDeleted = 0;
      if (cascade && conversationId) {
        const msgRes = await client.query(
          `DELETE FROM messages WHERE conversation_id = $1 AND tenant_id = $2`,
          [conversationId, tenantId],
        );
        messagesDeleted = msgRes.rowCount || 0;
        const convRes = await client.query(
          `DELETE FROM conversations WHERE id = $1 AND tenant_id = $2`,
          [conversationId, tenantId],
        );
        conversationsDeleted = convRes.rowCount || 0;
      }

      await client.query("COMMIT");

      // Audit entry WITHOUT PII (ids + counts only — never email/phone).
      const audit = {
        action: "rgpd_lead_erasure",
        leadId: id,
        tenantId,
        cascade,
        messagesDeleted,
        conversationsDeleted,
        at: new Date().toISOString(),
      };
      console.log(`[Admin DB][RGPD] Lead erased:`, JSON.stringify(audit));

      return res.json({
        success: true,
        message: `Lead ${id} erased`,
        leadDeleted: 1,
        cascade,
        messagesDeleted,
        conversationsDeleted,
        tenantId,
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[Admin DB][RGPD] Lead erasure failed:", err.message);
      return res
        .status(500)
        .json({ success: false, error: "Lead erasure failed" });
    } finally {
      client.release();
    }
  },
);

export default router;
