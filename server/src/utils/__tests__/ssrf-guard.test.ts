import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "dns";
import {
  isPrivateAddress,
  isBlockedWebhookHost,
  resolvesToPrivateAddress,
} from "../ssrf-guard";

describe("isPrivateAddress", () => {
  it("flags loopback / private / link-local / CGNAT / multicast IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows clearly public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("handles IPv6 loopback, ULA, link-local and IPv4-mapped", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false); // public IPv6
  });

  it("rejects malformed IPv4 defensively", () => {
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("isBlockedWebhookHost (string denylist)", () => {
  it("blocks local + private literal hostnames", () => {
    for (const h of [
      "localhost",
      "app.localhost",
      "printer.local",
      "::1",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.0.10",
      "172.20.0.1",
      "169.254.169.254",
    ]) {
      expect(isBlockedWebhookHost(h), h).toBe(true);
    }
  });

  it("does not block public hostnames (DNS check handles those)", () => {
    for (const h of ["example.com", "hooks.slack.com", "api.crm.fr"]) {
      expect(isBlockedWebhookHost(h), h).toBe(false);
    }
  });
});

describe("resolvesToPrivateAddress (DNS-rebinding defense)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("short-circuits literal IPs without DNS", async () => {
    expect(await resolvesToPrivateAddress("127.0.0.1")).toBe(true);
    expect(await resolvesToPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("blocks a public name that resolves to a private IP (rebinding)", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ] as any);
    expect(await resolvesToPrivateAddress("evil.example.com")).toBe(true);
  });

  it("allows a public name that resolves to a public IP", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as any);
    expect(await resolvesToPrivateAddress("example.com")).toBe(false);
  });

  it("blocks if ANY resolved address is private (mixed records)", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as any);
    expect(await resolvesToPrivateAddress("split.example.com")).toBe(true);
  });

  it("rejects defensively when DNS resolution fails", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    expect(await resolvesToPrivateAddress("nonexistent.invalid")).toBe(true);
  });
});
