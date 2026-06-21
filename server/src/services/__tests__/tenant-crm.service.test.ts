import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdmLead } from "../crm";

// ─────────────────────────────────────────────────────────────────────────
// tenant-crm.service — per-agency CRM (R17 / T1)
//
// These tests run WITHOUT a live database: the pg pool is mocked. The real
// crypto module is used (APP_ENCRYPTION_KEY is set to a 64-hex test key) so we
// can prove that secrets are encrypted at rest and NEVER surface in the public
// shape. `fetch` is stubbed for the webhook connector mapping test.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db/pool", () => ({ pool: { query: h.query } }));

import {
  getTenantCrmConfig,
  saveTenantCrmConfig,
  pushLeadForTenant,
  buildTenantConnector,
} from "../tenant-crm.service";
import { decryptJson } from "../../utils/crypto";

// 64 hex chars = 32 bytes — a valid APP_ENCRYPTION_KEY for tests.
const TEST_KEY = "a".repeat(64);

function makeLead(over: Partial<CdmLead> = {}): CdmLead {
  return {
    person: {
      firstName: "Jean",
      lastName: "Dupont",
      fullName: "Jean Dupont",
      phone: "0612345678",
      email: "jean@dupont.fr",
    },
    projectType: "Achat",
    need: "T3 lumineux",
    location: "Paris",
    qualificationScore: 82,
    summary: "Recherche T3 a Paris",
    notes: "Client motive",
    ...over,
  };
}

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  h.query.mockReset();
  h.query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTenantCrmConfig", () => {
  it("returns a safe default (provider none, no credentials) when no row exists", async () => {
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const cfg = await getTenantCrmConfig("agency-1");

    expect(cfg).toEqual({
      tenantId: "agency-1",
      provider: "none",
      enabled: false,
      hasCredentials: false,
      fieldMappings: {},
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("exposes only a hasCredentials boolean — never the stored secret blob", async () => {
    h.query.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "agency-1",
          provider: "twenty",
          enabled: true,
          config_encrypted: "ENCRYPTED_BLOB_THAT_MUST_NOT_LEAK",
          field_mappings: { firstName: "Prenom", phone: "Telephone" },
          updated_at: new Date("2024-01-02T03:04:05.000Z"),
          updated_by: "admin",
        },
      ],
      rowCount: 1,
    });

    const cfg = await getTenantCrmConfig("agency-1");

    expect(cfg.provider).toBe("twenty");
    expect(cfg.enabled).toBe(true);
    expect(cfg.hasCredentials).toBe(true);
    expect(cfg.fieldMappings).toEqual({ firstName: "Prenom", phone: "Telephone" });
    expect(cfg.updatedAt).toBe("2024-01-02T03:04:05.000Z");
    expect(cfg.updatedBy).toBe("admin");

    // The encrypted blob must NOT appear anywhere in the public object.
    expect(cfg).not.toHaveProperty("config_encrypted");
    expect(cfg).not.toHaveProperty("secrets");
    expect(JSON.stringify(cfg)).not.toContain("ENCRYPTED_BLOB_THAT_MUST_NOT_LEAK");
  });
});

