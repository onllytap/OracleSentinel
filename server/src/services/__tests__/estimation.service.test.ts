import { describe, it, expect, beforeEach, vi } from "vitest";

// Pool mocké (fail-safe + estimateProperty)
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../db/pool", () => ({ pool: { query: queryMock } }));

import {
  median,
  quantile,
  computeEstimate,
  estimateProperty,
  type DvfComparable,
} from "../estimation.service";

const comps = (...pairs: [number, number][]): DvfComparable[] =>
  pairs.map(([valeurFonciere, surface]) => ({ valeurFonciere, surface }));

describe("estimation — stats pures", () => {
  it("median (impair/pair)", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("quantile (interpolation linéaire)", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 5);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("estimation — computeEstimate", () => {
  it("fourchette cohérente avec données suffisantes", () => {
    const r = computeEstimate(
      comps([200000, 100], [220000, 100], [240000, 100], [260000, 100], [280000, 100]),
      100,
    );
    expect(r.available).toBe(true);
    expect(r.pricePerM2Median).toBe(2400);
    expect(r.midPrice).toBe(240000);
    expect(r.lowPrice).toBe(220000);
    expect(r.highPrice).toBe(260000);
    expect(r.lowPrice!).toBeLessThanOrEqual(r.midPrice!);
    expect(r.midPrice!).toBeLessThanOrEqual(r.highPrice!);
    expect(r.sampleSize).toBe(5);
  });

  it("rejette une surface invalide", () => {
    const r = computeEstimate(comps([200000, 100], [220000, 100], [240000, 100]), 5);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("surface_invalide");
  });

  it("indisponible si moins de 3 comparables exploitables", () => {
    const r = computeEstimate(comps([200000, 100], [220000, 100]), 100);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("donnees_insuffisantes");
  });

  it("filtre les aberrations (garages / erreurs de saisie)", () => {
    const r = computeEstimate(
      comps(
        [200000, 100], // 2000/m²
        [220000, 100], // 2200/m²
        [240000, 100], // 2400/m²
        [6, 5], // surface <= 8 -> filtré
        [5000000, 50], // 100000/m² -> filtré
      ),
      100,
    );
    expect(r.available).toBe(true);
    expect(r.sampleSize).toBe(3);
    expect(r.pricePerM2Median).toBe(2200);
  });

  it("expose toujours un disclaimer", () => {
    const r = computeEstimate([], 100);
    expect(r.disclaimer).toContain("indicative");
  });
});

describe("estimation — estimateProperty (DB mockée)", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("estime via la commune quand assez de ventes", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { valeurFonciere: 200000, surface: 100 },
        { valeurFonciere: 220000, surface: 100 },
        { valeurFonciere: 240000, surface: 100 },
      ],
    });
    const r = await estimateProperty({ codeCommune: "28085", typeLocal: "Maison", surface: 100 });
    expect(r.available).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("retombe sur le code postal si la commune manque de ventes", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ valeurFonciere: 200000, surface: 100 }] }) // commune: 1 seule
      .mockResolvedValueOnce({
        rows: [
          { valeurFonciere: 200000, surface: 100 },
          { valeurFonciere: 220000, surface: 100 },
          { valeurFonciere: 240000, surface: 100 },
        ],
      });
    const r = await estimateProperty({
      codeCommune: "28085",
      codePostal: "28000",
      typeLocal: "Appartement",
      surface: 100,
    });
    expect(r.available).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("fail-safe : erreur DB -> indisponible, jamais de throw", async () => {
    queryMock.mockRejectedValue(new Error("db down"));
    const r = await estimateProperty({ codeCommune: "28085", typeLocal: "Maison", surface: 100 });
    expect(r.available).toBe(false);
  });
});
