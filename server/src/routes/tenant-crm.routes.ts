// ============================================================================
// tenant-crm.routes.ts — Per-agency CRM config (R17 / T1)
// ============================================================================
// Mounted under /api/priv (gated by adminIpAllowlist + requireAdminSession).
// Reads return the PUBLIC config (NEVER secrets — only `hasCredentials`).
// Writes require CSRF (double-submit). All responses are `Cache-Control:
// no-store` and surface only non-secret error codes.
//
// Style mirrors command-center.routes.ts (isValidTenantId, per-route
// express.json, { success, error } shape).
// ============================================================================

import { Router } from "express";
import express from "express";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import {
  getTenantCrmConfig,
  saveTenantCrmConfig,
  testTenantCrmConnection,
} from "../services/tenant-crm.service";

const router = Router();

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// ── Read config (no secrets) ────────────────────────────────────────────────
router.get("/tenants/:tenantId/crm", requireAdminSession(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const tenantId = String(req.params.tenantId || "");
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ success: false, error: "invalid_tenant_id" });
  }
  try {
    const config = await getTenantCrmConfig(tenantId);
    return res.json({ success: true, ...config });
  } catch (err: any) {
    console.error("[tenant-crm] get config failed:", err?.message);
    return res
      .status(500)
      .json({ success: false, error: "tenant_crm_get_failed" });
  }
});

// ── Save config (CSRF) ──────────────────────────────────────────────────────
router.put(
  "/tenants/:tenantId/crm",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "32kb" }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res
        .status(400)
        .json({ success: false, error: "invalid_tenant_id" });
    }
    try {
      const config = await saveTenantCrmConfig(tenantId, req.body ?? {}, "admin");
      return res.json({ success: true, ...config });
    } catch (err: any) {
      const msg = err?.message || "";
      // Known, non-secret validation errors → 400.
      if (msg === "invalid_provider" || msg === "encryption_not_configured") {
        return res.status(400).json({ success: false, error: msg });
      }
      console.error("[tenant-crm] save config failed:", msg);
      return res
        .status(500)
        .json({ success: false, error: "tenant_crm_save_failed" });
    }
  },
);

// ── Test connection (CSRF) ──────────────────────────────────────────────────
router.post(
  "/tenants/:tenantId/crm/test",
  requireAdminSession(),
  requireCSRF(),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res
        .status(400)
        .json({ success: false, error: "invalid_tenant_id" });
    }
    try {
      const result = await testTenantCrmConnection(tenantId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[tenant-crm] test connection failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "tenant_crm_test_failed" });
    }
  },
);

export default router;
