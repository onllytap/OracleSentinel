// ============================================================================
// tenant-crm.routes.ts — (T0 STUB) Per-agency CRM config (R17). Filled in T1.
// ============================================================================
// Mounted under /api/priv. Session-gated, returns 501 until tenant-crm.service
// lands in Wave 1 / T1. Responses NEVER include secrets (enforced in T1).
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T1" });

router.get("/tenants/:tenantId/crm", requireAdminSession(), notImplemented);
router.put("/tenants/:tenantId/crm", requireAdminSession(), notImplemented);
router.post("/tenants/:tenantId/crm/test", requireAdminSession(), notImplemented);

export default router;
