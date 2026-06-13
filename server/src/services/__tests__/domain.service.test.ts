import { beforeEach, describe, expect, it, vi } from "vitest";

const getProfileDomain = vi.fn();

vi.mock("../profile-loader.service", () => ({
  getProfileDomain,
}));

describe("domain.service", () => {
  beforeEach(() => {
    getProfileDomain.mockReset();
  });

  it.each([
    ["garage", "garage"],
    ["automobile", "garage"],
    ["auto", "garage"],
    ["immobilier", "immobilier"],
    ["immo", "immobilier"],
    ["oraclesentinel", "oraclesentinel"],
    ["tsindustry", "oraclesentinel"],
    ["oracle", "oraclesentinel"],
    ["generic", "generic"],
    ["unknown", "immobilier"],
    [undefined, "immobilier"],
  ] as const)("normalizes %s to %s", async (input, expected) => {
    const { normalizeDomain } = await import("../domain.service");

    expect(normalizeDomain(input)).toBe(expected);
  });

  it("resolves the runtime domain from the active profile loader", async () => {
    const { getRuntimeDomain } = await import("../domain.service");
    getProfileDomain.mockReturnValue("garage");

    expect(getRuntimeDomain()).toBe("garage");
    expect(getProfileDomain).toHaveBeenCalledTimes(1);
  });

  it("falls back to immobilier for unsupported profile domains", async () => {
    const { getRuntimeDomain } = await import("../domain.service");
    getProfileDomain.mockReturnValue("restaurant");

    expect(getRuntimeDomain()).toBe("immobilier");
  });
});
