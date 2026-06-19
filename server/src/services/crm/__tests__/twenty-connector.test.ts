import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdmPerson, CrmProviderConfig } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// TwentyConnector.upsertPerson — Twenty People payload shape (F6, target d)
//
// Twenty is a PROTECTED production CRM flow. These tests MOCK fetch (all
// search GETs return empty so the connector takes the CREATE path) and assert
// the EXACT REST payload shape for both custom-fields-enabled and base-only
// modes — WITHOUT changing the payload.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  query: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../../db/pool", () => ({ pool: { query: h.query } }));

import { TwentyConnector } from "../twenty-connector";

function makeConfig(): CrmProviderConfig {
  return {
    provider: "twenty",
    enabled: true,
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    timeoutMs: 10000,
    options: {},
  };
}

function makePerson(over: Partial<CdmPerson> = {}): CdmPerson {
  return {
    externalId: "phone-612345678",
    firstName: "Jean",
    lastName: "Dupont",
    fullName: "Jean Dupont",
    phone: "0612345678",
    email: "jean@dupont.fr",
    qualificationScore: 80,
    qualificationLevel: "HOT",
    source: "CHATBOT",
    notes: "Client motivé",
    ...over,
  };
}

// Twenty REST helper: GET searches return an empty people list (→ no existing
// record → CREATE path); POST /people returns a created record with an id.
function routeFetch(method: string | undefined, url: string) {
  const body =
    method === "POST"
      ? JSON.stringify({ data: { createPerson: { id: "person-1" } } })
      : JSON.stringify({ data: { people: [] } });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function postBody() {
  const call = h.fetch.mock.calls.find((c) => c[1]?.method === "POST");
  return JSON.parse(call![1].body);
}

beforeEach(() => {
  vi.useFakeTimers(); // neutralize the constructor's setInterval retry loop
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", h.fetch);

  h.fetch.mockImplementation(async (url: string, init: RequestInit) =>
    routeFetch(init?.method, url),
  );

  delete process.env.TWENTY_CUSTOM_FIELDS;
  delete process.env.TWENTY_DEFAULT_PHONE_COUNTRY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TwentyConnector.upsertPerson — payload shape", () => {
  it("creates a person with custom fields when TWENTY_CUSTOM_FIELDS=true", async () => {
    process.env.TWENTY_CUSTOM_FIELDS = "true";
    const connector = new TwentyConnector(makeConfig());

    const result = await connector.upsertPerson(makePerson());

    expect(result).toEqual({ success: true, recordId: "person-1" });

    expect(postBody()).toEqual({
      name: { firstName: "Jean", lastName: "Dupont" },
      phones: { primaryPhoneNumber: "0612345678", primaryPhoneCountryCode: "FR" },
      externalid: "phone-612345678",
      source: "CHATBOT",
      qualificationscore: 0.8, // normalized 0-100 → 0-1
      qualificationlevel: "HOT",
      notesExpertise: "Client motivé",
      emails: { primaryEmail: "jean@dupont.fr" },
    });
  });

  it("creates a person with base fields only when custom fields are disabled", async () => {
    // TWENTY_CUSTOM_FIELDS unset → custom fields must NOT be written
    const connector = new TwentyConnector(makeConfig());

    const result = await connector.upsertPerson(makePerson());

    expect(result).toEqual({ success: true, recordId: "person-1" });

    const payload = postBody();
    expect(payload).toEqual({
      name: { firstName: "Jean", lastName: "Dupont" },
      phones: { primaryPhoneNumber: "0612345678", primaryPhoneCountryCode: "FR" },
      emails: { primaryEmail: "jean@dupont.fr" },
    });
    expect(payload).not.toHaveProperty("externalid");
    expect(payload).not.toHaveProperty("qualificationscore");
  });

  it("strips non-digits from the phone number in the payload", async () => {
    const connector = new TwentyConnector(makeConfig());

    await connector.upsertPerson(
      makePerson({ phone: "+33 6 12 34 56 78", email: undefined }),
    );

    const payload = postBody();
    expect(payload.phones.primaryPhoneNumber).toBe("33612345678");
    expect(payload).not.toHaveProperty("emails"); // no email supplied
  });
});
