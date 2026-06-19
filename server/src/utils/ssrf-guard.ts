// ============================================================================
// SSRF guard — outbound URL/host validation
// ============================================================================
// Defends user-supplied destinations (e.g. the webhook tester, CRM webhook
// transport) against Server-Side Request Forgery:
//   - protocol allowlist is enforced by the caller (http/https)
//   - string denylist for obvious local/private hostnames
//   - DNS-resolution check on the ACTUAL resolved IP(s), which defeats
//     DNS-rebinding and encoded-IP bypasses of the string denylist
//
// Pure + dependency-light so it is unit-testable in isolation.
// ============================================================================

import dns from "dns";

// Fast string-level denylist for obvious local / private hostnames.
// Not sufficient on its own (a public name can resolve to a private IP) —
// always pair with resolvesToPrivateAddress().
export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1"
  ) {
    return true;
  }

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// Returns true if a resolved IP address is loopback, private, link-local or
// otherwise non-routable. Works on the IP the hostname ACTUALLY resolves to,
// which defeats DNS-rebinding and encoded-IP bypasses of the string denylist.
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv6 (incl. IPv4-mapped ::ffff:a.b.c.d)
  if (addr.includes(":")) {
    if (addr === "::1" || addr === "::") return true;
    if (addr.startsWith("fe80") || addr.startsWith("fc") || addr.startsWith("fd")) return true;
    const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = addr.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // not a clean IPv4 → reject defensively
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast / reserved
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
  );
}

// Resolves a hostname and returns true if ANY resolved address is non-public.
export async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  // Literal IP? validate directly without DNS.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return isPrivateAddress(host);
  }
  try {
    const records = await dns.promises.lookup(host, { all: true });
    return records.some((r) => isPrivateAddress(r.address));
  } catch {
    return true; // resolution failure → reject defensively
  }
}
