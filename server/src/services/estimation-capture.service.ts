import { pool } from "../db/pool";

// ============================================================================
// Module "machine à mandats" — Capture des leads vendeurs (estimation)
// ----------------------------------------------------------------------------
// Stocke chaque demande d'estimation (contact + résultat) dans estimation_leads,
// pour que l'agence puisse rappeler le vendeur. 100% fail-safe : un échec
// d'insertion ne casse JAMAIS la réponse au visiteur (on logue et on continue).
// ============================================================================

export interface EstimationLeadInput {
  tenantId?: string;
  prenom?: string;
  nom?: string;
  telephone?: string;
  email?: string;
  address?: string;
  codeCommune?: string;
  codePostal?: string;
  typeLocal?: string;
  surface?: number;
  pieces?: number;
  etat?: string;
  timeline?: string;
  estimateLow?: number;
  estimateMid?: number;
  estimateHigh?: number;
  pricePerM2?: number;
  dpe?: string;
  confidence?: string;
}

export interface EstimationLeadRow {
  id: number;
  tenant_id: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  type_local: string | null;
  surface: number | null;
  estimate_mid: number | null;
  dpe: string | null;
  created_at: string;
}

/**
 * Insère une capture vendeur. Renvoie l'id créé, ou null en cas d'échec
 * (jamais de throw — le visiteur reçoit quand même son estimation).
 */
export async function saveEstimationLead(input: EstimationLeadInput): Promise<number | null> {
  try {
    const res = await pool.query(
      `INSERT INTO estimation_leads
         (tenant_id, prenom, nom, telephone, email, address, code_commune, code_postal,
          type_local, surface, pieces, etat, timeline,
          estimate_low, estimate_mid, estimate_high, price_per_m2, dpe, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        input.tenantId || "default",
        input.prenom ?? null,
        input.nom ?? null,
        input.telephone ?? null,
        input.email ?? null,
        input.address ?? null,
        input.codeCommune ?? null,
        input.codePostal ?? null,
        input.typeLocal ?? null,
        input.surface ?? null,
        input.pieces ?? null,
        input.etat ?? null,
        input.timeline ?? null,
        input.estimateLow ?? null,
        input.estimateMid ?? null,
        input.estimateHigh ?? null,
        input.pricePerM2 ?? null,
        input.dpe ?? null,
        input.confidence ?? null,
      ],
    );
    return res?.rows?.[0]?.id ?? null;
  } catch (err) {
    console.error("[estimation-capture] saveEstimationLead failed:", (err as Error)?.message);
    return null;
  }
}

/**
 * Récupère les dernières captures vendeur d'une agence (future inbox QG).
 * Fail-safe : renvoie [] en cas d'erreur.
 */
export async function getRecentEstimationLeads(
  tenantId: string,
  limit = 50,
): Promise<EstimationLeadRow[]> {
  try {
    const res = await pool.query(
      `SELECT id, tenant_id, prenom, nom, telephone, email, address, type_local,
              surface, estimate_mid, dpe, created_at
       FROM estimation_leads
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return (res?.rows ?? []) as EstimationLeadRow[];
  } catch (err) {
    console.error("[estimation-capture] getRecentEstimationLeads failed:", (err as Error)?.message);
    return [];
  }
}

/**
 * Récupère les dernières captures vendeur de TOUTES les agences (inbox QG global).
 * Chaque ligne porte son tenant_id -> on sait à quelle agence appartient le mandat.
 * Fail-safe : renvoie [] en cas d'erreur.
 */
export async function getAllRecentEstimationLeads(limit = 200): Promise<EstimationLeadRow[]> {
  try {
    const res = await pool.query(
      `SELECT id, tenant_id, prenom, nom, telephone, email, address, type_local,
              surface, estimate_mid, dpe, created_at
       FROM estimation_leads
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return (res?.rows ?? []) as EstimationLeadRow[];
  } catch (err) {
    console.error("[estimation-capture] getAllRecentEstimationLeads failed:", (err as Error)?.message);
    return [];
  }
}
