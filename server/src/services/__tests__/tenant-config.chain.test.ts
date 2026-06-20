import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB pool so we can exercise the full read → sanitize → prompt-block
// chain that ChatService relies on, without a live database.
const queryMock = vi.fn();
vi.mock("../../db/pool", () => ({
  pool: { query: (...args: any[]) => queryMock(...args) },
  isDatabaseConfigured: true,
}));

import {
  getEffectiveIdentityPromptBlock,
  resetTenantConfigCache,
} from "../tenant-config.service";

describe("tenant-config.service · getEffectiveIdentityPromptBlock (DB chain)", () => {
  beforeEach(() => {
    queryMock.mockReset();
    resetTenantConfigCache();
  });

  it("builds the prompt block from a stored override", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          overrides: {
            branding: { agentName: "Léa", agencyName: "Buchy" },
            personality: { maxResponseWords: 60 },
          },
        },
      ],
    });
    const block = await getEffectiveIdentityPromptBlock("buchy");
    expect(block).toContain("Léa");
    expect(block).toContain("Buchy");
    expect(block).toContain("60 mots");
  });

  it("returns empty string when the tenant has no override row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const block = await getEffectiveIdentityPromptBlock("none");
    expect(block).toBe("");
  });

  it("returns empty string and never throws on a DB error", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const block = await getEffectiveIdentityPromptBlock("err");
    expect(block).toBe("");
  });
});
