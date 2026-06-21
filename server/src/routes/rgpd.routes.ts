// ============================================================================
// rgpd.routes.ts — GDPR (RGPD) data export & erasure, per tenant (T4)
// ============================================================================
// Mounted under /api/priv (super-admin, session-gated). Every action is
// recorded through the append-only, PII-safe audit log (audit.service).
//
//   GET    /tenants/:tenantId/rgpd/export  → full per-tenant data export (JSON)
//   DELETE /tenants/:tenantId/rgpd         → SOFT anonymisation of the tenant's
//                                            leads (email / phone → NULL).
//
// Security model (mirrors command-center.routes.ts):
//   - requireAdminSession() on every route.
//   - requireCSRF() on the destructive DELETE (double-submit cookie).
//   - DELETE additionally requires an in-body DOUBLE confirmation
//       { confirm:true, confirmTenantId:<must equal :tenantId> }
//     to prevent accidental erasure.
//   - SOFT anonymisation by default: rows are KEPT (referential integrity &
//     aggregate analytics) but the PII columns are nulled — never a destructive
//     row DROP. The append-only audit_log is never touched by this erasure.
//   - tenantId is strictly validated and Cache-Control: no-store on every
//     response. Errors are logged server-side only (never reflected).
// ============================================================================

import { Router, Request, Response } from "express";
import express from "express";
import { pool } from "../db/pool";
import { requireAdminSession, requireCSRF } from "../middleware/admin-session";
import { appendAudit } from "../services/audit.service";

const router = Router();

// Generous per-table cap so a normal tenant export is complete, while still
// bounding the response for a pathologically large tenant.
const EXPORT_ROW_LIMIT = 5000;

function isValidTenantId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,100}$/.test(id);
}

// ── GET export ───────────────────────────────────────────────────────────────
// Returns the tenant's leads, conversations and messages as JSON. This payload
// legitimately contains PII (that is the point of an RGPD export); the AUDIT
// entry, by contrast, records only the tenant id — no PII, no row contents.
router.get(
  "/tenants/:tenantId/rgpd/export",
  requireAdminSession(),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }

    try {
      const [leads, conversations, messages] = await Promise.all([
        pool.query(
          `SELECT id, tenant_id, conversation_id, email, phone, tools_mentioned,
                  automation_needs, timeline, chat_summary, created_at
             FROM leads
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [tenantId, EXPORT_ROW_LIMIT],
        ),
        pool.query(
          `SELECT id, tenant_id, session_id, status, created_at, updated_at
             FROM conversations
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [tenantId, EXPORT_ROW_LIMIT],
        ),
        pool.query(
          `SELECT id, tenant_id, conversation_id, role, content, created_at
             FROM messages
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [tenantId, EXPORT_ROW_LIMIT],
        ),
      ]);

      // Audit the access (PII-safe: tenant id only, no row payload).
      await appendAudit({
        actor: "admin",
        action: "rgpd.export",
        targetType: "tenant",
        targetId: tenantId,
      });

      return res.json({
        success: true,
        tenantId,
        exportedAt: new Date().toISOString(),
        leads: leads.rows,
        conversations: conversations.rows,
        messages: messages.rows,
      });
    } catch (err: any) {
      console.error("[RGPD] export failed:", err?.message);
      return res.status(500).json({ success: false, error: "RGPD export failed" });
    }
  },
);

// ── DELETE (soft anonymisation) ───────────────────────────────────────────────
// Nulls the PII columns (email, phone) of the tenant's leads. Rows are kept.
// Requires CSRF + an explicit in-body double confirmation.
router.delete(
  "/tenants/:tenantId/rgpd",
  requireAdminSession(),
  requireCSRF(),
  express.json({ limit: "4kb" }),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const tenantId = String(req.params.tenantId || "");
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ success: false, error: "Invalid tenant id" });
    }

    // Double confirmation: an explicit boolean AND the tenant id echoed back.
    const confirmed = req.body?.confirm === true;
    const confirmTenantId = String(req.body?.confirmTenantId ?? "");
    if (!confirmed || confirmTenantId !== tenantId) {
      return res.status(400).json({
        success: false,
        error:
          "Double confirmation required: send { confirm: true, confirmTenantId: <tenantId> }.",
      });
    }

    try {
      const result = await pool.query(
        `UPDATE leads
            SET email = NULL,
                phone = NULL
          WHERE tenant_id = $1`,
        [tenantId],
      );
      const anonymized = result.rowCount ?? 0;

      await appendAudit({
        actor: "admin",
        action: "rgpd.delete",
        targetType: "tenant",
        targetId: tenantId,
        meta: { mode: "soft" },
      });

      return res.json({ success: true, anonymized });
    } catch (err: any) {
      console.error("[RGPD] anonymisation failed:", err?.message);
      return res
        .status(500)
        .json({ success: false, error: "RGPD deletion failed" });
    }
  },
);

export default router;
