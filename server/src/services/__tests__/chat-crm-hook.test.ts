import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CdmLead } from "../crm";

// ─────────────────────────────────────────────────────────────────────────
// chat.service → routeQualifiedLead (T6 / R17 — per-tenant CRM routing hook)
//
// We unit-test ONLY the additive routing helper, in ISOLATION. The heavy
// ChatService.processMessage pipeline (LLM, RAG, DB) is NOT exercised here.
// Every dependency of chat.service is mocked so importing the module is
// side-effect free; the helper's collaborators (pushLeadForTenant, appendAudit)
// are the ones we assert against.
//
// Contract under test (the helper NEVER throws):
//   - handled:false ........................ { pushed:false } (caller runs global push)
//   - handled, success:true ................ { pushed:true }  (tenant CRM owns the lead)
//   - handled, clean provider rejection .... audit + { pushed:true }  (tenant CRM owns the lead)
//   - handled, subsystem sentinel error .... audit + { pushed:false } (safety-net fallback)
//   - pushLeadForTenant throws ............. best-effort audit + { pushed:false }
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  pushLeadForTenant: vi.fn(),
  appendAudit: vi.fn(),
  recordUsage: vi.fn(),
  isOverQuota: vi.fn(),
  isTenantServable: vi.fn(),
}));

// ── Wave-1 services: the helper-under-test collaborators ─────────────────────
vi.mock("../tenant-crm.service", () => ({
  pushLeadForTenant: h.pushLeadForTenant,
}));
vi.mock("../audit.service", () => ({
  appendAudit: h.appendAudit,
}));
vi.mock("../billing.service", () => ({
  BILLING_ENABLED: false,
  recordUsage: h.recordUsage,
  isOverQuota: h.isOverQuota,
}));
vi.mock("../tenant.service", () => ({
  isTenantServable: h.isTenantServable,
}));

// ── Inert mocks for the rest of chat.service's import graph (no side effects) ─
vi.mock("../../db/pool", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock("../llm.service", () => ({
  LLMService: { generateResponse: vi.fn() },
}));
vi.mock("../knowledge.service", () => ({
  KnowledgeService: {
    needsKnowledgeLookup: vi.fn(),
    searchKnowledge: vi.fn(),
    buildContext: vi.fn(),
  },
}));
vi.mock("../qualification.service", () => ({
  QualificationService: {
    extractLeadData: vi.fn(),
    buildQualificationHint: vi.fn(),
    getNextQuestionHint: vi.fn(),
  },
}));
vi.mock("../variables.service", () => ({
  VariablesService: { getFormattedContext: vi.fn() },
}));
vi.mock("../airtable.service", () => ({ AirtableService: {} }));
vi.mock("../crm", () => ({ getCRMConnector: vi.fn() }));
vi.mock("../catalog.service", () => ({
  CatalogService: { searchForContext: vi.fn() },
}));
vi.mock("../../core/prompts", () => ({ getSystemPrompt: vi.fn() }));
vi.mock("../tenant-config.service", () => ({
  getEffectiveIdentityPromptBlock: vi.fn(),
}));
vi.mock("../../utils/debug-log", () => ({ debugLog: vi.fn() }));

import { routeQualifiedLead } from "../chat.service";

function makeLead(over: Partial<CdmLead> = {}): CdmLead {
  return {
    person: {
      firstName: "Jean",
      lastName: "Dupont",
      fullName: "Jean Dupont",
      phone: "0612345678",
    },
    projectType: "Achat",
    need: "T3 lumineux",
    location: "Paris",
    qualificationScore: 82,
    summary: "Recherche T3 a Paris",
    notes: "Client motive",
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  // Sensible defaults (restoreMocks wipes implementations between tests).
  h.appendAudit.mockResolvedValue(undefined);
  h.pushLeadForTenant.mockResolvedValue({ handled: false });
});

describe("routeQualifiedLead — per-tenant CRM routing (T6 / R17)", () => {
  it("returns { pushed:false } when the tenant has no usable CRM (handled:false)", async () => {
    h.pushLeadForTenant.mockResolvedValue({ handled: false });

    const out = await routeQualifiedLead("acme", makeLead(), "sess-1");

    // Caller will fall back to the EXISTING global push.
    expect(out).toEqual({ pushed: false });
    expect(h.pushLeadForTenant).toHaveBeenCalledWith(
      "acme",
      expect.any(Object),
      "sess-1",
    );
    expect(h.appendAudit).not.toHaveBeenCalled();
  });

  it("returns { pushed:true } when the tenant CRM handled the push successfully", async () => {
    h.pushLeadForTenant.mockResolvedValue({
      handled: true,
      result: { success: true },
    });

    const out = await routeQualifiedLead("acme", makeLead(), "sess-2");

    expect(out).toEqual({ pushed: true });
    expect(h.appendAudit).not.toHaveBeenCalled();
  });

  it("audits and returns { pushed:true } on a clean provider rejection (handled:true, success:false)", async () => {
    h.pushLeadForTenant.mockResolvedValue({
      handled: true,
      result: { success: false, error: "provider_rejected" },
    });

    const out = await routeQualifiedLead("acme", makeLead(), "sess-3");

    // Tenant CRM owns this lead → the global push must NOT also run.
    expect(out).toEqual({ pushed: true });
    expect(h.appendAudit).toHaveBeenCalledTimes(1);
    expect(h.appendAudit.mock.calls[0][0]).toMatchObject({
      actor: "system",
      action: "crm.push_fail",
      targetType: "tenant",
      targetId: "acme",
      meta: { error: "provider_rejected" },
    });
  });

  it("audits and falls back to the global push on a tenant-CRM subsystem failure", async () => {
    // pushLeadForTenant swallows internal errors into this documented sentinel.
    h.pushLeadForTenant.mockResolvedValue({
      handled: true,
      result: { success: false, error: "tenant_crm_push_failed" },
    });

    const out = await routeQualifiedLead("acme", makeLead(), "sess-4");

    // Safety net: caller runs the EXISTING global push so the lead is not lost.
    expect(out).toEqual({ pushed: false });
    expect(h.appendAudit).toHaveBeenCalledTimes(1);
    expect(h.appendAudit.mock.calls[0][0]).toMatchObject({
      action: "crm.push_fail",
      targetId: "acme",
      meta: { error: "tenant_crm_push_failed" },
    });
  });

  it("never throws and falls back to the global push when pushLeadForTenant throws", async () => {
    h.pushLeadForTenant.mockRejectedValue(new Error("unexpected boom"));

    const out = await routeQualifiedLead("acme", makeLead(), "sess-5");

    expect(out).toEqual({ pushed: false });
    // Best-effort audit of the unexpected failure.
    expect(h.appendAudit).toHaveBeenCalledTimes(1);
    expect(h.appendAudit.mock.calls[0][0]).toMatchObject({
      action: "crm.push_fail",
      targetId: "acme",
    });
  });

  it("does not throw even if appendAudit itself rejects", async () => {
    h.pushLeadForTenant.mockResolvedValue({
      handled: true,
      result: { success: false, error: "provider_rejected" },
    });
    // appendAudit rejecting in the success:false branch must be caught by the
    // helper's outer try/catch → it degrades to the safety-net { pushed:false }.
    h.appendAudit.mockRejectedValue(new Error("audit down"));

    const out = await routeQualifiedLead("acme", makeLead(), "sess-6");

    expect(out).toEqual({ pushed: false });
  });
});
