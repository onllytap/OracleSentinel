import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateCSRFToken,
  requireCSRF,
  verifyAdminSessionFromRequest,
} from "../admin-session";

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

async function signAdminToken(secretRaw: string, typ: string = "admin") {
  return await new SignJWT({ typ })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secretRaw));
}

describe("admin-session middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
  });

  it("generates a strong hex CSRF token", () => {
    expect(generateCSRFToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects requests without a session cookie or configured secret", async () => {
    await expect(verifyAdminSessionFromRequest({ headers: {} } as any)).resolves.toBe(
      false,
    );

    const token = await signAdminToken("secret");
    await expect(
      verifyAdminSessionFromRequest({
        headers: { cookie: `admin_session=${encodeURIComponent(token)}` },
      } as any),
    ).resolves.toBe(false);
  });

  it("accepts a signed admin session and rejects the wrong token type", async () => {
    process.env.ADMIN_SESSION_SECRET = "session-secret";
    const adminToken = await signAdminToken("session-secret");
    const userToken = await signAdminToken("session-secret", "user");

    await expect(
      verifyAdminSessionFromRequest({
        headers: { cookie: `admin_session=${encodeURIComponent(adminToken)}` },
      } as any),
    ).resolves.toBe(true);

    await expect(
      verifyAdminSessionFromRequest({
        headers: { cookie: `admin_session=${encodeURIComponent(userToken)}` },
      } as any),
    ).resolves.toBe(false);
  });

  it("allows safe methods but rejects unsafe requests without matching CSRF", () => {
    const middleware = requireCSRF();
    const next = vi.fn();

    middleware({ method: "GET", headers: {} } as any, mockResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);

    const rejected = mockResponse();
    middleware(
      {
        method: "POST",
        headers: {
          cookie: "csrf_token=abc",
          "x-csrf-token": "different",
        },
      } as any,
      rejected,
      vi.fn(),
    );
    expect(rejected.statusCode).toBe(403);

    const acceptedNext = vi.fn();
    middleware(
      {
        method: "POST",
        headers: {
          cookie: "csrf_token=abc",
          "x-csrf-token": "abc",
        },
      } as any,
      mockResponse(),
      acceptedNext,
    );
    expect(acceptedNext).toHaveBeenCalledTimes(1);
  });
});
