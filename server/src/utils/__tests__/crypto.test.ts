import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  encryptJson,
  decryptJson,
  isEncryptionConfigured,
} from "../crypto";

const KEY = "0".repeat(64); // 32 zero-bytes — deterministic test key
const prevKey = process.env.APP_ENCRYPTION_KEY;
const prevEnv = process.env.NODE_ENV;

describe("crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = prevKey;
    process.env.NODE_ENV = prevEnv;
  });

  it("reports configured when a valid key is present", () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it("round-trips a secret string without leaking plaintext", () => {
    const blob = encryptSecret("super-secret-token");
    expect(blob).not.toContain("super-secret-token");
    expect(decryptSecret(blob)).toBe("super-secret-token");
  });

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("round-trips JSON values", () => {
    const obj = { apiKey: "k-123", url: "https://example.test" };
    expect(decryptJson(encryptJson(obj))).toEqual(obj);
  });

  it("throws on a tampered blob (GCM auth tag mismatch)", () => {
    const buf = Buffer.from(encryptSecret("hello"), "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  it("refuses to operate in production without a key", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
