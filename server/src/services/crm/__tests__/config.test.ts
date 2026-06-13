import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCrmConfig, loadCrmConfig, resetCrmConfig } from "../config";

describe("CRM config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, CRM_LOG_LEVEL: "silent" };
    resetCrmConfig();
  });

  it("defaults to a safe disabled CRM configuration", () => {
    delete process.env.CRM_PROVIDER;
    delete process.env.CRM_MIN_PUSH_SCORE;

    expect(loadCrmConfig()).toMatchObject({
      provider: "none",
      minPushScore: 60,
      identityKey: "phone",
      duplicateStrategy: "update",
      fallbackBaseFields: true,
      logLevel: "silent",
      retry: {
        maxRetries: 3,
        delayMs: 1000,
        timeoutMs: 10000,
      },
    });
  });

  it("normalizes invalid enum environment values back to safe defaults", () => {
    process.env.CRM_PROVIDER = "bad-provider";
    process.env.CRM_IDENTITY_KEY = "name";
    process.env.CRM_DUPLICATE_STRATEGY = "overwrite";
    process.env.CRM_LOG_LEVEL = "loud";

    expect(loadCrmConfig()).toMatchObject({
      provider: "none",
      identityKey: "phone",
      duplicateStrategy: "update",
      logLevel: "info",
    });
  });

  it("preserves numeric misconfiguration so startup validation can fail loudly", () => {
    process.env.CRM_MIN_PUSH_SCORE = "not-a-number";

    expect(Number.isNaN(loadCrmConfig().minPushScore)).toBe(true);
  });

  it("caches and resets the singleton config", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.CRM_PROVIDER = "airtable";

    const first = getCrmConfig();
    process.env.CRM_PROVIDER = "twenty";
    const cached = getCrmConfig();
    resetCrmConfig();
    const reloaded = getCrmConfig();

    expect(first.provider).toBe("airtable");
    expect(cached.provider).toBe("airtable");
    expect(reloaded.provider).toBe("twenty");
    log.mockRestore();
  });
});
