import { describe, it, expect } from "vitest";
import { deriveHealth } from "../fleet.service";

// Locks in the per-agency health classification used by the Command Center
// fleet supervision (/api/priv/overview). Pure function — no DB required.
describe("fleet.service · deriveHealth", () => {
  it("returns 'empty' when the agency has no catalog (highest precedence)", () => {
    // No catalog wins even if there are import errors or recent activity.
    expect(
      deriveHealth({ propertyCount: 0, lastImportErrors: 5, active: true }),
    ).toBe("empty");
  });

  it("returns 'attention' when the last import had errors", () => {
    expect(
      deriveHealth({ propertyCount: 12, lastImportErrors: 3, active: true }),
    ).toBe("attention");
  });

  it("returns 'idle' when a catalog exists but there is no recent activity", () => {
    expect(
      deriveHealth({ propertyCount: 12, lastImportErrors: 0, active: false }),
    ).toBe("idle");
  });

  it("returns 'healthy' when catalog present, no import errors and active", () => {
    expect(
      deriveHealth({ propertyCount: 12, lastImportErrors: 0, active: true }),
    ).toBe("healthy");
  });
});
