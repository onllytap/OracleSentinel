import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// ChatService.processMessage — orchestration flow (finding F6, target c)
//
// Locks the production-critical behaviour WITHOUT changing it:
//   - tenant_id scoping (default fallback + trimming, used in every query)
//   - user/assistant message persistence
//   - CRM push gating by completeness AND the CRM_MIN_PUSH_SCORE threshold
//
// EVERYTHING external is mocked: PostgreSQL pool, LLM, knowledge/RAG,
// qualification, CRM connector, catalog, prompts. No DB / network / LLM.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const clientRelease = vi.fn();
  return {
    clientQuery,
    clientRelease,
    connect: vi.fn(),
    generateResponse: vi.fn(),
    needsKnowledgeLookup: vi.fn(),
    searchKnowledge: vi.fn(),
    buildContext: vi.fn(),
    extractLeadData: vi.fn(),
    buildQualificationHint: vi.fn(),
    getNextQuestionHint: vi.fn(),
    getFormattedContext: vi.fn(),
    getCRMConnector: vi.fn(),
    pushLead: vi.fn(),
    searchForContext: vi.fn(),
    getSystemPrompt: vi.fn(),
    debugLog: vi.fn(),
  };
});

vi.mock("../../db/pool", () => ({
  pool: { connect: h.connect, query: vi.fn() },
}));
vi.mock("../llm.service", () => ({
  LLMService: { generateResponse: h.generateResponse },
}));
vi.mock("../knowledge.service", () => ({
  KnowledgeService: {
    needsKnowledgeLookup: h.needsKnowledgeLookup,
    searchKnowledge: h.searchKnowledge,
    buildContext: h.buildContext,
  },
}));
vi.mock("../qualification.service", () => ({
  QualificationService: {
    extractLeadData: h.extractLeadData,
    buildQualificationHint: h.buildQualificationHint,
    getNextQuestionHint: h.getNextQuestionHint,
  },
}));
vi.mock("../variables.service", () => ({
  VariablesService: { getFormattedContext: h.getFormattedContext },
}));
vi.mock("../airtable.service", () => ({ AirtableService: {} }));
vi.mock("../crm", () => ({ getCRMConnector: h.getCRMConnector }));
vi.mock("../catalog.service", () => ({
  CatalogService: { searchForContext: h.searchForContext },
}));
vi.mock("../../core/prompts", () => ({ getSystemPrompt: h.getSystemPrompt }));
vi.mock("../../utils/debug-log", () => ({ debugLog: h.debugLog }));

import { ChatService } from "../chat.service";

const COMPLETE_LEAD = {
  prenom: "Jean",
  nom: "Dupont",
  numero_telephone: "0612345678",
  type: "Achat immobilier",
  besoin: "T3 lumineux",
  adresse: "Paris",
};

function qualification(over: Record<string, unknown>) {
  return {
    leadData: {},
    score: 0,
    missingFields: ["prenom", "nom", "numero_telephone", "type", "besoin", "adresse"],
    isComplete: false,
    conversationSummary: "",
    notes: "",
    agentNote: "",
    ...over,
  };
}

