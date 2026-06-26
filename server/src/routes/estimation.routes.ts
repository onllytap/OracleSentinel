import { Router, Request, Response } from "express";
import { estimateProperty, type TypeLocal, type EstimateResult } from "../services/estimation.service";
import { geocodeAddress, lookupDpe, dpeImpactMessage } from "../services/dpe.service";
import { saveEstimationLead } from "../services/estimation-capture.service";
import { getTenantByWidgetId, getTenant } from "../services/tenant.service";

// ============================================================================
// Module "machine à mandats" — Endpoint public d'estimation
// ----------------------------------------------------------------------------
// POST /api/estimate : un propriétaire estime son bien (adresse + type + surface)
//   -> géocodage BAN -> estimation DVF -> DPE ADEME -> capture du lead vendeur.
// Public (comme un "Estimez votre bien"), couvert par le rate-limiter /api/.
// La logique vit dans runEstimation() (export pour les tests, sans Express).
// ============================================================================

const VALID_TYPES = new Set<TypeLocal>(["Maison", "Appartement"]);

export interface EstimationInput {
  address?: unknown;
  codePostal?: unknown;
  typeLocal?: unknown;
  surface?: unknown;
  pieces?: unknown;
  etat?: unknown;
  timeline?: unknown;
  prenom?: unknown;
  nom?: unknown;
  telephone?: unknown;
  email?: unknown;
  widgetId?: unknown;
  tenantId?: unknown;
}

export interface EstimationResponse {
  ok: boolean;
  error?: string;
  estimate?: EstimateResult;
  dpe?: { available: boolean; etiquette?: string; message: string };
  location?: { codeCommune?: string; codePostal?: string; label?: string };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Cœur métier (sans Express) — testable directement.
 * Renvoie { ok:false, error } pour une entrée invalide (route -> 400).
 * Pour une panne de service (DVF/BAN/ADEME), renvoie ok:true avec
 * estimate.available=false : on a quand même capturé le lead + donné le DPE.
 */
export async function runEstimation(body: EstimationInput): Promise<EstimationResponse> {
  const address = asString(body.address);
  const codePostalInput = asString(body.codePostal);
  const typeLocalRaw = asString(body.typeLocal);
  const surface = asNumber(body.surface);
  const pieces = asNumber(body.pieces);
  const etat = asString(body.etat);
  const timeline = asString(body.timeline);
  const prenom = asString(body.prenom);
  const nom = asString(body.nom);
  const telephone = asString(body.telephone);
  const email = asString(body.email);
  const widgetId = asString(body.widgetId);
  const tenantIdInput = asString(body.tenantId);

  // ── Validation (entrée du visiteur) ──────────────────────────────────────
  const typeLocal = (typeLocalRaw &&
    (typeLocalRaw.charAt(0).toUpperCase() + typeLocalRaw.slice(1).toLowerCase())) as
    | TypeLocal
    | undefined;
  if (!typeLocal || !VALID_TYPES.has(typeLocal)) {
    return { ok: false, error: "type_invalide" };
  }
  if (surface === undefined || surface <= 8 || surface > 10000) {
    return { ok: false, error: "surface_invalide" };
  }
  if (!address && !codePostalInput) {
    return { ok: false, error: "adresse_manquante" };
  }
  // Un lead doit être joignable (sinon inutile pour l'agence).
  if (!telephone && !email) {
    return { ok: false, error: "contact_manquant" };
  }

  // ── Géocodage (BAN) — best-effort ────────────────────────────────────────
  let codeCommune: string | undefined;
  let codePostal = codePostalInput;
  let label: string | undefined;
  if (address) {
    const geo = await geocodeAddress(address);
    if (geo) {
      codeCommune = geo.codeCommune || undefined;
      codePostal = geo.codePostal || codePostal;
      label = geo.label;
    }
  }

  // ── Estimation (DVF) ─────────────────────────────────────────────────────
  const estimate = await estimateProperty({ codeCommune, codePostal, typeLocal, surface });

  // ── DPE (ADEME) — best-effort ────────────────────────────────────────────
  const dpeRes = await lookupDpe({ address, codePostal });
  const dpe = {
    available: dpeRes.available,
    etiquette: dpeRes.etiquetteDpe,
    message: dpeImpactMessage(dpeRes.etiquetteDpe),
  };

  // ── Attribution à l'agence : widget_id (embarqué sur son site) -> tenant. ─
  // Fail-safe : widget/tenant inconnu ou erreur DB -> "default" (jamais de crash).
  let tenantId = "default";
  if (widgetId) {
    const t = await getTenantByWidgetId(widgetId);
    if (t) tenantId = t.tenantId;
  } else if (tenantIdInput) {
    const t = await getTenant(tenantIdInput);
    if (t) tenantId = t.tenantId;
  }

  // ── Capture du lead vendeur (fail-safe) ──────────────────────────────────
  await saveEstimationLead({
    tenantId,
    prenom,
    nom,
    telephone,
    email,
    address,
    codeCommune,
    codePostal,
    typeLocal,
    surface,
    pieces,
    etat,
    timeline,
    estimateLow: estimate.lowPrice,
    estimateMid: estimate.midPrice,
    estimateHigh: estimate.highPrice,
    pricePerM2: estimate.pricePerM2Median,
    dpe: dpe.etiquette,
    confidence: estimate.confidence,
  });

  return {
    ok: true,
    estimate,
    dpe,
    location: { codeCommune, codePostal, label },
  };
}

// ── Routeur Express ──────────────────────────────────────────────────────────
const router = Router();

router.post("/estimate", async (req: Request, res: Response) => {
  try {
    const result = await runEstimation((req.body ?? {}) as EstimationInput);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error("[estimation] /estimate failed:", (err as Error)?.message);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
