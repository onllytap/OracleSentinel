import { describe, expect, it } from "vitest";
import type { CrmConfig } from "../config";
import { validatePushResult, type RawPushResult } from "../push-result";

const baseConfig: CrmConfig = {
  provider: "twenty",
  minPushScore: 60,
  identityKey: "phone",
  duplicateStrategy: "update",
  strict: {
    requireId: true,
    verifyWrite: true,
    customFields: false,
  },
  fallbackBaseFields: true,
  logLevel: "silent",
  retry: {
    maxRetries: 3,
    delayMs: 1000,
    timeoutMs: 10000,
  },
};

const baseRaw: RawPushResult = {
  success: true,
  personId: "person-1",
  mode: "create",
  verified: true,
  durationMs: 42,
  requestId: "req-1",
  customFieldsWritten: true,
};

describe("CRM push result validation", () => {
  it("passes through successful strict CRM pushes", () => {
    expect(validatePushResult(baseRaw, baseConfig)).toMatchObject({
      success: true,
      personId: "person-1",
      mode: "create",
      verified: true,
      warnings: [],
      error: null,
    });
  });

  it("fails strict results without a CRM person id", () => {
    const result = validatePushResult(
      { ...baseRaw, personId: null },
      baseConfig,
    );

    expect(result.success).toBe(false);
    expect(result.mode).toBe("fail");
    expect(result.error).toContain("STRICT_REQUIRE_ID");
  });

  it("fails strict results when read-after-write verification fails", () => {
    const result = validatePushResult(
      { ...baseRaw, verified: false },
      baseConfig,
    );

    expect(result.success).toBe(false);
    expect(result.mode).toBe("fail");
    expect(result.error).toContain("STRICT_VERIFY_WRITE");
  });

  it("converts relaxed strict failures into explicit degraded warnings", () => {
    const relaxed: CrmConfig = {
      ...baseConfig,
      strict: {
        requireId: false,
        verifyWrite: false,
        customFields: false,
      },
    };

    const result = validatePushResult(
      {
        ...baseRaw,
        personId: null,
        verified: false,
        customFieldsWritten: false,
      },
      relaxed,
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      "DEGRADED: personId not returned (CRM_STRICT_REQUIRE_ID=false)",
      "DEGRADED: read-after-write skipped (CRM_STRICT_VERIFY_WRITE=false)",
      "DEGRADED: custom fields not written (fallback to base fields)",
    ]);
  });
});
