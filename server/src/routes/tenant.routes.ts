// ============================================================================
// tenant.routes.ts — (T0 STUB) Agency provisioning (R19). Filled in Wave 1 / T3.
// ============================================================================
// Mounted under /api/priv. Endpoints are session-gated and return 501 until the
// provisioning service (services/tenant.service.ts) lands in T3. Paths are
// specific (no catch-all) so this router never shadows command-center.routes.
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T3" });

router.get("/tenants", requireAdminSession(), notImplemented);
router.post("/tenants/provision", requireAdminSession(), notImplemented);
router.get("/tenants/:tenantId", requireAdminSession(), notImplemented);
router.post("/tenants/:tenantId/status", requireAdminSession(), notImplemented);

export default router;
