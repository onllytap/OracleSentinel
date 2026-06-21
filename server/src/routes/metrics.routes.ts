// ============================================================================
// metrics.routes.ts — Real per-bot metrics (R6 / R7)
// ============================================================================
// Mounted under /api/priv (session-gated). Exposes the measured metrics
// produced by metrics.service: live latency probe, response rate, message
// count and last activity — per bot and across the fleet.
//
// Style mirrors command-center.routes: requireAdminSession() on every handler,
// `Cache-Control: no-store` on responses, and a try/catch per handler that logs
// server-side and returns a generic error (never leaks internals / secrets).
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";
import { getBotMetrics, getFleetMetrics } from "../services/metrics.service";

const router = Router();

/** Tenant id guard — same charset/length rule as command-center.routes. */
function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// Fleet metrics — measured metrics for every tenant (latency probed once and
// reused, see metrics.service). Read-only; the service degrades to zeros/null
// rather than throwing.
router.get("/metrics", requireAdminSession(), async (_req: Request, res: Response) => {
  try {
    const metrics = await getFleetMetrics();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, metrics });
  } catch (err: any) {
    console.error("[Command Center] fleet metrics failed:", err?.message);
    return res.status(500).json({ success: false, error: "Fleet metrics failed" });
  }
});

// Per-bot metrics (R6.1) — measured metrics for a single tenant.
router.get(
  "/tenants/:tenantId/metrics",
  requireAdminSession(),
  async (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const metrics = await getBotMetrics(tenantId);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...metrics });
    } catch (err: any) {
      console.error("[Command Center] tenant metrics failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "Tenant metrics failed" });
    }
  },
);

export default router;
