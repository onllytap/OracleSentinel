import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processMessage: vi.fn(),
  listConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  submitLeadForm: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../services/chat.service", () => ({
  ChatService: {
    processMessage: mocks.processMessage,
    listConversations: mocks.listConversations,
    getConversationMessages: mocks.getConversationMessages,
    submitLeadForm: mocks.submitLeadForm,
  },
}));

vi.mock("../../utils/logger", () => ({
  createChildLogger: () => ({
    error: mocks.logError,
  }),
}));

import { ChatController } from "../chat.controller";

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

describe("ChatController", () => {
  beforeEach(() => {
    mocks.processMessage.mockReset();
    mocks.listConversations.mockReset();
    mocks.getConversationMessages.mockReset();
    mocks.submitLeadForm.mockReset();
    mocks.logError.mockReset();
  });

  it("validates, sanitizes, and forwards chat messages with tenant context", async () => {
    const res = mockResponse();
    mocks.processMessage.mockResolvedValueOnce({ response: "Bonjour" });

    await ChatController.sendMessage(
      {
        body: {
          session_id: "session_123",
          message: " Salut <b>client</b> ",
        },
        widgetAuth: { tenantId: "tenant-a" },
      } as any,
      res,
    );

    expect(mocks.processMessage).toHaveBeenCalledWith(
      "session_123",
      "Salut &lt;b&gt;client&lt;/b&gt;",
      "tenant-a",
    );
    expect(res.body).toEqual({ response: "Bonjour" });
  });

  it("rejects invalid chat payloads before reaching the service", async () => {
    const res = mockResponse();

    await ChatController.sendMessage(
      { body: { session_id: "bad id!", message: "hello" } } as any,
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "session_id invalide" });
    expect(mocks.processMessage).not.toHaveBeenCalled();
  });

  it("maps upstream and rate-limit chat errors to stable API responses", async () => {
    const rateLimited = mockResponse();
    mocks.processMessage.mockRejectedValueOnce({ status: 429 });
    await ChatController.sendMessage(
      { body: { session_id: "s1", message: "hello" } } as any,
      rateLimited,
    );
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.body).toEqual({
      error: "Trop de requêtes. Veuillez réessayer plus tard.",
      code: "RATE_LIMIT",
    });

    const missingApiKey = mockResponse();
    mocks.processMessage.mockRejectedValueOnce({ code: "MISSING_API_KEY" });
    await ChatController.sendMessage(
      { body: { session_id: "s1", message: "hello" } } as any,
      missingApiKey,
    );
    expect(missingApiKey.statusCode).toBe(503);
    expect(missingApiKey.body).toEqual({
      error: "LLM not configured",
      code: "LLM_NOT_CONFIGURED",
    });

    const upstream = mockResponse();
    mocks.processMessage.mockRejectedValueOnce({ status: 502 });
    await ChatController.sendMessage(
      { body: { session_id: "s1", message: "hello" } } as any,
      upstream,
    );
    expect(upstream.statusCode).toBe(503);
    expect(upstream.body).toEqual({
      error: "Service temporairement indisponible. Veuillez réessayer plus tard.",
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("clamps conversation list pagination and defaults tenant safely", async () => {
    const res = mockResponse();
    mocks.listConversations.mockResolvedValueOnce([{ sessionId: "a" }]);

    await ChatController.listConversations(
      { query: { limit: "999", offset: "-12" } } as any,
      res,
    );

    expect(mocks.listConversations).toHaveBeenCalledWith("default", 100, 0);
    expect(res.body).toEqual({ conversations: [{ sessionId: "a" }] });
  });

  it("loads conversation messages with a bounded limit", async () => {
    const res = mockResponse();
    mocks.getConversationMessages.mockResolvedValueOnce([{ role: "user" }]);

    await ChatController.getConversationMessages(
      { params: { sessionId: "s1" }, query: { limit: "9999" } } as any,
      res,
    );

    expect(mocks.getConversationMessages).toHaveBeenCalledWith(
      "s1",
      "default",
      500,
    );
    expect(res.body).toEqual({
      sessionId: "s1",
      messages: [{ role: "user" }],
    });
  });

  it("validates lead form session ids and maps duplicate phone responses", async () => {
    const invalid = mockResponse();
    await ChatController.submitLeadForm(
      { body: { session_id: "bad id!" } } as any,
      invalid,
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toEqual({ error: "session_id invalide" });

    const duplicate = mockResponse();
    mocks.submitLeadForm.mockResolvedValueOnce({
      success: false,
      error: "DUPLICATE_PHONE",
    });

    await ChatController.submitLeadForm(
      {
        body: {
          session_id: "session_123",
          prenom: "Jean",
          nom: "Dupont",
          telephone: "06 12 34 56 78",
          email: "",
          projet: "Achat",
        },
        widgetAuth: { tenantId: "tenant-a" },
      } as any,
      duplicate,
    );

    expect(mocks.submitLeadForm).toHaveBeenCalledWith(
      "session_123",
      expect.objectContaining({ telephone: "0612345678" }),
      "tenant-a",
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toEqual({
      error:
        "Ce numéro de téléphone a déjà été utilisé récemment. Merci d'en saisir un autre.",
      code: "DUPLICATE_PHONE",
    });
  });
});
