// ============================================================================
// tenant.routes.ts — Agency provisioning (R19, Wave 1 / T3)
// ============================================================================
// Mounted under /api/priv (super-admin), behind adminIpAllowlist() at the mount
// and requireAdminSession() per route. Provisions new agencies (tenants), lists
// them, fetches one, and toggles status.
//
// SHADOWING: paths are SPECIFIC (no catch-all/wildcard). In particular
// GET /tenants/:tenantId is a SINGLE-segment path and therefore does NOT match
// /tenants/:tenantId/config (owned by command-center.routes, which is also
// mounted first under /api/priv). The two routers never collide.
//
// STYLE: mirrors command-center.routes.ts — Cache-Control: no-store, a
// per-handler try/catch, requireAdminSession() on reads, +requireCSRF() and a
// small express.json() body limit on writes. No secrets are ever returned.
// ============================================================================

import { Router } from "express";
import express from "express";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import {
  listTenants,
  getTenant,
  provisionTenant,
  setTenantStatus,
  type TenantStatus,
} from "../services/tenant.service";

const router = Router();

// Accepts existing/historical ids too (dots allowed), like command-center.
const TENANT_ID_RE = /^[a-zA-Z0-9_.-]{1,100}$/;
// Stricter R19 shape used when a tenantId is supplied at provision time.
const PROVISION_TENANT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const VALID_STATUSES: readonly TenantStatus[] = [
  "active",
  "suspended",
  "archived",
];
const MAX_NAME = 160;

function isValidTenantId(id: string): boolean {
  return TENANT_ID_RE.test(id);
}

// GET /tenants — list all agencies (no secrets).
router.get("/tenants", requireAdminSession(), async (_req, res) => {
  try {
    const tenants = await listTenants();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, tenants });
  } catch (err: any) {
    console.error("[tenant.routes] list tenants failed:", err?.message);
    return res
      .status(500)
      .json({ success: false, error: "List tenants failed" });
  }
});

// POST /tenants/provision — create a new agency + return a copyable embed snippet.
router.post(
  "/tenants/provision",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "8kb" }),
  async (req, res) => {
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!rawName) {
      return res
        .status(400)
        .json({ success: false, error: "Tenant name is required" });
    }
    const name = rawName.slice(0, MAX_NAME);

    const plan = typeof req.body?.plan === "string" ? req.body.plan : undefined;

    const tenantIdRaw =
      typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (tenantIdRaw && !PROVISION_TENANT_ID_RE.test(tenantIdRaw)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }

    try {
      const { tenant, embedSnippet } = await provisionTenant({
        name,
        plan,
        tenantId: tenantIdRaw || undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, tenant, embedSnippet });
    } catch (err: any) {
      console.error("[tenant.routes] provision failed:", err?.message);
      return res
        .status(422)
        .json({ success: false, error: err?.message || "Provision failed" });
    }
  },
);

// GET /tenants/:tenantId — fetch one agency (404 if unknown). Single-segment
// path: does NOT shadow /tenants/:tenantId/config (command-center.routes).
router.get("/tenants/:tenantId", requireAdminSession(), async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ success: false, error: "Invalid tenant id" });
  }
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, error: "Tenant not found" });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, tenant });
  } catch (err: any) {
    console.error("[tenant.routes] get tenant failed:", err?.message);
    return res.status(500).json({ success: false, error: "Get tenant failed" });
  }
});

// POST /tenants/:tenantId/status — suspend / archive / reactivate an agency.
router.post(
  "/tenants/:tenantId/status",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "4kb" }),
  async (req, res) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid tenant id" });
    }
    const status = req.body?.status;
    if (
      typeof status !== "string" ||
      !(VALID_STATUSES as readonly string[]).includes(status)
    ) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    try {
      const tenant = await setTenantStatus(tenantId, status as TenantStatus, "admin");
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, tenant });
    } catch (err: any) {
      const msg = err?.message || "Update status failed";
      const code = msg === "Tenant not found" ? 404 : 422;
      console.error("[tenant.routes] set status failed:", msg);
      return res.status(code).json({ success: false, error: msg });
    }
  },
);

export default router;
