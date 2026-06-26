import { describe, it, expect, beforeEach, vi } from "vitest";

const { estimatePropertyMock, geocodeMock, lookupDpeMock, saveLeadMock, getTenantByWidgetIdMock, getTenantMock } = vi.hoisted(() => ({
  estimatePropertyMock: vi.fn(),
  geocodeMock: vi.fn(),
  lookupDpeMock: vi.fn(),
  saveLeadMock: vi.fn(),
  getTenantByWidgetIdMock: vi.fn(),
  getTenantMock: vi.fn(),
}));

vi.mock("../../services/estimation.service", () => ({
  estimateProperty: estimatePropertyMock,
}));
vi.mock("../../services/dpe.service", () => ({
  geocodeAddress: geocodeMock,
  lookupDpe: lookupDpeMock,
  dpeImpactMessage: (e?: string) => (e ? `msg-${e}` : "msg-inconnu"),
}));
vi.mock("../../services/estimation-capture.service", () => ({
  saveEstimationLead: saveLeadMock,
}));
vi.mock("../../services/tenant.service", () => ({
  getTenantByWidgetId: getTenantByWidgetIdMock,
  getTenant: getTenantMock,
}));

import { runEstimation } from "../estimation.routes";

const okEstimate = {
  available: true,
  surface: 85,
  pricePerM2Median: 2400,
  lowPrice: 200000,
  midPrice: 240000,
  highPrice: 260000,
  sampleSize: 12,
  confidence: "medium" as const,
  disclaimer: "Fourchette indicative ...",
};

beforeEach(() => {
  estimatePropertyMock.mockReset().mockResolvedValue(okEstimate);
  geocodeMock.mockReset().mockResolvedValue({
    lat: 48.44,
    lon: 1.48,
    codeCommune: "28085",
    codePostal: "28000",
    label: "12 rue de la Paix, Chartres",
    score: 0.95,
  });
  lookupDpeMock.mockReset().mockResolvedValue({ available: true, etiquetteDpe: "D" });
  saveLeadMock.mockReset().mockResolvedValue(1);
  getTenantByWidgetIdMock.mockReset().mockResolvedValue(null);
  getTenantMock.mockReset().mockResolvedValue(null);
});

describe("runEstimation", () => {
  it("estime un bien valide et capture le lead", async () => {
    const r = await runEstimation({
      typeLocal: "maison",
      surface: 85,
      address: "12 rue de la Paix, Chartres",
      telephone: "0612345678",
      prenom: "Jean",
      nom: "Dupont",
    });
    expect(r.ok).toBe(true);
    expect(r.estimate?.midPrice).toBe(240000);
    expect(r.dpe?.etiquette).toBe("D");
    expect(r.dpe?.message).toBe("msg-D");
    expect(saveLeadMock).toHaveBeenCalledTimes(1);
    const saved = saveLeadMock.mock.calls[0][0];
    expect(saved.typeLocal).toBe("Maison");
    expect(saved.estimateMid).toBe(240000);
    expect(saved.dpe).toBe("D");
  });

  it("rejette un type invalide (avant tout appel service)", async () => {
    const r = await runEstimation({ typeLocal: "chateau", surface: 85, telephone: "06", address: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("type_invalide");
    expect(estimatePropertyMock).not.toHaveBeenCalled();
    expect(saveLeadMock).not.toHaveBeenCalled();
  });

  it("rejette une surface invalide", async () => {
    const r = await runEstimation({ typeLocal: "Maison", surface: 5, telephone: "06", address: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("surface_invalide");
  });

  it("rejette un lead sans contact (ni tel ni email)", async () => {
    const r = await runEstimation({ typeLocal: "Maison", surface: 85, address: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("contact_manquant");
  });

  it("retombe sur le code postal si le géocodage échoue", async () => {
    geocodeMock.mockResolvedValue(null);
    const r = await runEstimation({
      typeLocal: "Appartement",
      surface: 60,
      codePostal: "28000",
      email: "vendeur@email.fr",
    });
    expect(r.ok).toBe(true);
    expect(estimatePropertyMock).toHaveBeenCalledTimes(1);
    const arg = estimatePropertyMock.mock.calls[0][0];
    expect(arg.codePostal).toBe("28000");
    expect(arg.typeLocal).toBe("Appartement");
  });

  it("attribue le mandat à l'agence via widgetId", async () => {
    getTenantByWidgetIdMock.mockResolvedValue({
      tenantId: "agence-chartres",
      name: "Agence Chartres",
      widgetId: "wgt_x",
      status: "active",
      plan: "starter",
      createdAt: "",
      updatedAt: "",
    });
    const r = await runEstimation({
      typeLocal: "Maison",
      surface: 85,
      address: "x chartres",
      telephone: "0612345678",
      widgetId: "wgt_x",
    });
    expect(r.ok).toBe(true);
    expect(getTenantByWidgetIdMock).toHaveBeenCalledWith("wgt_x");
    expect(saveLeadMock.mock.calls[0][0].tenantId).toBe("agence-chartres");
  });

  it("retombe sur 'default' si le widgetId est inconnu", async () => {
    getTenantByWidgetIdMock.mockResolvedValue(null);
    const r = await runEstimation({
      typeLocal: "Maison",
      surface: 85,
      address: "x",
      telephone: "0612345678",
      widgetId: "wgt_inconnu",
    });
    expect(r.ok).toBe(true);
    expect(saveLeadMock.mock.calls[0][0].tenantId).toBe("default");
  });
});
