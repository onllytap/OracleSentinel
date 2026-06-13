import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdminApiKey } from "../admin-api-key";

function mockResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

describe("requireAdminApiKey", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_API_KEY;
  });

  it("returns 503 when the admin key is not configured", () => {
    const res = mockResponse();

    requireAdminApiKey()({ headers: {} } as any, res, vi.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Admin API key not configured" });
  });

  it("returns 401 when the provided admin key is missing or wrong", () => {
    process.env.ADMIN_API_KEY = "secret-key";
    const missing = mockResponse();
    const wrong = mockResponse();

    requireAdminApiKey()({ headers: {} } as any, missing, vi.fn());
    requireAdminApiKey()(
      { headers: { "x-admin-api-key": "wrong" } } as any,
      wrong,
      vi.fn(),
    );

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
  });

  it("calls next when the configured admin key matches", () => {
    process.env.ADMIN_API_KEY = "secret-key";
    const next = vi.fn();

    requireAdminApiKey()(
      { headers: { "x-admin-api-key": "secret-key" } } as any,
      mockResponse(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
