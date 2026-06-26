import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { geocodeAddress, lookupDpe, dpeImpactMessage } from "../dpe.service";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dpe — geocodeAddress (BAN)", () => {
  it("normalise une adresse valide", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [1.4889, 48.4439] },
            properties: { citycode: "28085", postcode: "28000", label: "Chartres", score: 0.97 },
          },
        ],
      }),
    });
    const r = await geocodeAddress("rue de la paix chartres");
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(48.4439, 4);
    expect(r!.lon).toBeCloseTo(1.4889, 4);
    expect(r!.codeCommune).toBe("28085");
    expect(r!.codePostal).toBe("28000");
  });

  it("renvoie null sur réponse HTTP non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await geocodeAddress("une adresse")).toBeNull();
  });

  it("fail-safe : erreur réseau -> null (jamais de throw)", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await geocodeAddress("une adresse")).toBeNull();
  });

  it("n'appelle pas l'API pour une adresse trop courte", async () => {
    expect(await geocodeAddress("ab")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dpe — lookupDpe (ADEME)", () => {
  it("retourne l'étiquette du DPE trouvé", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ etiquette_dpe: "d", etiquette_ges: "e" }] }),
    });
    const r = await lookupDpe({ address: "10 rue x, 28000 Chartres" });
    expect(r.available).toBe(true);
    expect(r.etiquetteDpe).toBe("D");
    expect(r.etiquetteGes).toBe("E");
  });

  it("indisponible si aucun résultat", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const r = await lookupDpe({ address: "adresse inconnue" });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("non_trouve");
  });

  it("indisponible sur HTTP non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await lookupDpe({ address: "adresse" });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("http_500");
  });

  it("refuse l'appel sans adresse ni code postal", async () => {
    const r = await lookupDpe({});
    expect(r.available).toBe(false);
    expect(r.reason).toBe("adresse_manquante");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dpe — dpeImpactMessage (pur)", () => {
  it("alerte passoire pour F/G", () => {
    expect(dpeImpactMessage("F").toLowerCase()).toContain("passoire");
    expect(dpeImpactMessage("G").toLowerCase()).toContain("passoire");
  });
  it("atout pour A/B/C", () => {
    expect(dpeImpactMessage("B").toLowerCase()).toContain("atout");
  });
  it("message moyen pour D/E", () => {
    expect(dpeImpactMessage("E").toLowerCase()).toContain("moyenne");
  });
  it("message neutre si DPE inconnu", () => {
    expect(dpeImpactMessage(undefined).toLowerCase()).toContain("inconnu");
  });
});