describe("saveTenantCrmConfig", () => {
  it("encrypts secrets at rest and returns a public shape free of any secret", async () => {
    // Simulate INSERT ... ON CONFLICT ... RETURNING by echoing the params back.
    h.query.mockImplementation(async (_sql: string, params: any[]) => ({
      rows: [
        {
          tenant_id: params[0],
          provider: params[1],
          enabled: params[2],
          config_encrypted: params[3],
          field_mappings: JSON.parse(params[4]),
          updated_at: new Date("2024-05-05T00:00:00.000Z"),
          updated_by: params[5],
        },
      ],
      rowCount: 1,
    }));

    const cfg = await saveTenantCrmConfig(
      "agency-1",
      {
        provider: "twenty",
        enabled: true,
        fieldMappings: { firstName: "Prenom" },
        secrets: { apiUrl: "https://crm.example/api", apiKey: "SUPER_SECRET_KEY" },
      },
      "admin",
    );

    // Public shape only.
    expect(cfg.provider).toBe("twenty");
    expect(cfg.enabled).toBe(true);
    expect(cfg.hasCredentials).toBe(true);
    expect(cfg.fieldMappings).toEqual({ firstName: "Prenom" });
    expect(cfg.updatedBy).toBe("admin");

    // The returned object must NOT leak the secret in any form.
    const serialized = JSON.stringify(cfg);
    expect(serialized).not.toContain("SUPER_SECRET_KEY");
    expect(serialized).not.toContain("apiKey");

    // It performs an UPSERT.
    const [sql, params] = h.query.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/INSERT INTO tenant_crm_configs/i);
    expect(sql).toMatch(/ON CONFLICT/i);

    // The credential column is ENCRYPTED (not plaintext) and round-trips back.
    const storedBlob = params[3];
    expect(typeof storedBlob).toBe("string");
    expect(storedBlob).not.toContain("SUPER_SECRET_KEY");
    expect(decryptJson(storedBlob)).toEqual({
      apiUrl: "https://crm.example/api",
      apiKey: "SUPER_SECRET_KEY",
    });
  });

  it("rejects an invalid provider without touching the database", async () => {
    await expect(
      saveTenantCrmConfig(
        "agency-1",
        { provider: "bogus" as any, enabled: true },
        "admin",
      ),
    ).rejects.toThrow("invalid_provider");
    expect(h.query).not.toHaveBeenCalled();
  });

  it("refuses to store secrets when encryption is not configured", async () => {
    process.env.APP_ENCRYPTION_KEY = ""; // disable encryption for this test

    await expect(
      saveTenantCrmConfig(
        "agency-1",
        { provider: "webhook", enabled: true, secrets: { url: "https://hook.example" } },
        "admin",
      ),
    ).rejects.toThrow("encryption_not_configured");
    expect(h.query).not.toHaveBeenCalled();
  });
});

describe("pushLeadForTenant (fallback to global push)", () => {
  it("returns { handled: false } when no provider is configured", async () => {
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const out = await pushLeadForTenant("agency-1", makeLead(), "sess-1");

    expect(out).toEqual({ handled: false });
  });

  it("returns { handled: false } when the tenant CRM is disabled", async () => {
    h.query.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "agency-1",
          provider: "twenty",
          enabled: false,
          config_encrypted: "blob",
          field_mappings: {},
          updated_at: null,
          updated_by: null,
        },
      ],
      rowCount: 1,
    });

    const out = await pushLeadForTenant("agency-1", makeLead(), "sess-1");

    expect(out).toEqual({ handled: false });
  });
});

describe("buildTenantConnector", () => {
  it("returns null for provider 'none'", () => {
    expect(buildTenantConnector("none", {}, {})).toBeNull();
  });

  it("builds a webhook connector that maps canonical fields and sends the auth header", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const connector = buildTenantConnector(
      "webhook",
      { url: "https://hook.example/lead", secret: "s3cr3t", headerName: "X-Webhook-Token" },
      { firstName: "fname", phone: "tel", need: "besoin", qualification: "score" },
    );

    expect(connector).not.toBeNull();
    expect(connector!.providerName).toBe("webhook");

    const result = await connector!.pushLead(makeLead(), "sess-1");
    expect(result).toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://hook.example/lead");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-Webhook-Token"]).toBe("s3cr3t");

    const body = JSON.parse(init.body);
    // Mapped keys take the configured field names.
    expect(body.fname).toBe("Jean");
    expect(body.tel).toBe("0612345678");
    expect(body.besoin).toBe("T3 lumineux");
    expect(body.score).toBe(82);
    // Unmapped keys fall back to canonical names.
    expect(body.lastName).toBe("Dupont");
    expect(body.notes).toBe("Client motive");
  });

  it("reports granular ops as unsupported for the webhook connector", async () => {
    const connector = buildTenantConnector(
      "webhook",
      { url: "https://hook.example/lead" },
      {},
    );

    const r = await connector!.upsertPerson({
      firstName: "A",
      lastName: "B",
      fullName: "A B",
      phone: "0600000000",
    });

    expect(r).toEqual({ success: false, error: "unsupported" });
  });
});
