import { describe, it, expect, vi } from "vitest";
import { resolveDbSslConfig } from "../pool";

// Unit tests for the environment-driven DB TLS resolver (finding F12).
// These assert that the DEFAULT behaviour is preserved (no env => no change),
// and that the opt-in hardening switches work. No database connection is made.

const REMOTE = "postgres://user:pass@db.neon.tech/app?sslmode=require";
const REMOTE_NO_SSLMODE = "postgres://user:pass@my-host.example.com:5432/app";
const LOCAL = "postgres://user:pass@localhost:5432/app";
const LOCAL_IP = "postgres://user:pass@127.0.0.1:5432/app";

const SAMPLE_PEM = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n";

describe("resolveDbSslConfig", () => {
  it("returns undefined (no TLS) for local hosts — unchanged behaviour", () => {
    expect(resolveDbSslConfig(LOCAL, {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveDbSslConfig(LOCAL_IP, {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("defaults remote hosts to rejectUnauthorized:false (preserves Neon connectivity) and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveDbSslConfig(REMOTE_NO_SSLMODE, {} as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ rejectUnauthorized: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats sslmode=require as TLS-required even on localhost", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveDbSslConfig(
      "postgres://user:pass@localhost:5432/app?sslmode=require",
      {} as NodeJS.ProcessEnv,
    );
    expect(cfg).toEqual({ rejectUnauthorized: false });
    expect(warn).toHaveBeenCalled();
  });

  it("enables chain validation when DB_SSL_REJECT_UNAUTHORIZED=true (no warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveDbSslConfig(REMOTE, {
      DB_SSL_REJECT_UNAUTHORIZED: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ rejectUnauthorized: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts '1' as a truthy value for DB_SSL_REJECT_UNAUTHORIZED", () => {
    const cfg = resolveDbSslConfig(REMOTE, {
      DB_SSL_REJECT_UNAUTHORIZED: "1",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ rejectUnauthorized: true });
  });

  it("pins an inline PEM CA via DB_SSL_CA", () => {
    const cfg = resolveDbSslConfig(REMOTE, {
      DB_SSL_REJECT_UNAUTHORIZED: "true",
      DB_SSL_CA: SAMPLE_PEM,
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ rejectUnauthorized: true, ca: SAMPLE_PEM.trim() });
  });

  it("does not crash when DB_SSL_CA points to a missing file (keeps connecting without pin)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = resolveDbSslConfig(REMOTE_NO_SSLMODE, {
      DB_SSL_CA: "/path/does/not/exist/ca.pem",
    } as unknown as NodeJS.ProcessEnv);
    // CA could not be read -> no `ca` field, default rejectUnauthorized:false.
    expect(cfg).toEqual({ rejectUnauthorized: false });
    expect(err).toHaveBeenCalled();
  });
});
