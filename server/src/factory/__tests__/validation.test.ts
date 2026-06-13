import { describe, expect, it, vi } from "vitest";
import {
  schemas,
  validateBody,
  validateParams,
  validateQuery,
} from "../validation";

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

describe("factory API validation", () => {
  it("clamps list query limits and stores parsed values on the request", () => {
    const req: any = { query: { limit: "9999", level: "warn" } };
    const next = vi.fn();

    validateQuery(schemas.getLogsQuery)(req, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.validatedQuery).toEqual({ limit: 200, level: "warn" });
  });

  it("rejects invalid log levels before route handlers run", () => {
    const req: any = { query: { limit: "25", level: "verbose" } };
    const res = mockResponse();
    const next = vi.fn();

    validateQuery(schemas.getLogsQuery)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it("allows the default tenant workflow but rejects unsafe tenant ids", () => {
    const defaultReq: any = { query: {} };
    const defaultNext = vi.fn();
    validateQuery(schemas.knowledgeImportQuery)(
      defaultReq,
      mockResponse(),
      defaultNext,
    );

    expect(defaultNext).toHaveBeenCalledTimes(1);
    expect(defaultReq.validatedQuery).toEqual({});

    const unsafeReq: any = { query: { tenant_id: "../../prod" } };
    const unsafeRes = mockResponse();
    const unsafeNext = vi.fn();
    validateQuery(schemas.knowledgeImportQuery)(
      unsafeReq,
      unsafeRes,
      unsafeNext,
    );

    expect(unsafeNext).not.toHaveBeenCalled();
    expect(unsafeRes.statusCode).toBe(400);
  });

  it("validates build and tenant route parameters", () => {
    const validBuildReq: any = { params: { buildId: "build-deadbeef" } };
    const validBuildNext = vi.fn();
    validateParams(schemas.buildIdParam)(
      validBuildReq,
      mockResponse(),
      validBuildNext,
    );

    expect(validBuildNext).toHaveBeenCalledTimes(1);
    expect(validBuildReq.validatedParams).toEqual({
      buildId: "build-deadbeef",
    });

    const unsafeTenantReq: any = { params: { tenantId: "tenant/../prod" } };
    const unsafeTenantRes = mockResponse();
    const unsafeTenantNext = vi.fn();
    validateParams(schemas.tenantIdParam)(
      unsafeTenantReq,
      unsafeTenantRes,
      unsafeTenantNext,
    );

    expect(unsafeTenantNext).not.toHaveBeenCalled();
    expect(unsafeTenantRes.statusCode).toBe(400);
  });

  it("rejects malformed webhook test bodies at the API boundary", () => {
    const req: any = { body: { url: "not a url" } };
    const res = mockResponse();
    const next = vi.fn();

    validateBody(schemas.webhookTestBody)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });
});
