// ============================================================================
// redeploy.routes.ts — controlled per-bot redeploy (R3/R4). T9.
// ============================================================================
// Mounted under /api/priv (session-gated). Replaces the T0 501 stub.
//
//   GET  /tenants/:tenantId/redeploy  → current redeploy state (+ out-of-date
//                                       hint vs the latest saved config).
//   POST /tenants/:tenantId/redeploy  → trigger a single-flight redeploy. Needs
//                                       CSRF + an explicit { confirm:true } body
//                                       (R3.8). Returns the resulting state.
//
// Mirrors command-center.routes.ts: requireAdminSession (+ requireCSRF on the
// mutation), strict tenantId validation, `Cache-Control: no-store`, small JSON
// body cap, and per-handler try/catch. Single-segment paths only → never
// shadows command-center's /tenants/:tenantId/config. Secrets are never logged
// or returned.
// ============================================================================

import { Router, Request, Response } from "express";
import express from "express";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import {
  getRedeployState,
  getLatestConfigVersion,
  isOutOfDate,
  requestRedeploy,
} from "../services/redeploy.service";

const router = Router();

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// Current redeploy state for a tenant (read-only; safe).
router.get(
  "/tenants/:tenantId/redeploy",
  requireAdminSession(),
  async (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    try {
      const state = await getRedeployState(tenantId);
      // Best-effort: a version-lookup hiccup must not break the status read.
      let latestVersion: number | null = null;
      try {
        latestVersion = await getLatestConfigVersion(tenantId);
      } catch {
        latestVersion = null;
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        state,
        latestVersion,
        outOfDate: isOutOfDate(state.activeVersion, latestVersion),
      });
    } catch (err: any) {
      console.error("[redeploy] state failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "Redeploy state failed" });
    }
  },
);

// Trigger a controlled redeploy. CSRF + explicit confirmation required (R3.8).
router.post(
  "/tenants/:tenantId/redeploy",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "4kb" }),
  async (req: Request, res: Response) => {
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }
    if (req.body?.confirm !== true) {
      return res
        .status(400)
        .json({ success: false, error: "Confirmation required" });
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const state = await requestRedeploy(tenantId, "admin");
      return res.json({ success: true, state });
    } catch (err: any) {
      // Only the single-flight conflict surfaces as a throw → map it to 409.
      if (err?.message === "redeploy_in_progress") {
        return res
          .status(409)
          .json({ success: false, error: "redeploy_in_progress" });
      }
      console.error("[redeploy] request failed:", err?.message);
      return res.status(500).json({ success: false, error: "Redeploy failed" });
    }
  },
);

export default router;
