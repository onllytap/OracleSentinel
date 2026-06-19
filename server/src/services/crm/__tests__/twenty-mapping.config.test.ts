import { describe, expect, it } from "vitest";
import {
  TWENTY_PEOPLE_MAPPING,
  TWENTY_ENUMS,
  computeQualificationLevel,
  normalizeScoreForTwenty,
  DEFAULT_SOURCE,
  DEFAULT_PHONE_COUNTRY_CODE,
} from "../twenty-mapping.config";

// ─────────────────────────────────────────────────────────────────────────
// Twenty CRM field mapping (finding F6, target d)
//
// This is a PROTECTED production payload contract. These tests LOCK the exact
// CDM → Twenty field names and the score transforms so an accidental change to
// the payload shape is caught immediately. They do NOT change the mapping.
// ─────────────────────────────────────────────────────────────────────────

describe("twenty-mapping.config · computeQualificationLevel", () => {
  it.each([
    [0, "COLD"],
    [39, "COLD"],
    [40, "WARM"],
    [69, "WARM"],
    [70, "HOT"],
    [100, "HOT"],
  ] as const)("maps score %i → %s", (score, level) => {
    expect(computeQualificationLevel(score)).toBe(level);
  });
});

describe("twenty-mapping.config · normalizeScoreForTwenty", () => {
  it("normalizes 0-100 into the 0-1 range Twenty expects", () => {
    expect(normalizeScoreForTwenty(0)).toBe(0);
    expect(normalizeScoreForTwenty(50)).toBe(0.5);
    expect(normalizeScoreForTwenty(100)).toBe(1);
  });

  it("clamps out-of-range scores defensively", () => {
    expect(normalizeScoreForTwenty(150)).toBe(1);
    expect(normalizeScoreForTwenty(-10)).toBe(0);
  });
});

describe("twenty-mapping.config · field contract", () => {
  it("pins the CDM → Twenty People field paths", () => {
    expect(TWENTY_PEOPLE_MAPPING).toMatchObject({
      firstName: "name.firstName",
      lastName: "name.lastName",
      phone: "phones.primaryPhoneNumber",
      phoneCountryCode: "phones.primaryPhoneCountryCode",
      email: "emails.primaryEmail",
      externalId: "externalId",
      qualificationScore: "qualificationScore",
      qualificationLevel: "qualificationLevel",
      source: "source",
      // documented Twenty schema typo — must stay in sync with the CRM
      address: "Adress",
      notes: "notesExpertise",
    });
  });

  it("pins the Twenty select enums and defaults", () => {
    expect(TWENTY_ENUMS.qualificationLevel).toEqual(["COLD", "WARM", "HOT"]);
    expect(TWENTY_ENUMS.source).toEqual([
      "CHATBOT",
      "WEBSITE_FORM",
      "ADS",
      "MANUAL",
    ]);
    expect(DEFAULT_SOURCE).toBe("CHATBOT");
    expect(DEFAULT_PHONE_COUNTRY_CODE).toBe("+33");
  });
});
