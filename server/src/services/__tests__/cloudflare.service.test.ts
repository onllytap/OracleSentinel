import { describe, it, expect } from "vitest";
import { classifyWorkerStatus, isValidWorkerName } from "../cloudflare.service";

// Locks in the Worker edge-status classification used by the QG Workers wall
// (/api/priv/workers). Pure function — no network. A health-ping HTTP code maps:
//   null → down · 5xx → degraded · any other reachable response (2xx/3xx/4xx) → online.
describe("cloudflare.service · classifyWorkerStatus", () => {
  it("returns 'down' when there is no HTTP response (timeout / DNS / refused)", () => {
    expect(classifyWorkerStatus(null)).toBe("down");
  });

  it("returns 'online' for any reachable response (2xx/3xx/4xx)", () => {
    expect(classifyWorkerStatus(200)).toBe("online");
    expect(classifyWorkerStatus(204)).toBe("online");
    expect(classifyWorkerStatus(301)).toBe("online");
    expect(classifyWorkerStatus(404)).toBe("online"); // edge up, route not handled
    expect(classifyWorkerStatus(429)).toBe("online");
  });

  it("returns 'degraded' for 5xx (worker throwing / origin error)", () => {
    expect(classifyWorkerStatus(500)).toBe("degraded");
    expect(classifyWorkerStatus(502)).toBe("degraded");
    expect(classifyWorkerStatus(503)).toBe("degraded");
  });
});

describe("cloudflare.service · isValidWorkerName", () => {
  it("accepts safe Cloudflare script names", () => {
    expect(isValidWorkerName("oraclesentinel-chatbot")).toBe(true);
    expect(isValidWorkerName("chatbot-21c265f0")).toBe(true);
    expect(isValidWorkerName("my_worker.v2")).toBe(true);
  });

  it("rejects names with path/charset injection attempts", () => {
    expect(isValidWorkerName("../etc/passwd")).toBe(false);
    expect(isValidWorkerName("a/b")).toBe(false);
    expect(isValidWorkerName("name with space")).toBe(false);
    expect(isValidWorkerName("")).toBe(false);
  });
});
