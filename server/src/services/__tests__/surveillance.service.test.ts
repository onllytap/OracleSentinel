import { describe, it, expect } from "vitest";
import { deriveLiveStatus } from "../surveillance.service";

// Locks in the per-bot live-status classification used by the Command Center
// surveillance wall (/api/priv/surveillance). Pure function — no DB required.
// Windows (defaults): live < 15 min · active < 24 h · idle < 7 d · else offline.
describe("surveillance.service · deriveLiveStatus", () => {
  const NOW = Date.UTC(2026, 5, 19, 12, 0, 0); // fixed reference instant
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("returns 'offline' when there is no activity timestamp", () => {
    expect(deriveLiveStatus(0, NOW)).toBe("offline");
    expect(deriveLiveStatus(NaN, NOW)).toBe("offline");
  });

  it("returns 'live' for activity within the last 15 minutes", () => {
    expect(deriveLiveStatus(NOW - 1 * MIN, NOW)).toBe("live");
    expect(deriveLiveStatus(NOW - 14 * MIN, NOW)).toBe("live");
  });

  it("treats future timestamps (clock skew) as 'live'", () => {
    expect(deriveLiveStatus(NOW + 5 * MIN, NOW)).toBe("live");
  });

  it("returns 'active' between 15 minutes and 24 hours", () => {
    expect(deriveLiveStatus(NOW - 30 * MIN, NOW)).toBe("active");
    expect(deriveLiveStatus(NOW - 23 * HOUR, NOW)).toBe("active");
  });

  it("returns 'idle' between 24 hours and 7 days", () => {
    expect(deriveLiveStatus(NOW - 2 * DAY, NOW)).toBe("idle");
    expect(deriveLiveStatus(NOW - 6 * DAY, NOW)).toBe("idle");
  });

  it("returns 'offline' beyond 7 days", () => {
    expect(deriveLiveStatus(NOW - 8 * DAY, NOW)).toBe("offline");
    expect(deriveLiveStatus(NOW - 365 * DAY, NOW)).toBe("offline");
  });

  it("uses boundaries consistently (15 min and 24 h thresholds)", () => {
    // Exactly at the 15-min boundary is no longer "live" (age < window is strict).
    expect(deriveLiveStatus(NOW - 15 * MIN, NOW)).toBe("active");
    // Exactly at the 24-h boundary is no longer "active".
    expect(deriveLiveStatus(NOW - 24 * HOUR, NOW)).toBe("idle");
  });
});
