import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// CatalogImportService — XML catalog import (finding F6, target b)
//
// Locks the parsing/validation, the dry-run vs commit gating, and the
// "retire missing" safeguard WITHOUT changing behaviour. The PostgreSQL pool
// is fully mocked — no real database is ever touched.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../../db/pool", () => ({
  pool: { query: h.query },
}));

// catalog.service is only used for its TYPES here; mock defensively so the
// real module (and its dependencies) is never executed during the test run.
vi.mock("../catalog.service", () => ({}));

import { CatalogImportService } from "../catalog-import.service";

const SQL = {
  insertRun: /INSERT INTO catalog_import_runs/i,
  insertError: /INSERT INTO catalog_import_errors/i,
  upsert: /INSERT INTO catalog_properties/i,
  retire: /UPDATE catalog_properties[\s\S]*statut = 'retire'/i,
  finalize: /UPDATE catalog_import_runs/i,
};

function callsMatching(re: RegExp): unknown[][] {
  return h.query.mock.calls.filter((c) => re.test(String(c[0])));
}

beforeEach(() => {
  h.query.mockImplementation(async (sql: string) => {
    if (SQL.insertRun.test(sql)) return { rows: [{ id: "run-1" }] };
    if (SQL.retire.test(sql)) return { rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
});

// ===========================================================================
// parseXmlListings — tolerant XML shape detection
// ===========================================================================

describe("CatalogImportService.parseXmlListings", () => {
  it("reads multiple <catalog><listing> nodes", () => {
    const xml = `<catalog>
      <listing><id>A1</id></listing>
      <listing><id>A2</id></listing>
    </catalog>`;
    expect(CatalogImportService.parseXmlListings(xml)).toHaveLength(2);
  });

  it("wraps a single listing into an array", () => {
    const xml = `<catalog><listing><id>A1</id></listing></catalog>`;
    const out = CatalogImportService.parseXmlListings(xml);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("A1");
  });

  it("supports the <listings><listing> wrapper", () => {
    const xml = `<listings><listing><id>A1</id></listing></listings>`;
    expect(CatalogImportService.parseXmlListings(xml)).toHaveLength(1);
  });

  it("recursively finds listing nodes nested under unknown wrappers", () => {
    const xml = `<root><data><items><listing><id>A1</id></listing></items></data></root>`;
    const out = CatalogImportService.parseXmlListings(xml);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("A1");
  });

  it("returns an empty array when there are no listings", () => {
    expect(CatalogImportService.parseXmlListings(`<root></root>`)).toEqual([]);
  });
});

// ===========================================================================
// mapListingToProperty — structured_data format
// ===========================================================================

describe("CatalogImportService.mapListingToProperty (structured_data)", () => {
  const listing = {
    id: "PROP-1",
    structured_data: {
      listing_meta: {
        type: "appartement",
        transaction: "vente",
        statut: "disponible",
        url_annonce: "http://example.com/p1",
        date_maj: "2026-01-01",
      },
      financial: { price: "250000", charges: "50", tax_year: "2024" },
      physical: {
        area: "75",
        rooms: "3",
        bedrooms: "2",
        floor: "2",
        elevator: "true",
      },
      location: {
        city: "Paris",
        postcode: "75001",
        country: "FR",
        coordinates: { lat: "48.8", lon: "2.3" },
      },
      flags: { has_balcony: "true", has_garage: "false", is_furnished: "true" },
    },
    semantic_content: {
      title: "Bel appartement",
      description: "Lumineux",
      tags: "lumineux, balcon",
    },
  };

  it("maps every field, parses numbers/booleans/tags and reports no errors", () => {
    const { property, errors } = CatalogImportService.mapListingToProperty(
      listing,
      "tenant-x",
    );

    expect(errors).toEqual([]);
    expect(property).toMatchObject({
      tenant_id: "tenant-x",
      id_unique: "PROP-1",
      type: "appartement",
      transaction: "vente",
      statut: "disponible",
      prix: 250000,
      charges: 50,
      tax_year: 2024,
      surface_m2: 75,
      pieces: 3,
      chambres: 2,
      floor: 2,
      elevator: true,
      ville: "Paris",
      code_postal: "75001",
      country: "FR",
      lat: 48.8,
      lon: 2.3,
      title: "Bel appartement",
      description: "Lumineux",
      tags: ["lumineux", "balcon"],
      flags: { has_balcony: true, has_garage: false, is_furnished: true },
    });
  });

  it("flags an invalid type but still returns the property with type=null", () => {
    const bad = {
      ...listing,
      structured_data: {
        ...listing.structured_data,
        listing_meta: { ...listing.structured_data.listing_meta, type: "chateau" },
      },
    };
    const { property, errors } = CatalogImportService.mapListingToProperty(
      bad,
      "tenant-x",
    );
    expect(errors).toContain("Invalid type");
    expect(property?.type).toBeNull();
  });

  it("flags an invalid transaction value", () => {
    const bad = {
      ...listing,
      structured_data: {
        ...listing.structured_data,
        listing_meta: {
          ...listing.structured_data.listing_meta,
          transaction: "echange",
        },
      },
    };
    const { property, errors } = CatalogImportService.mapListingToProperty(
      bad,
      "tenant-x",
    );
    expect(errors).toContain("Invalid transaction");
    expect(property?.transaction).toBeNull();
  });

  it("rejects a listing without an id", () => {
    const { property, errors } = CatalogImportService.mapListingToProperty(
      { structured_data: {} },
      "tenant-x",
    );
    expect(property).toBeNull();
    expect(errors).toContain("Missing id");
  });
});

// ===========================================================================
// mapListingToProperty — "indexation" (bien) format
// ===========================================================================

describe("CatalogImportService.mapListingToProperty (bien format)", () => {
  const listing = {
    bien: {
      reference: "REF-9",
      type_bien: "villa", // normalized to "maison"
      transaction: "vente",
      prix: "500000",
      surface_m2: "120",
      pieces: "5",
      chambres: "4",
      etage: "0",
      ascenseur: "false",
      ville: "Nice",
      code_postal: "06000",
      titre: "Villa vue mer",
      description: "Superbe villa",
      balcon: "true",
      garage: "true",
      meuble: "false",
    },
  };

  it("normalizes 'villa' to 'maison' and maps the indexation fields", () => {
    const { property, errors } = CatalogImportService.mapListingToProperty(
      listing,
      "tenant-y",
    );

    expect(errors).toEqual([]);
    expect(property).toMatchObject({
      id_unique: "REF-9",
      type: "maison",
      transaction: "vente",
      statut: "disponible",
      prix: 500000,
      surface_m2: 120,
      pieces: 5,
      chambres: 4,
      floor: 0,
      elevator: false,
      ville: "Nice",
      code_postal: "06000",
      title: "Villa vue mer",
      flags: { has_balcony: true, has_garage: true, is_furnished: false },
    });
  });

  it("rejects a bien without a reference", () => {
    const { property, errors } = CatalogImportService.mapListingToProperty(
      { bien: { type_bien: "maison" } },
      "tenant-y",
    );
    expect(property).toBeNull();
    expect(errors).toContain("Missing reference");
  });
});

// ===========================================================================
// markMissingAsRetired — the destructive "retire-all" safeguard
// ===========================================================================

describe("CatalogImportService.markMissingAsRetired", () => {
  it("skips the UPDATE and returns 0 when no ids were seen (safeguard)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const retired = await CatalogImportService.markMissingAsRetired({
      tenantId: "t1",
      importRunId: "run-1",
      seenIds: new Set<string>(),
    });

    expect(retired).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(callsMatching(SQL.retire)).toHaveLength(0);
  });

  it("retires properties not present in the seen set, scoped to the tenant", async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (SQL.retire.test(sql)) return { rowCount: 7 };
      return { rows: [], rowCount: 0 };
    });

    const retired = await CatalogImportService.markMissingAsRetired({
      tenantId: "t1",
      importRunId: "run-1",
      seenIds: new Set(["a", "b"]),
    });

    expect(retired).toBe(7);
    const calls = callsMatching(SQL.retire);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(["t1", ["a", "b"], "run-1"]);
  });
});

