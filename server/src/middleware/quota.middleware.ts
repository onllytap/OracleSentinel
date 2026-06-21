// ============================================================================
// quota.middleware.ts — per-tenant quota enforcement (R18, Wave 1 / T2)
// ============================================================================
// enforceQuota(kind) returns 402 Payment Required when a tenant has exhausted
// its plan quota for `kind`. It is INERT unless BILLING_ENABLED=true because
// isOverQuota() short-circuits to false when billing is disabled — so dropping
// this middleware into a route is a no-op until billing is switched on.
//
// SAFETY: fails OPEN. It never throws and never blocks a request on an internal
// error or when the tenant id cannot be resolved — quota enforcement must never
// take the product down.
// ============================================================================

import type { RequestHandler } from "express";
import { isOverQuota, type UsageKind } from "../services/billing.service";

const TENANT_ID_RE = /^[a-zA-Z0-9_.-]{1,100}$/;

/** Defensively resolve a tenant id from params / body / query. */
function resolveTenantId(req: any): string | null {
  const candidates = [
    req?.params?.tenantId,
    req?.params?.tenant_id,
    req?.body?.tenantId,
    req?.body?.tenant_id,
    req?.query?.tenantId,
    req?.query?.tenant_id,
    req?.tenantId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && TENANT_ID_RE.test(c)) return c;
  }
  return null;
}

export function enforceQuota(kind: UsageKind): RequestHandler {
  return async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      // Can't identify the tenant → cannot enforce; let the request through.
      if (!tenantId) return next();

      // isOverQuota() already returns false when BILLING_ENABLED is off, so this
      // is automatically a no-op while billing is disabled.
      if (await isOverQuota(tenantId, kind)) {
        return res.status(402).json({ error: "over_quota", kind });
      }
      return next();
    } catch {
      // Fail open: never break the route because of quota checks.
      return next();
    }
  };
}
