import { describe, it, expect } from "vitest";
import {
  sanitizeOverride,
  buildIdentityPromptBlock,
  isEmptyOverride,
} from "../tenant-config.service";

// Pure functions — no DB. These lock in the SECURITY whitelist (no secrets ever
// persisted) and the prompt-block fallback (empty → runtime prompt unchanged).
describe("tenant-config.service · sanitizeOverride", () => {
  it("keeps only whitelisted branding + personality fields", () => {
    const out = sanitizeOverride({
      branding: { agentName: "Léa", agencyName: "Buchy Immo", logoUrl: "x" },
      personality: {
        writingStyle: "friendly",
        toneOfVoice: "warm",
        maxResponseWords: 50,
        language: "fr",
        systemPromptModifiers: ["a", "b"],
      },
    });
    expect(out.branding).toEqual({ agentName: "Léa", agencyName: "Buchy Immo" });
    expect((out.branding as any).logoUrl).toBeUndefined();
    expect(out.personality?.writingStyle).toBe("friendly");
    expect(out.personality?.maxResponseWords).toBe(50);
    expect(out.personality?.systemPromptModifiers).toEqual(["a", "b"]);
  });

  it("drops secret-looking / unknown fields entirely", () => {
    const out: any = sanitizeOverride({
      apiKey: "sk-secret",
      GROQ_API_KEY: "x",
      server: { databaseUrl: "postgres://u:p@h/db" },
      branding: { agentName: "X", evil: 1 },
      personality: { writingStyle: "INVALID", maxResponseWords: 99999 },
    });
    expect(out.apiKey).toBeUndefined();
    expect(out.server).toBeUndefined();
    expect(out.GROQ_API_KEY).toBeUndefined();
    expect(out.branding).toEqual({ agentName: "X" });
    expect(out.personality?.writingStyle).toBeUndefined(); // invalid enum dropped
    expect(out.personality?.maxResponseWords).toBe(300); // clamped to max
  });

  it("clamps maxResponseWords and caps the number of modifiers", () => {
    expect(
      sanitizeOverride({ personality: { maxResponseWords: 1 } }).personality
        ?.maxResponseWords,
    ).toBe(10); // clamped to min
    const many = Array.from({ length: 50 }, (_, i) => `m${i}`);
    expect(
      sanitizeOverride({ personality: { systemPromptModifiers: many } })
        .personality?.systemPromptModifiers?.length,
    ).toBe(20);
  });

  it("returns an empty override for junk input", () => {
    expect(sanitizeOverride(null)).toEqual({});
    expect(sanitizeOverride("nope" as any)).toEqual({});
    expect(isEmptyOverride(sanitizeOverride({}))).toBe(true);
    expect(isEmptyOverride(null)).toBe(true);
  });
});

describe("tenant-config.service · buildIdentityPromptBlock", () => {
  it("returns empty string when there is nothing to override", () => {
    expect(buildIdentityPromptBlock(null)).toBe("");
    expect(buildIdentityPromptBlock({})).toBe("");
    expect(buildIdentityPromptBlock({ branding: {}, personality: {} })).toBe("");
  });

  it("builds a block containing identity, style and modifiers", () => {
    const block = buildIdentityPromptBlock({
      branding: { agentName: "Léa", agencyName: "Buchy" },
      personality: {
        writingStyle: "friendly",
        toneOfVoice: "warm",
        maxResponseWords: 50,
        language: "français",
        systemPromptModifiers: ["Propose une visite"],
      },
    });
    expect(block).toContain("Léa");
    expect(block).toContain("Buchy");
    expect(block).toContain("Propose une visite");
    expect(block).toContain("50 mots");
    expect(block.startsWith("\n\n")).toBe(true);
  });
});
