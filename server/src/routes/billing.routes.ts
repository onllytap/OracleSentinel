// ============================================================================
// billing.routes.ts — (T0 STUB) Billing & quotas MANAGEMENT (R18). Filled in T2.
// ============================================================================
// Mounted under /api/priv (session-gated). Returns 501 until billing.service
// lands in Wave 1 / T2. NOTE: the Stripe WEBHOOK is NOT here — it is a PUBLIC
// raw-body route mounted in index.ts BEFORE express.json (signature-verified).
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T2" });

router.get("/billing/plans", requireAdminSession(), notImplemented);
router.get("/tenants/:tenantId/billing", requireAdminSession(), notImplemented);
router.put("/tenants/:tenantId/billing/plan", requireAdminSession(), notImplemented);

export default router;
