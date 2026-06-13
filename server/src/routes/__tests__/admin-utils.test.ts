import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const warn = vi.fn();

vi.mock("../../db/pool", () => ({
  pool: {
    query: poolQuery,
  },
}));

vi.mock("../../utils/logger", () => ({
  createChildLogger: () => ({
    warn,
  }),
}));

describe("admin-utils", () => {
  beforeEach(() => {
    poolQuery.mockReset();
    warn.mockReset();
  });

  it("uses a quoted allowlisted table name for count queries", async () => {
    const { safeCount } = await import("../admin-utils");
    poolQuery.mockResolvedValueOnce({ rows: [{ c: 42 }] });

    await expect(safeCount("catalog_properties")).resolves.toBe(42);

    expect(poolQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*)::int AS c FROM "catalog_properties"',
      [],
    );
  });

  it("keeps where clauses parameterized by the caller", async () => {
    const { safeCount } = await import("../admin-utils");
    poolQuery.mockResolvedValueOnce({ rows: [{ c: 3 }] });

    await expect(
      safeCount("messages", "created_at > $1", ["2026-01-01"]),
    ).resolves.toBe(3);

    expect(poolQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*)::int AS c FROM "messages" WHERE created_at > $1',
      ["2026-01-01"],
    );
  });

  it("returns zero and logs when the database count fails", async () => {
    const { safeCount } = await import("../admin-utils");
    const error = new Error("relation does not exist");
    poolQuery.mockRejectedValueOnce(error);

    await expect(safeCount("leads")).resolves.toBe(0);

    expect(warn).toHaveBeenCalledWith(
      { err: error, table: "leads", where: undefined },
      "Admin count query failed",
    );
  });
});
