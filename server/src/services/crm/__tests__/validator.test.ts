import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmConfig } from "../config";
import { validateCrmConfiguration } from "../validator";

describe("CRM configuration validator", () => {
  const originalEnv = { ...process.env };
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv, CRM_LOG_LEVEL: "silent" };
    resetCrmConfig();
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("warns but stays valid when CRM is disabled explicitly", () => {
    process.env.CRM_PROVIDER = "none";

    const result = validateCrmConfiguration();

    expect(result.valid).toBe(true);
    expect(result.provider).toBe("none");
    expect(result.warnings).toContain("CRM_PROVIDER=none - CRM is disabled");
  });

  it("rejects invalid numeric push scores, including NaN", () => {
    process.env.CRM_MIN_PUSH_SCORE = "abc";

    const result = validateCrmConfiguration();

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "CRM_MIN_PUSH_SCORE=NaN is invalid (must be 0-100)",
    );
  });

  it("requires Twenty URL and API key when Twenty is selected", () => {
    process.env.CRM_PROVIDER = "twenty";
    delete process.env.TWENTY_API_URL;
    delete process.env.TWENTY_API_KEY;

    const result = validateCrmConfiguration();

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "TWENTY_API_URL is required when CRM_PROVIDER=twenty",
    );
    expect(result.errors).toContain(
      "TWENTY_API_KEY is required when CRM_PROVIDER=twenty",
    );
  });

  it("warns when Airtable is selected but disabled", () => {
    process.env.CRM_PROVIDER = "airtable";
    process.env.AIRTABLE_ENABLED = "false";

    const result = validateCrmConfiguration();

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("AIRTABLE_ENABLED=false - Airtable is disabled");
  });
});
