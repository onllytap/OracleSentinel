import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// QualificationService — lead scoring / extraction (finding F6, target a)
//
// This is the qualification "brain" that gates CRM pushes. These tests LOCK
// the existing behaviour (scoring weights, domain contracts, the anti-RDV
// guardrail and the LLM-extraction parsing) WITHOUT changing it.
//
// All external dependencies are mocked:
//   - ../domain.service (getRuntimeDomain) → controls the active domain
//   - ../llm.service     (LLMService.generateResponse) → no real LLM/network
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  getRuntimeDomain: vi.fn(),
  generateResponse: vi.fn(),
}));

vi.mock("../domain.service", () => ({
  getRuntimeDomain: h.getRuntimeDomain,
}));

vi.mock("../llm.service", () => ({
  LLMService: { generateResponse: h.generateResponse },
}));

import {
  QualificationService,
  type ExtractedLeadData,
  type QualificationResult,
} from "../qualification.service";

beforeEach(() => {
  // Default to the immobilier domain unless a test overrides it.
  h.getRuntimeDomain.mockReturnValue("immobilier");
  // Keep the test output clean; extractLeadData logs verbosely outside prod.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ===========================================================================
// getContract — domain resolution
// ===========================================================================

describe("QualificationService.getContract", () => {
  it("returns the active runtime domain contract by default", () => {
    h.getRuntimeDomain.mockReturnValue("garage");
    expect(QualificationService.getContract().name).toBe("Garage Automobile");
  });

  it("honours an explicit domain argument over the runtime domain", () => {
    h.getRuntimeDomain.mockReturnValue("garage");
    expect(QualificationService.getContract("immobilier").name).toBe(
      "Immobilier",
    );
  });

  it("requires an email field only for the oraclesentinel domain", () => {
    expect(QualificationService.getContract("immobilier").requiredFields).not.toContain(
      "email",
    );
    expect(
      QualificationService.getContract("oraclesentinel").requiredFields,
    ).toContain("email");
  });

  it("normalizes domain-specific project types", () => {
    expect(
      QualificationService.getContract("immobilier").typeNormalizer(
        "je veux acheter",
      ),
    ).toBe("Achat immobilier");
    expect(
      QualificationService.getContract("garage").typeNormalizer(
        "il faut une vidange",
      ),
    ).toBe("Entretien");
  });
});

// ===========================================================================
// calculateScore — weighted signal scoring (domain-independent fallback)
// ===========================================================================

describe("QualificationService.calculateScore", () => {
  it("clamps an empty lead to 0 (missing besoin + missing contact penalties)", () => {
    expect(QualificationService.calculateScore({})).toBe(0);
  });

  it("scales the besoin signal by description length, with a phone present", () => {
    const withBesoin = (len: number): ExtractedLeadData => ({
      numero_telephone: "0612345678",
      besoin: "a".repeat(len),
    });
    // phone (+10) + besoin tier
    expect(QualificationService.calculateScore(withBesoin(10))).toBe(16); // <=15 → +6
    expect(QualificationService.calculateScore(withBesoin(20))).toBe(19); // >15 → +9
    expect(QualificationService.calculateScore(withBesoin(45))).toBe(22); // >40 → +12
  });

  it("sums the documented weighted signals for a rich lead", () => {
    const data: ExtractedLeadData = {
      prenom: "Jean",
      nom: "Dupont",
      numero_telephone: "0612345678",
      email: "jean@dupont.fr",
      type: "Achat immobilier",
      besoin: "a".repeat(45),
      adresse: "a".repeat(25),
      date_rdv: "2026-07-01",
      notes: "a".repeat(31),
    };
    // 8 (nom+prenom) +10 (tel) +4 (email) +12 (type) +12 (besoin>40)
    // +6 (adresse>20) +18 (date_rdv) +3 (notes>30) = 73
    expect(QualificationService.calculateScore(data)).toBe(73);
  });

  it("applies the missing-contact penalty even when intent is present", () => {
    // type (+12) + besoin>15 (+9) - missing phone & email (-4) = 17
    expect(
      QualificationService.calculateScore({
        type: "Achat",
        besoin: "a".repeat(20),
      }),
    ).toBe(17);
  });
});

// ===========================================================================
// getMissingFields / getNextQuestionHint — domain-aware
// ===========================================================================

describe("QualificationService.getMissingFields", () => {
  it("lists every required field for an empty immobilier lead", () => {
    expect(QualificationService.getMissingFields({})).toEqual([
      "prenom",
      "nom",
      "numero_telephone",
      "type",
      "besoin",
      "adresse",
    ]);
  });

  it("returns no missing fields once all required values are present", () => {
    const complete: ExtractedLeadData = {
      prenom: "Jean",
      nom: "Dupont",
      numero_telephone: "0612345678",
      type: "Achat immobilier",
      besoin: "T3",
      adresse: "Paris",
    };
    expect(QualificationService.getMissingFields(complete)).toEqual([]);
  });
});

describe("QualificationService.getNextQuestionHint", () => {
  it("suggests confirming the appointment when nothing is missing", () => {
    expect(QualificationService.getNextQuestionHint([])).toContain(
      "confirmer le rendez-vous",
    );
  });

  it("maps the first missing field to its domain question hint", () => {
    expect(QualificationService.getNextQuestionHint(["prenom"])).toBe(
      "demander le prénom",
    );
  });
});

// ===========================================================================
// buildQualificationHint — the anti-RDV-confirmation guardrail
// ===========================================================================

describe("QualificationService.buildQualificationHint", () => {
  const base = (over: Partial<QualificationResult>): QualificationResult => ({
    leadData: {},
    score: 0,
    missingFields: [],
    isComplete: false,
    conversationSummary: "",
    notes: "",
    agentNote: "",
    ...over,
  });

  it("emits the GREEN hint allowing confirmation when complete and score ≥ 70", () => {
    const hint = QualificationService.buildQualificationHint(
      base({
        missingFields: [],
        score: 80,
        leadData: { prenom: "Jean", nom: "Dupont" },
      }),
    );
    expect(hint).toContain("Statut: COMPLET");
    expect(hint).toContain("Score: 80/100");
    expect(hint).toContain("Tu PEUX maintenant proposer");
  });

  it("emits the RED guardrail forbidding RDV confirmation when fields are missing", () => {
    const hint = QualificationService.buildQualificationHint(
      base({
        missingFields: ["prenom", "nom"],
        score: 20,
        leadData: { numero_telephone: "0612345678" },
      }),
    );
    expect(hint).toContain("Statut: INCOMPLET");
    expect(hint).toContain("INTERDICTION DE CONFIRMATION");
    expect(hint).toContain("Données MANQUANTES:");
    // friendly labels + suggested next questions for the missing fields
    expect(hint).toContain("prénom");
    expect(hint).toContain("nom de famille");
  });
});

// ===========================================================================
// extractLeadData — LLM-backed extraction (LLM fully mocked)
// ===========================================================================

describe("QualificationService.extractLeadData", () => {
  const history = [{ role: "user", content: "Bonjour" }];

  it("parses clean JSON, normalizes the phone and the project type", async () => {
    h.generateResponse.mockResolvedValue(
      JSON.stringify({
        prenom: "  Jean  ",
        nom: "Dupont",
        numero_telephone: "+33 6 12 34 56 78",
        email: "jean@dupont.fr",
        type: "je veux acheter",
        besoin: "T3 lumineux",
        adresse: "Paris",
        date_rdv: "2026-07-01",
        score: 82,
        summary: "Recherche T3",
        notes: "Client motivé",
      }),
    );

    const result = await QualificationService.extractLeadData(history);

    expect(result.leadData.prenom).toBe("Jean"); // trimmed
    expect(result.leadData.numero_telephone).toBe("0612345678"); // +33 → 0, spaces stripped
    expect(result.leadData.type).toBe("Achat immobilier"); // normalized by contract
    expect(result.score).toBe(82); // LLM-provided score is used as-is
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("falls back to calculateScore when the LLM omits a numeric score", async () => {
    h.generateResponse.mockResolvedValue(
      JSON.stringify({
        prenom: "Marie",
        nom: "Martin",
        numero_telephone: "0698765432",
        type: "Location",
        besoin: "a".repeat(20),
        adresse: "a".repeat(25),
      }),
    );

    const result = await QualificationService.extractLeadData(history);

    // prenom+nom 8 + tel 10 + type 12 + besoin>15 9 + adresse>20 6 = 45
    expect(result.score).toBe(45);
  });

  it("recovers fields with the best-effort parser when JSON is malformed", async () => {
    h.generateResponse.mockResolvedValue(
      'Voici: {"prenom": "Marie", "nom": "Martin", "numero_telephone": "0698765432"',
    );

    const result = await QualificationService.extractLeadData(history);

    expect(result.leadData.prenom).toBe("Marie");
    expect(result.leadData.nom).toBe("Martin");
    expect(result.leadData.numero_telephone).toBe("0698765432");
  });

  it("returns a safe empty result when the LLM call throws", async () => {
    h.generateResponse.mockRejectedValue(new Error("LLM unavailable"));

    const result = await QualificationService.extractLeadData(history);

    expect(result.score).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.leadData).toEqual({});
    // every required field of the active domain is reported missing
    expect(result.missingFields).toEqual([
      "prenom",
      "nom",
      "numero_telephone",
      "type",
      "besoin",
      "adresse",
    ]);
  });
});
