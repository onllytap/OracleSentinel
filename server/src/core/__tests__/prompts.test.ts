import { describe, expect, it } from "vitest";
import { getSystemPrompt } from "../prompts";

describe("domain prompts", () => {
  it("selects the garage prompt when requested explicitly", () => {
    const profile = getSystemPrompt("garage");

    expect(profile.domainId).toBe("garage");
    expect(profile.domainName).toContain("Garage");
    expect(profile.systemPrompt).toContain("MÉCANICIEN AUTOMOBILE");
  });

  it("selects the immobilier prompt when requested explicitly", () => {
    const profile = getSystemPrompt("immobilier");

    expect(profile.domainId).toBe("immobilier");
    expect(profile.domainName).toContain("Immobilier");
    expect(profile.systemPrompt).toContain("CONSEILLER IMMOBILIER");
  });

  it("keeps OracleSentinel on its dedicated profile", () => {
    const profile = getSystemPrompt("oraclesentinel");

    expect(profile.domainId).toBe("oraclesentinel");
    expect(profile.systemPrompt).toContain("OracleSentinel");
  });
});
