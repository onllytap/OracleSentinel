import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAdminSessionSecret } from "../admin-session";

// F9 hardening: in production the admin-session signing secret MUST be a
// dedicated value, distinct from ADMIN_API_KEY. These tests lock that contract
// while proving the dev fallback (and any already-correct prod config) keep
// working.

describe("resolveAdminSessionSecret — F9 hardening", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("REFUSES when no dedicated ADMIN_SESSION_SECRET is set", () => {
      process.env.ADMIN_API_KEY = "api-key-value";
      expect(() => resolveAdminSessionSecret()).toThrow(/ADMIN_SESSION_SECRET is required/);
    });

    it("REFUSES when ADMIN_SESSION_SECRET equals ADMIN_API_KEY", () => {
      process.env.ADMIN_API_KEY = "same-value";
      process.env.ADMIN_SESSION_SECRET = "same-value";
      expect(() => resolveAdminSessionSecret()).toThrow(/must differ from ADMIN_API_KEY/);
    });

    it("accepts a dedicated secret distinct from ADMIN_API_KEY (no break)", () => {
      process.env.ADMIN_API_KEY = "api-key-value";
      process.env.ADMIN_SESSION_SECRET = "dedicated-distinct-secret";
      expect(resolveAdminSessionSecret()).toBe("dedicated-distinct-secret");
    });
  });

  describe("development", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("keeps the fallback to ADMIN_API_KEY (does not throw)", () => {
      process.env.ADMIN_API_KEY = "api-key-value";
      expect(resolveAdminSessionSecret()).toBe("api-key-value");
    });

    it("keeps the fallback to JWT_SECRET (does not throw)", () => {
      process.env.JWT_SECRET = "jwt-secret-value";
      expect(resolveAdminSessionSecret()).toBe("jwt-secret-value");
    });

    it("prefers a dedicated ADMIN_SESSION_SECRET when present", () => {
      process.env.ADMIN_API_KEY = "api-key-value";
      process.env.ADMIN_SESSION_SECRET = "dedicated";
      expect(resolveAdminSessionSecret()).toBe("dedicated");
    });
  });
});
