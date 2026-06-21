import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (no live DB) ───────────────────────────────────────────────────────
// Same idiom as tenant-config.chain.test.ts: a plain vi.fn() referenced from
// the factory (resolved lazily, after these consts are initialised). We mock
// the DB pool, the tenant-config service (version resolver + targeted cache
// reset) and the append-only audit log.
const queryMock = vi.fn();
const getTenantConfigVersionsMock = vi.fn();
const resetTenantConfigCacheMock = vi.fn();
const appendAuditMock = vi.fn();

vi.mock("../../db/pool", () => ({
  pool: { query: (...args: any[]) => queryMock(...args) },
  isDatabaseConfigured: true,
}));

vi.mock("../tenant-config.service", () => ({
  getTenantConfigVersions: (...args: any[]) => getTenantConfigVersionsMock(...args),
  resetTenantConfigCache: (...args: any[]) => resetTenantConfigCacheMock(...args),
}));

vi.mock("../audit.service", () => ({
  appendAudit: (...args: any[]) => appendAuditMock(...args),
}));

import {
  isOutOfDate,
  requestRedeploy,
  getActiveConfigVersion,
  getRedeployState,
} from "../redeploy.service";

// Route every tenant_redeploys SELECT to a configurable "active_version" and
// resolve all writes (INSERT/UPDATE) as no-ops.
function wireDb(activeVersion: number | null): void {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*select/i.test(String(sql))) {
      return {
        rows: [
          {
            tenant_id: "t",
            status: "succeeded",
            config_version: activeVersion,
            active_version: activeVersion,
            started_at: null,
            finished_at: null,
            error: null,
          },
        ],
      };
    }
    return { rows: [] };
  });
}

function version(id: number) {
  return { id, override: {}, createdAt: new Date().toISOString(), createdBy: null };
}

beforeEach(() => {
  queryMock.mockReset();
  getTenantConfigVersionsMock.mockReset();
  resetTenantConfigCacheMock.mockReset();
  appendAuditMock.mockReset();
  appendAuditMock.mockResolvedValue(undefined);
  resetTenantConfigCacheMock.mockReturnValue(undefined);
});

describe("redeploy.service · isOutOfDate (pure)", () => {
  it("is true when latest is newer than active", () => {
    expect(isOutOfDate(1, 2)).toBe(true);
  });

  it("is true when nothing is active yet but a latest exists", () => {
    expect(isOutOfDate(null, 5)).toBe(true);
  });

  it("is false when active already matches latest", () => {
    expect(isOutOfDate(3, 3)).toBe(false);
  });

  it("is false when active leads latest", () => {
    expect(isOutOfDate(7, 4)).toBe(false);
  });

  it("is false when there is no latest version", () => {
    expect(isOutOfDate(2, null)).toBe(false);
    expect(isOutOfDate(null, null)).toBe(false);
  });
});

describe("redeploy.service · requestRedeploy", () => {
  it("happy path → succeeded, applies latest + invalidates ONLY this tenant's cache", async () => {
    wireDb(3); // previously-active version
    getTenantConfigVersionsMock.mockResolvedValue([version(7)]);

    const state = await requestRedeploy("acme", "admin");

    expect(state.status).toBe("succeeded");
    expect(state.configVersion).toBe(7);
    expect(state.activeVersion).toBe(7);
    expect(state.error).toBeUndefined();

    // R3.5 — cache invalidation is scoped to THIS tenant only.
    expect(resetTenantConfigCacheMock).toHaveBeenCalledTimes(1);
    expect(resetTenantConfigCacheMock).toHaveBeenCalledWith("acme");

    // Audited: init + result(ok).
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "redeploy.init", targetId: "acme" }),
    );
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "redeploy.result", targetId: "acme" }),
    );
  });

  it("single-flight → a concurrent redeploy for the same tenant is rejected", async () => {
    wireDb(null);
    getTenantConfigVersionsMock.mockResolvedValue([version(2)]);

    // First call acquires the in-memory lock synchronously, then suspends on
    // its first awaited DB read → the lock is held when the second call starts.
    const first = requestRedeploy("flight", "admin");
    await expect(requestRedeploy("flight", "admin")).rejects.toThrow(
      "redeploy_in_progress",
    );
    await expect(first).resolves.toMatchObject({ status: "succeeded" });
  });

  it("releases the lock so a later redeploy for the same tenant is allowed", async () => {
    wireDb(1);
    getTenantConfigVersionsMock.mockResolvedValue([version(9)]);

    await requestRedeploy("again", "admin");
    const second = await requestRedeploy("again", "admin"); // not rejected
    expect(second.status).toBe("succeeded");
  });

  it("failure path → status rolled_back, restores previous active, never throws", async () => {
    wireDb(4); // previously-active version to restore
    getTenantConfigVersionsMock.mockRejectedValue(new Error("version lookup boom"));

    // Resolves (does not throw) even though the apply failed internally.
    const state = await requestRedeploy("fail", "admin");

    expect(["rolled_back", "failed"]).toContain(state.status);
    expect(state.activeVersion).toBe(4); // restored to the previous active
    expect(typeof state.error).toBe("string");

    // result(fail) is still audited.
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "redeploy.result", targetId: "fail" }),
    );
  });
});

describe("redeploy.service · reads", () => {
  it("getActiveConfigVersion returns the stored active version", async () => {
    wireDb(12);
    await expect(getActiveConfigVersion("acme")).resolves.toBe(12);
  });

  it("getRedeployState defaults to 'pending' when no row exists", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const state = await getRedeployState("ghost");
    expect(state.status).toBe("pending");
    expect(state.activeVersion).toBeNull();
    expect(state.configVersion).toBeNull();
  });
});