// ===========================================================================
// runImport — dry-run vs commit orchestration
// ===========================================================================

describe("CatalogImportService.runImport", () => {
  const xml = `<catalog>
    <listing><id>P1</id></listing>
    <listing><id>P2</id></listing>
  </catalog>`;

  it("dry-run parses listings but never upserts or retires", async () => {
    const result = await CatalogImportService.runImport({
      tenantId: "t1",
      xmlText: xml,
      mode: "dry_run",
    });

    expect(result.seenCount).toBe(2);
    expect(callsMatching(SQL.upsert)).toHaveLength(0);
    expect(callsMatching(SQL.retire)).toHaveLength(0);
  });

  it("commit upserts every seen listing and runs the retire safeguard", async () => {
    const result = await CatalogImportService.runImport({
      tenantId: "t1",
      xmlText: xml,
      mode: "commit",
    });

    expect(result.seenCount).toBe(2);
    expect(callsMatching(SQL.upsert)).toHaveLength(2);
    expect(callsMatching(SQL.retire)).toHaveLength(1);
  });

  it("records an error and reports it when the XML has no listings", async () => {
    const result = await CatalogImportService.runImport({
      tenantId: "t1",
      xmlText: `<catalog></catalog>`,
      mode: "commit",
    });

    expect(result.seenCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].reason).toContain("No listings found");
    expect(callsMatching(SQL.insertError)).toHaveLength(1);
  });
});
