import { pool } from "../db/pool";

// ============================================================================
// Module "machine à mandats" — Moteur d'estimation (DVF, open data)
// ----------------------------------------------------------------------------
// Produit une FOURCHETTE INDICATIVE de prix à partir des ventes réelles
// (Demandes de Valeurs Foncières) proches : médiane €/m² × surface, bornée par
// les quartiles. Ce n'est PAS une estimation officielle — juste de quoi amorcer
// la conversation et qualifier le vendeur. 100% fail-safe : en cas d'erreur DB
// ou de données insuffisantes, renvoie { available: false } sans jamais crasher.
// ============================================================================

export const ESTIMATION_DISCLAIMER =
  "Fourchette indicative basée sur les ventes réelles du secteur (données publiques DVF). " +
  "Ce n'est pas une estimation officielle : seule une visite par un conseiller permet une valeur précise.";

export type TypeLocal = "Maison" | "Appartement";
export type Confidence = "low" | "medium" | "high";

export interface DvfComparable {
  valeurFonciere: number;
  surface: number;
}

export interface EstimateResult {
  available: boolean;
  reason?: string;
  surface?: number;
  pricePerM2Median?: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  sampleSize?: number;
  confidence?: Confidence;
  disclaimer: string;
}

export interface EstimateParams {
  codeCommune?: string;
  codePostal?: string;
  typeLocal: TypeLocal;
  surface: number;
}

// ── Pure stats helpers (exportés pour les tests) ───────────────────────────

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  if (values.length === 1) return values[0];
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = s[base + 1];
  return next !== undefined ? s[base] + rest * (next - s[base]) : s[base];
}

// ── Calcul de la fourchette (pure, testable sans DB) ───────────────────────

/**
 * Calcule une fourchette d'estimation à partir de comparables DVF.
 * Filtre les aberrations (garages, erreurs de saisie) via un €/m² plausible.
 */
export function computeEstimate(
  comparables: DvfComparable[],
  surface: number,
): EstimateResult {
  if (!Number.isFinite(surface) || surface <= 8) {
    return { available: false, reason: "surface_invalide", disclaimer: ESTIMATION_DISCLAIMER };
  }

  const pricePerM2 = comparables
    .filter((c) => Number.isFinite(c.surface) && Number.isFinite(c.valeurFonciere))
    .filter((c) => c.surface > 8 && c.valeurFonciere > 5000)
    .map((c) => c.valeurFonciere / c.surface)
    // borne les aberrations (garages/dépendances/erreurs) : €/m² réaliste FR
    .filter((v) => v >= 200 && v <= 30000);

  if (pricePerM2.length < 3) {
    return {
      available: false,
      reason: "donnees_insuffisantes",
      sampleSize: pricePerM2.length,
      disclaimer: ESTIMATION_DISCLAIMER,
    };
  }

  const med = median(pricePerM2)!;
  const q1 = quantile(pricePerM2, 0.25)!;
  const q3 = quantile(pricePerM2, 0.75)!;
  const roundK = (n: number) => Math.round(n / 1000) * 1000;

  const confidence: Confidence =
    pricePerM2.length >= 20 ? "high" : pricePerM2.length >= 8 ? "medium" : "low";

  return {
    available: true,
    surface,
    pricePerM2Median: Math.round(med),
    lowPrice: roundK(q1 * surface),
    midPrice: roundK(med * surface),
    highPrice: roundK(q3 * surface),
    sampleSize: pricePerM2.length,
    confidence,
    disclaimer: ESTIMATION_DISCLAIMER,
  };
}

// ── Accès données (fail-safe) ──────────────────────────────────────────────

/**
 * Récupère les ventes comparables récentes pour une commune/code postal + type.
 * Toujours fail-safe : renvoie [] en cas d'erreur (le bot continue).
 */
export async function getComparables(params: {
  codeCommune?: string;
  codePostal?: string;
  typeLocal: TypeLocal;
  years?: number;
  limit?: number;
}): Promise<DvfComparable[]> {
  const { codeCommune, codePostal, typeLocal } = params;
  const years = params.years ?? 5;
  const limit = params.limit ?? 500;

  if (!codeCommune && !codePostal) return [];

  try {
    const where: string[] = [
      "surface_reelle_bati > 8",
      "valeur_fonciere > 5000",
      "type_local = $1",
    ];
    const vals: unknown[] = [typeLocal];

    if (codeCommune) {
      vals.push(codeCommune);
      where.push(`code_commune = $${vals.length}`);
    } else {
      vals.push(codePostal);
      where.push(`code_postal = $${vals.length}`);
    }

    vals.push(years);
    const yearsIdx = vals.length;
    vals.push(limit);
    const limitIdx = vals.length;

    const sql = `
      SELECT valeur_fonciere AS "valeurFonciere", surface_reelle_bati AS "surface"
      FROM dvf_sales
      WHERE ${where.join(" AND ")}
        AND date_mutation >= (NOW() - make_interval(years => $${yearsIdx}::int))
      ORDER BY date_mutation DESC
      LIMIT $${limitIdx}
    `;

    const res = await pool.query(sql, vals);
    return (res?.rows ?? [])
      .map((r: { valeurFonciere: unknown; surface: unknown }) => ({
        valeurFonciere: Number(r.valeurFonciere),
        surface: Number(r.surface),
      }))
      .filter((c) => Number.isFinite(c.valeurFonciere) && Number.isFinite(c.surface));
  } catch (err) {
    console.error("[estimation] getComparables failed:", (err as Error)?.message);
    return [];
  }
}

/**
 * Estimation complète : récupère les comparables puis calcule la fourchette.
 * Essaie d'abord par commune (précis), retombe sur le code postal si besoin.
 */
export async function estimateProperty(params: EstimateParams): Promise<EstimateResult> {
  let comparables = await getComparables({
    codeCommune: params.codeCommune,
    typeLocal: params.typeLocal,
  });

  // Fallback élargi : code postal si la commune n'a pas assez de ventes.
  if (comparables.length < 3 && params.codePostal) {
    comparables = await getComparables({
      codePostal: params.codePostal,
      typeLocal: params.typeLocal,
    });
  }

  return computeEstimate(comparables, params.surface);
}
