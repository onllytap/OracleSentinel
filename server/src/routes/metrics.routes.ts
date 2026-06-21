// ============================================================================
// metrics.routes.ts — (T0 STUB) Real per-bot metrics (R6/R7). Filled in T5.
// ============================================================================
// Mounted under /api/priv (session-gated). Returns 501 until metrics.service
// lands in Wave 1 / T5 (measured latency probe, response rate, last activity).
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";

const router = Router();

const notImplemented = (_req: Request, res: Response) =>
  res.status(501).json({ success: false, error: "not_implemented", wave: "T5" });

router.get("/metrics", requireAdminSession(), notImplemented);
router.get("/tenants/:tenantId/metrics", requireAdminSession(), notImplemented);

export default router;
