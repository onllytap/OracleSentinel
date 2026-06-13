import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadApi() {
  vi.resetModules();
  return await import("../api");
}

describe("frontend api service", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports backend health from the health endpoint", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    const { api } = await loadApi();

    await expect(api.healthCheck()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3001/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns false when health checks fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    const { api } = await loadApi();

    await expect(api.healthCheck()).resolves.toBe(false);
  });

  it("authenticates the widget and posts sanitized chat payload shape", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "widget-token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          response: "Bonjour",
          usedKnowledge: true,
          sourcePages: [{ title: "Guide", url: "https://example.test" }],
          suggestedActions: [{ type: "request_callback", label: "Rappel" }],
        }),
      );
    vi.stubGlobal("fetch", fetch);

    const { api } = await loadApi();
    const chunks: string[] = [];
    const metadata = vi.fn();

    await api.sendMessageStream(
      { sessionId: "session_123", message: "Salut", context: { view: "chat" } },
      (chunk) => chunks.push(chunk),
      metadata,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001/api/widget-auth?widget_id=default",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer widget-token",
        },
        body: JSON.stringify({
          message: "Salut",
          session_id: "session_123",
          context: { view: "chat" },
        }),
      }),
    );
    expect(chunks).toEqual(["Bonjour"]);
    expect(metadata).toHaveBeenCalledWith({
      usedKnowledge: true,
      sourcePages: [{ title: "Guide", url: "https://example.test" }],
      suggestedActions: [{ type: "request_callback", label: "Rappel" }],
    });
  });

  it("does not retry rate-limited chat responses and emits a stable fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "widget-token" }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Too many requests", code: "RATE_LIMIT" },
          { status: 429, statusText: "Too Many Requests" },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    const { api } = await loadApi();
    const chunks: string[] = [];

    await api.sendMessageStream(
      { sessionId: "session_123", message: "Salut" },
      (chunk) => chunks.push(chunk),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([
      "Le service est temporairement indisponible (limite atteinte). Veuillez réessayer plus tard.",
    ]);
  });

  it("submits lead forms with widget authorization", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "widget-token" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, pushedToCRM: true }));
    vi.stubGlobal("fetch", fetch);

    const { api } = await loadApi();

    await expect(
      api.submitLeadForm("session_123", {
        prenom: "Jean",
        nom: "Dupont",
        telephone: "0612345678",
        email: "",
        projet: "Achat",
        details: "T3",
      }),
    ).resolves.toEqual({ success: true, pushedToCRM: true });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001/api/leads",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer widget-token",
        },
        body: JSON.stringify({
          session_id: "session_123",
          prenom: "Jean",
          nom: "Dupont",
          telephone: "0612345678",
          email: "",
          projet: "Achat",
          details: "T3",
        }),
      }),
    );
  });
});
