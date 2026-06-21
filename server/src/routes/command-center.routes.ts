// ============================================================================
// Command Center (/priv) — Super-Admin Routes
// ============================================================================
// Serves the OracleSentinel Command Center page and its protected infra API.
//
// Auth model (reuses the project's proven mechanism):
//   - Page (/priv) loads behind a login gate that posts to POST /api/admin/session
//     (ADMIN_API_KEY → HttpOnly `admin_session` JWT + `csrf_token`).
//   - The infra API is hard-gated server-side by requireAdminSession().
//     No session = 401, regardless of what the client does.
// ============================================================================

import { Router, Request, Response } from "express";
import express from "express";
import fs from "fs";
import path from "path";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import { collectInfraSnapshot } from "../services/infra-monitor.service";
import { collectFleetSnapshot } from "../services/fleet.service";
import { collectSurveillanceSnapshot } from "../services/surveillance.service";
import {
  collectWorkersSnapshot,
  getWorkerDetail,
  isValidWorkerName,
} from "../services/cloudflare.service";
import {
  getTenantConfig,
  saveTenantOverride,
  getTenantConfigVersions,
  rollbackTenantConfig,
  buildIdentityPromptBlock,
} from "../services/tenant-config.service";

// ── Page handler (mirrors factory-ui.routes / admin.routes) ──────────────────

let cachedHtml: string | null = null;

function resolvePrivHtmlPath(): string {
  const candidates = [
    path.join(__dirname, "../views/priv.html"),
    path.join(__dirname, "../../src/views/priv.html"),
    path.join(__dirname, "../../views/priv.html"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function loadPrivHtml(): string {
  const isDev = process.env.NODE_ENV !== "production";
  // Static, non-interpolated error page. The actual error is logged
  // server-side only — never reflected into the HTTP response (no XSS).
  const errorHtml =
    `<!doctype html><meta charset="utf-8"><title>/priv unavailable</title>` +
    `<body style="font-family:system-ui;background:#050a14;color:#e5e7eb;padding:40px">` +
    `Command Center temporairement indisponible. Voir les logs serveur.</body>`;

  if (isDev) {
    const p = resolvePrivHtmlPath();
    try {
      return fs.readFileSync(p, "utf-8");
    } catch (err: any) {
      console.error("[Command Center] cannot read priv.html:", err?.message);
      return errorHtml;
    }
  }
  if (cachedHtml !== null) return cachedHtml;
  const p = resolvePrivHtmlPath();
  try {
    cachedHtml = fs.readFileSync(p, "utf-8");
    return cachedHtml;
  } catch (err: any) {
    console.error("[Command Center] cannot read priv.html:", err?.message);
    return errorHtml;
  }
}

export function privPageHandler(_req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  res.send(loadPrivHtml());
}

// ── API router ───────────────────────────────────────────────────────────────

const router = Router();

// Live infrastructure snapshot — secrets are masked inside the service layer.
router.get("/infra", requireAdminSession(), async (_req, res) => {
  try {
    const snapshot = await collectInfraSnapshot();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...snapshot });
  } catch (err: any) {
    console.error("[Command Center] infra snapshot failed:", err?.message);
    return res.status(500).json({ success: false, error: "Infra snapshot failed" });
  }
});

// Fleet overview — per-agency health + global summary so the super-admin can
// supervise the whole fleet (350+ agencies) from one screen. Read-only; the
// service masks/omits all PII & secrets and caches briefly.
router.get("/overview", requireAdminSession(), async (_req, res) => {
  try {
    const fleet = await collectFleetSnapshot();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...fleet });
  } catch (err: any) {
    console.error("[Command Center] fleet overview failed:", err?.message);
    return res
      .status(500)
      .json({ success: false, error: "Fleet overview failed" });
  }
});

// Surveillance wall — real-time per-agency monitoring built on the fleet
// snapshot + live activity (messages/conversations/leads in 24h), recent
// factory deployments and a PII-free activity feed. Read-only, briefly cached.
router.get("/surveillance", requireAdminSession(), async (_req, res) => {
  try {
    const snapshot = await collectSurveillanceSnapshot();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...snapshot });
  } catch (err: any) {
    console.error(
      "[Command Center] surveillance snapshot failed:",
      err?.message,
    );
    return res
      .status(500)
      .json({ success: false, error: "Surveillance snapshot failed" });
  }
});

