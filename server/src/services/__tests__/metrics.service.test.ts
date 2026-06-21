import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the DB pool BEFORE importing the service (vi.mock is hoisted). The path
// is resolved to the same absolute module the service imports ("../db/pool"),
// so the service-under-test receives this mock. No live DB is ever touched.
vi.mock("../../db/pool", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../db/pool";
import {
  computeResponseRate,
  probeLatency,
  getBotMetrics,
} from "../metrics.service";

// `restoreMocks`/`clearMocks` (vitest.config) reset spies before each test, but
// stubbed globals must be cleared explicitly so `fetch` does not leak.
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── computeResponseRate (pure) ───────────────────────────────────────────────
describe("metrics.service · computeResponseRate", () => {
  it("returns 0 when there are no user messages (no divide-by-zero) — R6.3", () => {
    expect(computeResponseRate(0, 0)).toBe(0);
    expect(computeResponseRate(0, 5)).toBe(0); // replies but no user turn
  });

  it("computes the correct percentage (rounded)", () => {
    expect(computeResponseRate(10, 8)).toBe(80);
    expect(computeResponseRate(4, 1)).toBe(25);
    expect(computeResponseRate(3, 1)).toBe(33); // 33.33 → 33
    expect(computeResponseRate(5, 5)).toBe(100);
  });

  it("clamps to 0..100 and treats bad input as 0", () => {
    expect(computeResponseRate(5, 10)).toBe(100); // 200% capped
    expect(computeResponseRate(10, -3)).toBe(0); // negative replies floored
    expect(computeResponseRate(Number.NaN, 5)).toBe(0);
    expect(computeResponseRate(10, Number.NaN)).toBe(0);
  });
});

// ── probeLatency (real probe, mirrors cloudflare.service pingWorker) ──────────
describe("metrics.service · probeLatency", () => {
  it("returns null without calling fetch when the URL is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeLatency("", 50)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when fetch rejects (unreachable / refused) — R6.5/R7.4", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await probeLatency("http://localhost:3001/health", 50)).toBeNull();
  });

  it("returns null when the probe times out (AbortError)", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    expect(await probeLatency("http://localhost:3001/health", 50)).toBeNull();
  });

  it("returns a non-negative number when fetch resolves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const ms = await probeLatency("http://localhost:3001/health", 50);
    expect(typeof ms).toBe("number");
    expect(ms as number).toBeGreaterThanOrEqual(0);
  });
});

// ── getBotMetrics (DB mocked, fetch stubbed) ─────────────────────────────────
describe("metrics.service · getBotMetrics", () => {
  it("returns the expected messageCount / lastActivityAt shape", async () => {
    const lastActivity = "2026-01-15T10:30:00.000Z";
    // Two read-only round-trips, in order: (1) totals, (2) windowed breakdown.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{ message_count: 42, last_activity: lastActivity }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ user_count: 10, assistant_count: 8 }],
      } as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));

    const m = await getBotMetrics("buchy-immo");

    expect(m.tenantId).toBe("buchy-immo");
    expect(m.messageCount).toBe(42);
    expect(m.lastActivityAt).toBe(lastActivity);
    expect(m.responseRate).toBe(80); // 8 assistant / 10 user
    expect(typeof m.measuredLatencyMs).toBe("number");
    expect(typeof m.hostingLocation).toBe("string");
    expect(m.hostingLocation.length).toBeGreaterThan(0);
  });

  it("degrades to zeros/null and never throws when the DB fails", async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error("db down"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));

    const m = await getBotMetrics("missing-tenant");

    expect(m.tenantId).toBe("missing-tenant");
    expect(m.messageCount).toBe(0);
    expect(m.responseRate).toBe(0);
    expect(m.lastActivityAt).toBeNull();
    expect(m.measuredLatencyMs).toBeNull(); // probe failed
    expect(typeof m.hostingLocation).toBe("string");
  });
});
