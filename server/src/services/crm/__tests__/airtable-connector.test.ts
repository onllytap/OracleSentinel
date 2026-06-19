import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdmLead, CrmProviderConfig } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// AirtableConnector — webhook payload shape (finding F6, target d)
//
// The Airtable webhook payload is a PROTECTED production flow. These tests
// MOCK fetch + the PostgreSQL pool and assert the EXACT payload shape and the
// dedup/config gating, WITHOUT changing the payload.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  query: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../../db/pool", () => ({ pool: { query: h.query } }));

import { AirtableConnector } from "../airtable-connector";

const WEBHOOK_URL = "https://hooks.example.com/airtable";

function makeConfig(over: Partial<CrmProviderConfig> = {}): CrmProviderConfig {
  return {
    provider: "airtable",
    enabled: true,
    baseUrl: WEBHOOK_URL,
    apiKey: "",
    timeoutMs: 10000,
    ...over,
  };
}

function okResponse(body = "") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : {}),
  };
}

function makeLead(over: Partial<CdmLead> = {}): CdmLead {
  return {
    person: {
      externalId: "phone-612345678",
      firstName: "Jean",
      lastName: "Dupont",
      fullName: "Jean Dupont",
      phone: "0612345678",
      email: "jean@dupont.fr",
      address: "Paris",
      qualificationScore: 80,
      qualificationLevel: "HOT",
      source: "CHATBOT",
      notes: "Client motivé",
    },
    projectType: "Achat immobilier",
    need: "T3 lumineux",
    location: "Paris",
    appointmentDate: "2026-07-01",
    tags: ["Estimation"],
    qualificationScore: 80,
    summary: "Recherche T3 a Paris",
    notes: "Client motivé",
    agentNote: "Bon contact, sérieux",
    domain: "immobilier",
    domainName: "Immobilier",
    missingFields: [],
    sessionId: "sess-1",
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers(); // neutralize the constructor's setInterval retry loop
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", h.fetch);

  // Default DB behaviour: table init OK, not a duplicate, record OK.
  h.query.mockImplementation(async (sql: string) => {
    if (/SELECT COUNT/i.test(sql)) return { rows: [{ count: "0" }] };
    return { rows: [] };
  });
  h.fetch.mockResolvedValue(okResponse());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirtableConnector.pushLead — payload shape", () => {
  it("POSTs the exact webhook payload with default French field names", async () => {
    const connector = new AirtableConnector(makeConfig());

    const result = await connector.pushLead(makeLead(), "sess-1");

    expect(result).toEqual({ success: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = h.fetch.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });

    expect(JSON.parse(init.body)).toEqual({
      prenom: "Jean",
      nom: "Dupont",
      nom_complet: "Jean Dupont",
      numero_telephone: "(+33) 612-345-678", // normalized French format
      type: "Achat immobilier",
      besoin: "T3 lumineux",
      adresse: "Paris",
      qualification: 80,
      details: "Recherche T3 a Paris", // ← summary, not notes
      notes: "Client motivé",
      externalId: "phone-612345678",
      source: "CHATBOT",
      qualificationLevel: "HOT",
      // optional fields, only present when supplied
      date_rdv: "2026-07-01",
      tags: "Estimation",
      email: "jean@dupont.fr",
      impression_agent: "Bon contact, sérieux",
    });
  });

  it("omits optional fields and falls back to defaults when data is sparse", async () => {
    const connector = new AirtableConnector(makeConfig());

    const lead = makeLead({
      person: {
        firstName: "Marie",
        lastName: "Martin",
        fullName: "Marie Martin",
        phone: "0698765432",
      },
      appointmentDate: undefined,
      tags: undefined,
      notes: "",
      agentNote: undefined,
    });

    await connector.pushLead(lead, "sess-2");

    const payload = JSON.parse(h.fetch.mock.calls[0][1].body);
    // optional fields absent
    expect(payload).not.toHaveProperty("date_rdv");
    expect(payload).not.toHaveProperty("tags");
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("impression_agent");
    // safe defaults preserved
    expect(payload.source).toBe("CHATBOT");
    expect(payload.qualificationLevel).toBe("COLD");
    expect(payload.notes).toBe("Premier contact — à qualifier.");
  });
});

describe("AirtableConnector.pushLead — gating", () => {
  it("does not call the webhook when the connector is not configured", async () => {
    const connector = new AirtableConnector(makeConfig({ enabled: false }));

    const result = await connector.pushLead(makeLead(), "sess-3");

    expect(result).toEqual({ success: false, error: "Airtable not configured" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("blocks a duplicate phone number before any webhook call", async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (/SELECT COUNT/i.test(sql)) return { rows: [{ count: "1" }] };
      return { rows: [] };
    });
    const connector = new AirtableConnector(makeConfig());

    const result = await connector.pushLead(makeLead(), "sess-4");

    expect(result).toEqual({
      success: false,
      error: "DUPLICATE_PHONE",
      duplicate: true,
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("treats a session already pushed as an idempotent duplicate", async () => {
    const connector = new AirtableConnector(makeConfig());

    await connector.pushLead(makeLead(), "sess-5");
    const second = await connector.pushLead(makeLead(), "sess-5");

    expect(second).toEqual({ success: true, duplicate: true });
    expect(h.fetch).toHaveBeenCalledTimes(1); // only the first call hit the webhook
  });
});
