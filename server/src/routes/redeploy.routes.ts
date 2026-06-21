// ============================================================================
// redeploy.routes.ts — (T0 STUB) Remote redeploy of a single bot (R3/R4). T9.
// ============================================================================
// Mounted under /api/priv (session-gated). Returns 501 until redeploy.service
// lands in Wave 2 / T9 (single-flight per tenant, rollback on failure, active
// config version reporting). Mutations will require CSRF + explicit confirm.
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T9" });

router.get("/tenants/:tenantId/redeploy", requireAdminSession(), notImplemented);
router.post("/tenants/:tenantId/redeploy", requireAdminSession(), notImplemented);

export default router;
