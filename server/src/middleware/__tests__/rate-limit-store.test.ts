import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresRateLimitStore } from "../rate-limit-store";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../db/pool", () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

vi.mock("../../utils/logger", () => ({
  createChildLogger: () => ({
    info: mocks.info,
    error: mocks.error,
  }),
}));

describe("PostgresRateLimitStore", () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.info.mockReset();
    mocks.error.mockReset();
  });

  it("initializes the rate limit table with quoted identifiers", async () => {
    new PostgresRateLimitStore(1000);

    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledTimes(2));

    expect(mocks.poolQuery.mock.calls[0][0]).toContain(
      'CREATE TABLE IF NOT EXISTS "rate_limits"',
    );
    expect(mocks.poolQuery.mock.calls[1][0]).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_rate_limits_reset"',
    );
    expect(mocks.poolQuery.mock.calls[1][0]).toContain(
      'ON "rate_limits" (reset_at)',
    );
    expect(mocks.info).toHaveBeenCalledWith("Rate limit table initialized");
  });

  it("increments an existing key and returns the database reset time", async () => {
    const store = new PostgresRateLimitStore(1000);
    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledTimes(2));
    mocks.poolQuery.mockClear();

    const resetAt = new Date("2026-01-01T00:00:00.000Z");
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [{ hits: 5, reset_at: resetAt }],
    });

    await expect(store.increment("client-a")).resolves.toEqual({
      totalHits: 5,
      resetTime: resetAt,
    });

    expect(mocks.poolQuery.mock.calls[0][0]).toContain(
      'INSERT INTO "rate_limits"',
    );
    expect(mocks.poolQuery.mock.calls[0][0]).toContain('"rate_limits".reset_at');
    expect(mocks.poolQuery.mock.calls[0][1][0]).toBe("client-a");
  });

  it("falls back open when increment persistence fails", async () => {
    const store = new PostgresRateLimitStore(1000);
    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledTimes(2));
    mocks.poolQuery.mockClear();

    const failure = new Error("db down");
    mocks.poolQuery.mockRejectedValueOnce(failure);

    const result = await store.increment("client-b");

    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
    expect(mocks.error).toHaveBeenCalledWith(
      { err: failure, key: "client-b" },
      "Rate limit increment failed",
    );
  });

  it("uses parameterized deletes and cleanup queries", async () => {
    const store = new PostgresRateLimitStore(1000);
    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledTimes(2));
    mocks.poolQuery.mockClear();

    await store.resetKey("client-c");
    await store.resetAll();
    await store.cleanup();

    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM "rate_limits" WHERE key = $1',
      ["client-c"],
    );
    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM "rate_limits"',
    );
    expect(mocks.poolQuery).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM "rate_limits" WHERE reset_at <= NOW()',
    );
  });
});
