// ============================================================================
// billing.routes.ts — Billing & quotas MANAGEMENT (R18, Wave 1 / T2)
// ============================================================================
// Mounted under /api/priv (super-admin, session-gated). Read endpoints expose
// ONLY public, non-secret billing data (plans, usage vs quota, public
// subscription view). The mutation (PUT plan) is CSRF-protected.
//
// NOTE: the Stripe WEBHOOK is NOT here — it is a PUBLIC raw-body route mounted
// in index.ts BEFORE express.json (signature-verified in billing.service).
//
// Style mirrors command-center.routes.ts (validation, try/catch, Cache-Control).
// ============================================================================

import { Router, Request, Response } from "express";
import express from "express";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import {
  getPlans,
  getQuotaStatus,
  getSubscription,
  type PlanId,
} from "../services/billing.service";
import { pool } from "../db/pool";

const router = Router();

const PLAN_IDS: readonly PlanId[] = ["starter", "pro", "scale"];

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// ── Plans catalogue (public, non-secret pricing + quotas) ────────────────────
router.get("/billing/plans", requireAdminSession(), async (_req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, plans: getPlans() });
  } catch (err: any) {
    console.error("[Billing] plans failed:", err?.message);
    return res.status(500).json({ success: false, error: "Plans failed" });
  }
});

// ── Per-tenant billing: usage vs quota + public subscription view ────────────
router.get(
  "/tenants/:tenantId/billing",
  requireAdminSession(),
  async (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const status = await getQuotaStatus(tenantId);
      const subscription = await getSubscription(tenantId);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...status, subscription });
    } catch (err: any) {
      console.error("[Billing] tenant billing failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "Tenant billing failed" });
    }
  },
);

// ── Set a tenant's plan (manual admin override; CSRF-protected) ──────────────
router.put(
  "/tenants/:tenantId/billing/plan",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    const plan = String(req.body?.plan || "");
    if (!(PLAN_IDS as readonly string[]).includes(plan)) {
      return res.status(400).json({ success: false, error: "Invalid plan" });
    }
    try {
      // Upsert the plan. A brand-new row starts at status 'none' (no Stripe
      // subscription yet); an existing row keeps its Stripe linkage + status.
      await pool.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan, status, updated_at)
         VALUES ($1, $2, 'none', NOW())
         ON CONFLICT (tenant_id) DO UPDATE
           SET plan = EXCLUDED.plan, updated_at = NOW()`,
        [tenantId, plan],
      );
      const status = await getQuotaStatus(tenantId);
      const subscription = await getSubscription(tenantId);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...status, subscription });
    } catch (err: any) {
      console.error("[Billing] update plan failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "Update plan failed" });
    }
  },
);

export default router;
