import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// tenant.service — agency provisioning (R19, T3)
//
// The PostgreSQL pool is fully mocked — no real database is ever touched
// (mirrors catalog-import.service.test.ts). These tests lock in the pure
// helpers (generateWidgetId / buildEmbedSnippet) and, critically, the
// FAIL-OPEN contract of isTenantServable (no row OR DB error => servable).
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../../db/pool", () => ({
  pool: { query: h.query },
}));

import {
  generateWidgetId,
  buildEmbedSnippet,
  isTenantServable,
  resetTenantCache,
} from "../tenant.service";

beforeEach(() => {
  h.query.mockReset();
  resetTenantCache();
});

// ===========================================================================
// generateWidgetId — url-safe + unique
// ===========================================================================

describe("tenant.service · generateWidgetId", () => {
  it("matches a url-safe, prefixed pattern", () => {
    const id = generateWidgetId();
    expect(id).toMatch(/^wgt_[a-f0-9]{32}$/);
    // url-safe: contains nothing that percent-encoding would alter.
    expect(encodeURIComponent(id)).toBe(id);
  });

  it("returns distinct values across many calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateWidgetId()));
    expect(ids.size).toBe(200);
  });
});

// ===========================================================================
// buildEmbedSnippet — copyable snippet pointing at /embed
// ===========================================================================

describe("tenant.service · buildEmbedSnippet", () => {
  it("contains the widget id and the /embed URL", () => {
    const snippet = buildEmbedSnippet("wgt_abc123", "https://api.example.com");
    expect(snippet).toContain("wgt_abc123");
    expect(snippet).toContain("/embed?widget_id=wgt_abc123");
    expect(snippet).toContain("https://api.example.com/embed");
  });

  it("normalizes a trailing slash on the base url", () => {
    const snippet = buildEmbedSnippet("wgt_x", "https://api.example.com/");
    expect(snippet).toContain(
      "https://api.example.com/embed?widget_id=wgt_x",
    );
    expect(snippet).not.toContain("com//embed");
  });
});

// ===========================================================================
// isTenantServable — FAIL-OPEN contract
// ===========================================================================

describe("tenant.service · isTenantServable (FAIL-OPEN)", () => {
  it("returns true when the tenant has no row", async () => {
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(isTenantServable("ghost-tenant")).resolves.toBe(true);
  });

  it("fails open (true) when the DB query rejects", async () => {
    h.query.mockRejectedValueOnce(new Error("connection refused"));
    await expect(isTenantServable("error-tenant")).resolves.toBe(true);
  });

  it("returns false when the status is 'suspended'", async () => {
    h.query.mockResolvedValueOnce({
      rows: [{ status: "suspended" }],
      rowCount: 1,
    });
    await expect(isTenantServable("suspended-tenant")).resolves.toBe(false);
  });

  it("returns false when the status is 'archived'", async () => {
    h.query.mockResolvedValueOnce({
      rows: [{ status: "archived" }],
      rowCount: 1,
    });
    await expect(isTenantServable("archived-tenant")).resolves.toBe(false);
  });

  it("returns true when the status is 'active'", async () => {
    h.query.mockResolvedValueOnce({
      rows: [{ status: "active" }],
      rowCount: 1,
    });
    await expect(isTenantServable("active-tenant")).resolves.toBe(true);
  });
});
