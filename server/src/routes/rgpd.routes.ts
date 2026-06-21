// ============================================================================
// rgpd.routes.ts — (T0 STUB) GDPR export / deletion per tenant. Filled in T4.
// ============================================================================
// Mounted under /api/priv (session-gated). Returns 501 until audit.service +
// the RGPD handlers land in Wave 1 / T4. Deletion will require CSRF + a double
// confirmation and be audited (append-only, PII-safe).
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T4" });

router.get("/tenants/:tenantId/rgpd/export", requireAdminSession(), notImplemented);
router.delete("/tenants/:tenantId/rgpd", requireAdminSession(), notImplemented);

export default router;