const findCall = (re: RegExp, predicate?: (sql: string) => boolean) =>
  h.clientQuery.mock.calls.find(
    (c) => re.test(String(c[0])) && (!predicate || predicate(String(c[0]))),
  );

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  // Re-establish implementations (restoreMocks wipes them between tests).
  h.connect.mockImplementation(async () => ({
    query: h.clientQuery,
    release: h.clientRelease,
  }));
  h.clientQuery.mockImplementation(async (sql: string) => {
    if (/INSERT INTO conversations/i.test(sql)) return { rows: [{ id: "conv-1" }] };
    if (/SELECT role, content FROM messages/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  h.generateResponse.mockResolvedValue("Réponse IA");
  h.needsKnowledgeLookup.mockReturnValue(false);
  h.searchKnowledge.mockResolvedValue([]);
  h.buildContext.mockReturnValue("");
  h.getFormattedContext.mockReturnValue("");
  h.buildQualificationHint.mockReturnValue(null);
  h.getNextQuestionHint.mockReturnValue("demander le prénom");
  h.getSystemPrompt.mockReturnValue({
    domainId: "immobilier",
    domainName: "Immobilier",
    systemPrompt: "SYS {DYNAMIC_VARIABLES} {CHAT_TURN_HINT}",
  });
  h.pushLead.mockResolvedValue({ success: true, recordId: "rec-1" });
  h.getCRMConnector.mockReturnValue({ providerName: "twenty", pushLead: h.pushLead });
  h.searchForContext.mockResolvedValue([]);
  h.extractLeadData.mockResolvedValue(qualification({})); // incomplete by default → no push

  delete process.env.CRM_MIN_PUSH_SCORE;
  delete process.env.AIRTABLE_MIN_SCORE;
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.FORCE_DATE_RDV;
});

// ===========================================================================
// Tenant scoping + message persistence
// ===========================================================================

describe("ChatService.processMessage — tenant scoping & persistence", () => {
  it("defaults the tenant to 'default' and persists user + assistant messages", async () => {
    const res = await ChatService.processMessage(
      "sess-1",
      "Je cherche un appartement a Paris",
      "",
    );

    expect(findCall(/INSERT INTO conversations/i)?.[1]).toEqual([
      "default",
      "sess-1",
    ]);
    expect(
      findCall(/INSERT INTO messages/i, (s) => /'user'/.test(s))?.[1],
    ).toEqual(["default", "conv-1", "Je cherche un appartement a Paris"]);
    expect(
      findCall(/INSERT INTO messages/i, (s) => /'assistant'/.test(s))?.[1],
    ).toEqual(["default", "conv-1", "Réponse IA"]);

    expect(res.response).toBe("Réponse IA");
    expect(h.clientRelease).toHaveBeenCalledTimes(1);
  });

  it("trims a provided tenant id before scoping queries", async () => {
    await ChatService.processMessage("sess-2", "Bonjour je regarde les biens", "  acme  ");
    expect(findCall(/INSERT INTO conversations/i)?.[1]).toEqual(["acme", "sess-2"]);
  });

  it("loads conversation history scoped to the conversation and tenant", async () => {
    await ChatService.processMessage("sess-7", "Je cherche un appartement", "acme");
    const histCall = findCall(/SELECT role, content FROM messages/i);
    expect(histCall?.[1]?.[0]).toBe("conv-1"); // conversation_id
    expect(histCall?.[1]?.[1]).toBe("acme"); // tenant_id
  });

  it("always releases the pooled client", async () => {
    h.generateResponse.mockRejectedValueOnce(new Error("LLM down"));
    await expect(
      ChatService.processMessage("sess-x", "Je cherche un appartement", "acme"),
    ).rejects.toThrow();
    expect(h.clientRelease).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// CRM push gating (completeness + score threshold)
// ===========================================================================

describe("ChatService.processMessage — CRM push gating", () => {
  it("pushes a complete, high-score lead and persists it locally", async () => {
    h.extractLeadData.mockResolvedValue(
      qualification({
        leadData: COMPLETE_LEAD,
        score: 80,
        missingFields: [],
        isComplete: true,
        conversationSummary: "Recherche T3 a Paris",
      }),
    );

    const res = await ChatService.processMessage(
      "sess-3",
      "Je cherche un appartement a Paris",
      "acme",
    );

    expect(h.pushLead).toHaveBeenCalledTimes(1);
    const [cdmLead, sessionId] = h.pushLead.mock.calls[0];
    expect(sessionId).toBe("sess-3");
    expect(cdmLead.person).toMatchObject({
      firstName: "Jean",
      lastName: "Dupont",
      phone: "0612345678",
      externalId: "phone-612345678", // last 9 digits, stable person id
      source: "CHATBOT",
    });
    expect(cdmLead.qualificationScore).toBe(80);

    expect(res.qualification.pushedToCRM).toBe(true);
    expect(findCall(/UPDATE conversations SET status = 'completed'/i)).toBeTruthy();
    expect(findCall(/INSERT INTO leads/i)).toBeTruthy();
  });

  it("skips the CRM push when the score is below the default minimum (60)", async () => {
    h.extractLeadData.mockResolvedValue(
      qualification({
        leadData: COMPLETE_LEAD,
        score: 50,
        missingFields: [],
        isComplete: true,
      }),
    );

    const res = await ChatService.processMessage(
      "sess-4",
      "Je cherche un appartement a Paris",
      "acme",
    );

    expect(h.pushLead).not.toHaveBeenCalled();
    expect(res.qualification.pushedToCRM).toBe(false);
  });

  it("skips the CRM push when the lead is incomplete despite a high score", async () => {
    h.extractLeadData.mockResolvedValue(
      qualification({
        leadData: { prenom: "Jean" },
        score: 95,
        missingFields: ["nom"],
        isComplete: false,
      }),
    );

    await ChatService.processMessage(
      "sess-5",
      "Je cherche un appartement a Paris",
      "acme",
    );

    expect(h.pushLead).not.toHaveBeenCalled();
  });

  it("honours the CRM_MIN_PUSH_SCORE threshold from the environment", async () => {
    process.env.CRM_MIN_PUSH_SCORE = "85";
    h.extractLeadData.mockResolvedValue(
      qualification({
        leadData: COMPLETE_LEAD,
        score: 80, // below the configured 85
        missingFields: [],
        isComplete: true,
      }),
    );

    await ChatService.processMessage(
      "sess-6",
      "Je cherche un appartement a Paris",
      "acme",
    );

    expect(h.pushLead).not.toHaveBeenCalled();
  });

  it("does not mark the conversation completed when the CRM push fails", async () => {
    h.pushLead.mockResolvedValue({ success: false, error: "BOOM" });
    h.extractLeadData.mockResolvedValue(
      qualification({
        leadData: COMPLETE_LEAD,
        score: 80,
        missingFields: [],
        isComplete: true,
      }),
    );

    const res = await ChatService.processMessage(
      "sess-8",
      "Je cherche un appartement a Paris",
      "acme",
    );

    expect(h.pushLead).toHaveBeenCalledTimes(1);
    expect(res.qualification.pushedToCRM).toBe(false);
    expect(findCall(/UPDATE conversations SET status = 'completed'/i)).toBeUndefined();
  });
});
