// ============================================================================
// Module "machine à mandats" — Adresse (BAN) + DPE (ADEME)
// ----------------------------------------------------------------------------
// - geocodeAddress : normalise une adresse libre via la Base Adresse Nationale
//   (api-adresse.data.gouv.fr) -> { lat, lon, codeCommune (INSEE), codePostal }.
//   Le codeCommune alimente directement le moteur d'estimation (DVF).
// - lookupDpe : récupère le DPE existant d'un logement via l'open data ADEME.
// - dpeImpactMessage : message humain (angle "anxiété DPE 2026") — pur.
//
// 100% fail-safe : toute erreur réseau/HTTP renvoie un résultat "indisponible"
// SANS jamais throw. Le chatbot doit continuer même si ces API sont down.
// Endpoints surchargés via .env (BAN_API_URL / ADEME_DPE_API_URL) si besoin.
// ============================================================================

const BAN_URL = process.env.BAN_API_URL || "https://api-adresse.data.gouv.fr/search/";
const ADEME_DPE_URL =
  process.env.ADEME_DPE_API_URL ||
  "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";
const HTTP_TIMEOUT_MS = 6000;

export interface GeocodeResult {
  lat: number;
  lon: number;
  codeCommune: string;
  codePostal: string;
  label: string;
  score: number;
}

export interface DpeResult {
  available: boolean;
  etiquetteDpe?: string;
  etiquetteGes?: string;
  reason?: string;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

/**
 * Normalise une adresse libre via la BAN. Renvoie null si introuvable / erreur.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address || address.trim().length < 3) return null;

  try {
    const url = `${BAN_URL}?q=${encodeURIComponent(address.trim())}&limit=1`;
    const res = await fetch(url, { signal: timeoutSignal(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { citycode?: string; postcode?: string; label?: string; score?: number };
      }>;
    };

    const feature = data?.features?.[0];
    if (!feature) return null;

    const coords = feature.geometry?.coordinates;
    const props = feature.properties ?? {};
    const lon = coords?.[0];
    const lat = coords?.[1];
    if (typeof lat !== "number" || typeof lon !== "number") return null;

    return {
      lat,
      lon,
      codeCommune: props.citycode ?? "",
      codePostal: props.postcode ?? "",
      label: props.label ?? address.trim(),
      score: typeof props.score === "number" ? props.score : 0,
    };
  } catch (err) {
    console.error("[dpe] geocodeAddress failed:", (err as Error)?.message);
    return null;
  }
}

/**
 * Récupère le DPE existant le plus récent pour une adresse (best-effort).
 * Tous les biens n'ont pas de DPE enregistré -> { available: false } est normal.
 */
export async function lookupDpe(params: {
  address?: string;
  codePostal?: string;
}): Promise<DpeResult> {
  const q = params.address?.trim();
  if (!q && !params.codePostal) {
    return { available: false, reason: "adresse_manquante" };
  }

  try {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("size", "1");
    qs.set("sort", "-date_etablissement_dpe");

    const url = `${ADEME_DPE_URL}?${qs.toString()}`;
    const res = await fetch(url, { signal: timeoutSignal(HTTP_TIMEOUT_MS) });
    if (!res.ok) return { available: false, reason: `http_${res.status}` };

    const data = (await res.json()) as { results?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
    const row = data?.results?.[0] ?? data?.data?.[0];
    if (!row) return { available: false, reason: "non_trouve" };

    const etiquette =
      (row["etiquette_dpe"] as string) ??
      (row["Etiquette_DPE"] as string) ??
      (row["classe_dpe"] as string);
    const ges = (row["etiquette_ges"] as string) ?? (row["Etiquette_GES"] as string);

    if (!etiquette) return { available: false, reason: "champ_absent" };

    return {
      available: true,
      etiquetteDpe: String(etiquette).toUpperCase().trim(),
      etiquetteGes: ges ? String(ges).toUpperCase().trim() : undefined,
    };
  } catch (err) {
    console.error("[dpe] lookupDpe failed:", (err as Error)?.message);
    return { available: false, reason: "exception" };
  }
}

/**
 * Message humain sur l'impact du DPE (angle "anxiété 2026"). Pur, sans I/O.
 */
export function dpeImpactMessage(etiquette?: string): string {
  if (!etiquette) {
    return "DPE inconnu — un diagnostic récent valorisera votre bien et rassurera les acheteurs.";
  }
  const e = etiquette.toUpperCase().trim();
  if (e === "F" || e === "G") {
    return "Bien classé passoire thermique (F/G) : depuis 2025 la location se durcit et la valeur peut être décotée. C'est un critère clé à anticiper en 2026.";
  }
  if (e === "D" || e === "E") {
    return "Classe énergie moyenne (D/E) : des travaux ciblés peuvent améliorer la valeur et l'attractivité du bien.";
  }
  if (e === "A" || e === "B" || e === "C") {
    return "Bonne performance énergétique (A/B/C) : un vrai atout de valeur sur le marché 2026.";
  }
  return "Classe énergétique à vérifier — un conseiller pourra préciser son impact sur la valeur.";
}
