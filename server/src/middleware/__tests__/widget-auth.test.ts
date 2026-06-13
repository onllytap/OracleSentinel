import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRequestOrigin,
  issueWidgetToken,
  requireWidgetAuth,
} from "../widget-auth";

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

describe("widget-auth middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: "0123456789abcdef0123456789abcdef",
      JWT_ISSUER: "test-issuer",
      JWT_AUDIENCE: "test-audience",
    };
  });

  it("resolves origin from Origin first, then Referer", () => {
    expect(
      getRequestOrigin({
        headers: {
          origin: "https://client.example",
          referer: "https://ignored.example/page",
        },
      } as any),
    ).toBe("https://client.example");

    expect(
      getRequestOrigin({
        headers: { referer: "https://client.example/path?q=1" },
      } as any),
    ).toBe("https://client.example");
  });

  it("accepts a valid widget token with required scope", async () => {
    const token = await issueWidgetToken({
      widgetId: "demo",
      tenantId: "tenant-a",
      scopes: ["chat:write"],
      origin: "https://client.example",
    });
    const next = vi.fn();
    const req: any = {
      method: "POST",
      path: "/api/chat",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://client.example",
      },
    };

    await requireWidgetAuth(["chat:write"])(req, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.widgetAuth).toMatchObject({
      tenantId: "tenant-a",
      widgetId: "demo",
      scopes: ["chat:write"],
      origin: "https://client.example",
    });
  });

  it("rejects missing bearer tokens, origin mismatches, and missing scopes", async () => {
    const missingBearer = mockResponse();
    await requireWidgetAuth(["chat:write"])(
      { method: "POST", path: "/api/chat", headers: {} } as any,
      missingBearer,
      vi.fn(),
    );
    expect(missingBearer.statusCode).toBe(401);

    const token = await issueWidgetToken({
      widgetId: "demo",
      tenantId: "tenant-a",
      scopes: ["chat:read"],
      origin: "https://client.example",
    });

    const originMismatch = mockResponse();
    await requireWidgetAuth(["chat:read"])(
      {
        method: "POST",
        path: "/api/chat",
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://evil.example",
        },
      } as any,
      originMismatch,
      vi.fn(),
    );
    expect(originMismatch.statusCode).toBe(403);

    const missingScope = mockResponse();
    await requireWidgetAuth(["chat:write"])(
      {
        method: "POST",
        path: "/api/chat",
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://client.example",
        },
      } as any,
      missingScope,
      vi.fn(),
    );
    expect(missingScope.statusCode).toBe(403);
  });
});