// ── Cloudflare Workers (Phase 1 — read-only) ─────────────────────────────────
// Lists deployed Workers with a REAL health-ping status. Degrades gracefully if
// CLOUDFLARE_API_TOKEN/ACCOUNT_ID are not set (configured:false). No writes.
router.get("/workers", requireAdminSession(), async (_req, res) => {
  try {
    const snapshot = await collectWorkersSnapshot();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...snapshot });
  } catch (err: any) {
    console.error("[Command Center] workers snapshot failed:", err?.message);
    return res
      .status(500)
      .json({ success: false, error: "Workers snapshot failed" });
  }
});

router.get("/workers/:name", requireAdminSession(), async (req, res) => {
  const name = String(req.params.name || "");
  if (!isValidWorkerName(name)) {
    return res.status(400).json({ success: false, error: "Invalid worker name" });
  }
  try {
    const detail = await getWorkerDetail(name);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...detail });
  } catch (err: any) {
    console.error("[Command Center] worker detail failed:", err?.message);
    return res
      .status(502)
      .json({ success: false, error: "Worker detail failed" });
  }
});

// ── Per-tenant config (Phase 2 Option B — per-agency overrides) ──────────────
// READ is safe; WRITE (PUT/rollback) requires CSRF. These endpoints only store
// a whitelisted, non-secret override (branding name + personality). Until the
// runtime wiring step, saving here does NOT change any bot's behavior.

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

router.get(
  "/tenants/:tenantId/config",
  requireAdminSession(),
  async (req, res) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const record = await getTenantConfig(tenantId);
      // What the bot actually appends to the prompt for this tenant (read-only
      // preview for the QG so the admin SEES the effective instructions).
      const effectivePromptBlock = buildIdentityPromptBlock(record.override);
      // Deployed (global) config — non-secret slice. Used by the QG to pre-fill
      // the editor with REAL values and to show a "what the bot knows" panel.
      let defaults: any = null;
      try {
        const { loadCurrentConfig } = await import("../factory");
        const g = loadCurrentConfig();
        defaults = {
          branding: {
            agentName: g.branding?.agentName ?? null,
            agencyName: g.branding?.agencyName ?? null,
            logoUrl: g.branding?.logoUrl ?? null,
            primaryColor: g.branding?.themeColors?.primary ?? null,
          },
          personality: {
            writingStyle: g.personality?.writingStyle ?? null,
            toneOfVoice: g.personality?.toneOfVoice ?? null,
            maxResponseWords: g.personality?.maxResponseWords ?? null,
            language: g.personality?.language ?? null,
            systemPromptModifiers: g.personality?.systemPromptModifiers ?? [],
          },
          domain: process.env.BOT_DOMAIN || process.env.BOT_PROFILE || null,
          variables: g.variables ?? {},
          knowledgeUrls: g.knowledge?.urls ?? [],
          crmProvider: g.crm?.provider ?? "none",
        };
      } catch {
        /* defaults are best-effort */
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...record, defaults, effectivePromptBlock });
    } catch (err: any) {
      console.error("[Command Center] tenant config get failed:", err?.message);
      return res.status(500).json({ success: false, error: "Tenant config failed" });
    }
  },
);

router.put(
  "/tenants/:tenantId/config",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "64kb" }),
  async (req, res) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const payload = req.body?.override ?? req.body;
      const record = await saveTenantOverride(tenantId, payload, "admin");
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...record });
    } catch (err: any) {
      console.error("[Command Center] tenant config save failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "Tenant config save failed" });
    }
  },
);

router.get(
  "/tenants/:tenantId/config/versions",
  requireAdminSession(),
  async (req, res) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const versions = await getTenantConfigVersions(tenantId, 20);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, versions });
    } catch (err: any) {
      return res
        .status(500)
        .json({ success: false, error: "Tenant versions failed" });
    }
  },
);

router.post(
  "/tenants/:tenantId/config/rollback",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "4kb" }),
  async (req, res) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    const versionId = Number(req.body?.versionId);
    if (!Number.isFinite(versionId) || versionId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid versionId" });
    }
    try {
      const record = await rollbackTenantConfig(tenantId, versionId, "admin");
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...record });
    } catch (err: any) {
      return res
        .status(422)
        .json({ success: false, error: err?.message || "Rollback failed" });
    }
  },
);

export default router;
