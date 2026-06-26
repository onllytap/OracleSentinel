// ============================================================================
// mandates.routes.ts — Inbox "Mandats" (leads vendeurs) du Command Center
// ============================================================================
// Monté sous /api/priv (session-gated). Expose les captures d'estimation
// (estimation_leads) : les vendeurs à rappeler, avec l'agence propriétaire.
// Style calqué sur metrics.routes : requireAdminSession() par handler,
// Cache-Control no-store, try/catch qui logue et renvoie une erreur générique.
// ============================================================================

import { Router, Request, Response } from "express";
import { requireAdminSession } from "../middleware/admin-session";
import {
  getAllRecentEstimationLeads,
  getRecentEstimationLeads,
} from "../services/estimation-capture.service";

const router = Router();

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// Liste des mandats (vendeurs captés). Optionnel ?tenantId= pour filtrer par agence.
router.get("/mandates", requireAdminSession(), async (req: Request, res: Response) => {
  try {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : "";
    const mandates = tenantId
      ? isValidTenantId(tenantId)
        ? await getRecentEstimationLeads(tenantId)
        : []
      : await getAllRecentEstimationLeads();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, mandates });
  } catch (err: any) {
    console.error("[Command Center] mandates failed:", err?.message);
    return res.status(500).json({ success: false, error: "Mandates failed" });
  }
});

export default router;
