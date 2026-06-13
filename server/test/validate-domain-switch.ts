#!/usr/bin/env ts-node
// ============================================================================
// Domain Switch Validation Script — OracleSentinel
// ============================================================================
//
// Usage:
//   npx ts-node server/test/validate-domain-switch.ts
//   npx ts-node server/test/validate-domain-switch.ts --push
//
// This script validates that a domain switch (e.g. immobilier → garage) was
// performed correctly and that the full pipeline (prompts, qualification,
// CRM transport, notes) is operational.
//
// Exit codes:
//   0 = all checks passed
//   1 = at least one critical check failed
//   2 = warnings only (non-blocking)
//
// ============================================================================

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(__dirname, "../.env") });

// ---------------------------------------------------------------------------
// Types & Helpers
// ---------------------------------------------------------------------------

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

const results: CheckResult[] = [];
const LIVE_PUSH = process.argv.includes("--push");

function record(
  id: string,
  label: string,
  status: CheckStatus,
  message: string,
  fix?: string
): void {
  results.push({ id, label, status, message, fix });
  const icon =
    status === "PASS"
      ? "✅"
      : status === "FAIL"
        ? "❌"
        : status === "WARN"
          ? "⚠️"
          : "⏭️";
  console.log(`  ${icon} [${id}] ${label}: ${message}`);
  if (fix && status !== "PASS") {
    console.log(`     └─ FIX: ${fix}`);
  }
}

function maskValue(value: string, showLast: number = 4): string {
  if (!value || value.length < showLast + 4) return "****";
  return `****${value.slice(-showLast)}`;
}

// ---------------------------------------------------------------------------
// Phase 1: Environment Variables
// ---------------------------------------------------------------------------

function checkEnvVariables(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 1: Environment Variables                       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 1.1 BOT_DOMAIN
  const botDomain = (process.env.BOT_DOMAIN || "").trim().toLowerCase();
  if (!botDomain) {
    record(
      "ENV-1",
      "BOT_DOMAIN",
      "FAIL",
      "BOT_DOMAIN is not set — will default to 'immobilier'",
      "Add BOT_DOMAIN=garage (or your domain) to server/.env"
    );
  } else if (["immobilier", "immo", "garage", "automobile", "auto", "generic"].includes(botDomain)) {
    record("ENV-1", "BOT_DOMAIN", "PASS", `BOT_DOMAIN=${botDomain}`);
  } else {
    record(
      "ENV-1",
      "BOT_DOMAIN",
      "WARN",
      `BOT_DOMAIN='${botDomain}' is not a built-in domain`,
      "Ensure a matching domain contract exists in qualification.service.ts"
    );
  }

  // 1.2 CRM_PROVIDER
  const crmProvider = (process.env.CRM_PROVIDER || "").trim().toLowerCase();
  if (!crmProvider || crmProvider === "none") {
    record(
      "ENV-2",
      "CRM_PROVIDER",
      "FAIL",
      `CRM_PROVIDER='${crmProvider || "(empty)"}' — CRM is DISABLED. No data will reach Twenty!`,
      "Set CRM_PROVIDER=twenty in server/.env (Bug P0 #2)"
    );
  } else if (crmProvider === "twenty") {
    record("ENV-2", "CRM_PROVIDER", "PASS", "CRM_PROVIDER=twenty");
  } else if (crmProvider === "airtable") {
    record("ENV-2", "CRM_PROVIDER", "PASS", "CRM_PROVIDER=airtable");
  } else {
    record(
      "ENV-2",
      "CRM_PROVIDER",
      "FAIL",
      `CRM_PROVIDER='${crmProvider}' is not a valid provider`,
      "Valid values: twenty, airtable, none"
    );
  }

  // 1.3 TWENTY_API_URL (only if provider=twenty)
  if (crmProvider === "twenty") {
    const apiUrl = (process.env.TWENTY_API_URL || "").trim();
    if (!apiUrl) {
      record(
        "ENV-3",
        "TWENTY_API_URL",
        "FAIL",
        "TWENTY_API_URL is not set",
        "Set TWENTY_API_URL=https://your-twenty-instance.com in server/.env"
      );
    } else if (!apiUrl.startsWith("http")) {
      record(
        "ENV-3",
        "TWENTY_API_URL",
        "FAIL",
        `TWENTY_API_URL='${apiUrl}' doesn't start with http`,
        "Must be a full URL like https://api.twenty.com"
      );
    } else {
      record("ENV-3", "TWENTY_API_URL", "PASS", `URL: ${apiUrl}`);

      // Check for cloud vs self-hosted mismatch
      if (apiUrl.includes("api.twenty.com")) {
        const apiKey = process.env.TWENTY_API_KEY || "";
        try {
          const parts = apiKey.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
            if (payload.workspaceId) {
              record(
                "ENV-3b",
                "TWENTY_URL_MISMATCH",
                "WARN",
                "API key contains workspaceId but URL points to cloud (api.twenty.com)",
                "If self-hosted, update TWENTY_API_URL to your domain"
              );
            }
          }
        } catch {
          // Not a JWT, skip check
        }
      }
    }

    // 1.4 TWENTY_API_KEY
    const apiKey = (process.env.TWENTY_API_KEY || "").trim();
    if (!apiKey) {
      record(
        "ENV-4",
        "TWENTY_API_KEY",
        "FAIL",
        "TWENTY_API_KEY is not set",
        "Generate an API key in Twenty: Settings > API & Webhooks"
      );
    } else if (apiKey.length < 20) {
      record(
        "ENV-4",
        "TWENTY_API_KEY",
        "FAIL",
        `API key too short (${apiKey.length} chars)`,
        "Regenerate in Twenty: Settings > API & Webhooks"
      );
    } else if (["undefined", "null", "YOUR_API_KEY", "sk-proj-"].some((p) => apiKey.startsWith(p))) {
      record(
        "ENV-4",
        "TWENTY_API_KEY",
        "FAIL",
        "API key is a placeholder value",
        "Set the real API key from Twenty"
      );
    } else {
      record("ENV-4", "TWENTY_API_KEY", "PASS", `Key loaded (${apiKey.length} chars, ends: ${maskValue(apiKey)})`);

      // Check JWT expiry
      try {
        const parts = apiKey.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
          if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            if (expDate < new Date()) {
              record(
                "ENV-4b",
                "TWENTY_KEY_EXPIRY",
                "FAIL",
                `JWT EXPIRED on ${expDate.toISOString()}`,
                "Regenerate the API key in Twenty settings"
              );
            } else {
              const daysLeft = Math.floor((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (daysLeft < 7) {
                record("ENV-4b", "TWENTY_KEY_EXPIRY", "WARN", `JWT expires in ${daysLeft} days (${expDate.toISOString()})`);
              } else {
                record("ENV-4b", "TWENTY_KEY_EXPIRY", "PASS", `JWT valid, expires ${expDate.toISOString()}`);
              }
            }
          }
        }
      } catch {
        record("ENV-4b", "TWENTY_KEY_EXPIRY", "WARN", "API key is not a JWT (simple token)");
      }
    }

    // 1.5 TWENTY_ENABLED
    const twentyEnabled = (process.env.TWENTY_ENABLED || "").trim().toLowerCase();
    if (twentyEnabled === "false") {
      record(
        "ENV-5",
        "TWENTY_ENABLED",
        "FAIL",
        "TWENTY_ENABLED=false — Twenty connector is disabled",
        "Set TWENTY_ENABLED=true in server/.env"
      );
    } else {
      record("ENV-5", "TWENTY_ENABLED", "PASS", `TWENTY_ENABLED=${twentyEnabled || "(default: true)"}`);
    }

    // 1.6 TWENTY_CUSTOM_FIELDS
    const customFields = (process.env.TWENTY_CUSTOM_FIELDS || "").trim().toLowerCase();
    if (customFields !== "true" && customFields !== "1") {
      record(
        "ENV-6",
        "TWENTY_CUSTOM_FIELDS",
        "WARN",
        `TWENTY_CUSTOM_FIELDS='${customFields || "(empty)"}' — custom fields (externalId, source, score, level) will NOT be written`,
        "Set TWENTY_CUSTOM_FIELDS=true if you created these fields in Twenty"
      );
    } else {
      record("ENV-6", "TWENTY_CUSTOM_FIELDS", "PASS", "Custom fields enabled");
    }
  }

  // 1.7 CRM_MIN_PUSH_SCORE
  const minScoreRaw = process.env.CRM_MIN_PUSH_SCORE || process.env.AIRTABLE_MIN_SCORE || "60";
  const minScore = parseInt(minScoreRaw, 10);
  if (isNaN(minScore) || minScore < 0 || minScore > 100) {
    record(
      "ENV-7",
      "CRM_MIN_PUSH_SCORE",
      "FAIL",
      `Invalid value: '${minScoreRaw}'`,
      "Set CRM_MIN_PUSH_SCORE to a number between 0-100 (default: 60)"
    );
  } else if (minScore > 80) {
    record(
      "ENV-7",
      "CRM_MIN_PUSH_SCORE",
      "WARN",
      `CRM_MIN_PUSH_SCORE=${minScore} — very high threshold, most leads will be skipped`,
      "Consider lowering to 60 for broader capture"
    );
  } else {
    record("ENV-7", "CRM_MIN_PUSH_SCORE", "PASS", `Min push score: ${minScore}`);
  }

  // 1.8 Check for .env file existence
  const envPath = path.join(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    record(
      "ENV-8",
      ".env file",
      "FAIL",
      "server/.env file does not exist",
      "Copy server/.env.example to server/.env and configure it"
    );
  } else {
    record("ENV-8", ".env file", "PASS", "server/.env exists");
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Domain Contract Consistency
// ---------------------------------------------------------------------------

function checkDomainConsistency(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 2: Domain Contract Consistency                 ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  try {
    // Import QualificationService dynamically
    const { QualificationService } = require("../src/services/qualification.service");
    const domain = QualificationService.getDomain();
    const contract = QualificationService.getContract();

    record("DOM-1", "Domain Resolution", "PASS", `Resolved domain: '${domain}' → contract: '${contract.name}'`);

    // Check required fields exist
    if (!contract.requiredFields || contract.requiredFields.length === 0) {
      record("DOM-2", "Required Fields", "FAIL", "No required fields defined in domain contract");
    } else {
      record(
        "DOM-2",
        "Required Fields",
        "PASS",
        `Fields: [${contract.requiredFields.join(", ")}] (${contract.requiredFields.length} total)`
      );
    }

    // Check scoring rules add up to 100
    const totalScore = Object.values(contract.scoringRules as Record<string, number>).reduce(
      (sum: number, v: number) => sum + v,
      0
    );
    if (totalScore !== 100) {
      record(
        "DOM-3",
        "Scoring Rules",
        "WARN",
        `Scoring rules sum to ${totalScore}, expected 100`,
        "Adjust scoringRules in qualification.service.ts to total 100"
      );
    } else {
      record("DOM-3", "Scoring Rules", "PASS", `Scoring rules sum correctly to ${totalScore}`);
    }

    // Check extraction prompt intro is non-empty
    if (!contract.extractionPromptIntro || contract.extractionPromptIntro.length < 10) {
      record("DOM-4", "Extraction Prompt", "FAIL", "extractionPromptIntro is empty or too short");
    } else {
      record(
        "DOM-4",
        "Extraction Prompt",
        "PASS",
        `Intro: "${contract.extractionPromptIntro.slice(0, 60)}..."`
      );
    }

    // Check typeNormalizer function exists
    if (typeof contract.typeNormalizer !== "function") {
      record("DOM-5", "Type Normalizer", "FAIL", "typeNormalizer is not a function");
    } else {
      record("DOM-5", "Type Normalizer", "PASS", "typeNormalizer function defined");
    }

    // Check questionHints are defined for all required fields
    const missingHints = contract.requiredFields.filter(
      (f: string) => !contract.questionHints[f]
    );
    if (missingHints.length > 0) {
      record(
        "DOM-6",
        "Question Hints",
        "WARN",
        `Missing hints for: [${missingHints.join(", ")}]`,
        "Add questionHints entries in qualification.service.ts"
      );
    } else {
      record("DOM-6", "Question Hints", "PASS", "All required fields have question hints");
    }
  } catch (err: any) {
    record(
      "DOM-1",
      "Domain Import",
      "FAIL",
      `Failed to load QualificationService: ${err.message}`,
      "Check for TypeScript compilation errors in qualification.service.ts"
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Prompt System Consistency
// ---------------------------------------------------------------------------

function checkPromptConsistency(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 3: Prompt System Consistency                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  try {
    const { getSystemPrompt } = require("../src/core/prompts");
    const profile = getSystemPrompt();

    record(
      "PRM-1",
      "Prompt Router",
      "PASS",
      `Domain ID: ${profile.domainId}, Name: ${profile.domainName}`
    );

    // Check prompt contains key placeholders
    if (!profile.systemPrompt.includes("{DYNAMIC_VARIABLES}")) {
      record(
        "PRM-2",
        "Dynamic Variables",
        "FAIL",
        "System prompt missing {DYNAMIC_VARIABLES} placeholder",
        "Add {DYNAMIC_VARIABLES} to the prompt template in prompts.ts"
      );
    } else {
      record("PRM-2", "Dynamic Variables", "PASS", "{DYNAMIC_VARIABLES} placeholder present");
    }

    if (!profile.systemPrompt.includes("{CHAT_TURN_HINT}")) {
      record(
        "PRM-3",
        "Chat Turn Hint",
        "FAIL",
        "System prompt missing {CHAT_TURN_HINT} placeholder",
        "Add {CHAT_TURN_HINT} to the prompt template in prompts.ts"
      );
    } else {
      record("PRM-3", "Chat Turn Hint", "PASS", "{CHAT_TURN_HINT} placeholder present");
    }

    // Check anti-hallucination rules are present
    if (!profile.systemPrompt.includes("ÉTAT QUALIFICATION")) {
      record(
        "PRM-4",
        "Anti-Hallucination",
        "WARN",
        "System prompt doesn't reference 'ÉTAT QUALIFICATION'",
        "Ensure anti-hallucination rules reference qualification state injection"
      );
    } else {
      record("PRM-4", "Anti-Hallucination", "PASS", "ÉTAT QUALIFICATION referenced in prompt");
    }

    // Check prompt length is reasonable
    if (profile.systemPrompt.length < 500) {
      record("PRM-5", "Prompt Length", "WARN", `Prompt very short (${profile.systemPrompt.length} chars)`);
    } else if (profile.systemPrompt.length > 10000) {
      record("PRM-5", "Prompt Length", "WARN", `Prompt very long (${profile.systemPrompt.length} chars) — may affect LLM performance`);
    } else {
      record("PRM-5", "Prompt Length", "PASS", `Prompt length: ${profile.systemPrompt.length} chars`);
    }

    // Cross-check: domain from prompts.ts matches domain from qualification.service.ts
    try {
      const { QualificationService } = require("../src/services/qualification.service");
      const qualDomain = QualificationService.getDomain();
      if (profile.domainId !== qualDomain) {
        record(
          "PRM-6",
          "Domain Cross-Check",
          "FAIL",
          `prompts.ts resolved '${profile.domainId}' but qualification.service.ts resolved '${qualDomain}'`,
          "Ensure getDomainFromEnv() in prompts.ts and getDomain() in qualification.service.ts use the same logic"
        );
      } else {
        record("PRM-6", "Domain Cross-Check", "PASS", `Both resolve to '${profile.domainId}' ✓`);
      }
    } catch {
      record("PRM-6", "Domain Cross-Check", "SKIP", "Could not import QualificationService");
    }
  } catch (err: any) {
    record(
      "PRM-1",
      "Prompt Import",
      "FAIL",
      `Failed to load prompts: ${err.message}`,
      "Check for TypeScript compilation errors in prompts.ts"
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 4: CRM Connectivity
// ---------------------------------------------------------------------------

async function checkCRMConnectivity(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 4: CRM Connectivity                            ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const provider = (process.env.CRM_PROVIDER || "none").trim().toLowerCase();

  if (provider === "none") {
    record(
      "CRM-1",
      "Provider",
      "FAIL",
      "CRM_PROVIDER=none — no CRM connection to test",
      "Set CRM_PROVIDER=twenty (or airtable) in server/.env"
    );
    return;
  }

  try {
    const { getCRMConnector, resetCRMConnector } = require("../src/services/crm");
    resetCRMConnector(); // Force fresh instance
    const crm = getCRMConnector();

    record("CRM-1", "Provider", "PASS", `Provider: ${crm.providerName}`);

    // Check isConfigured
    const configured = crm.isConfigured();
    if (!configured) {
      record(
        "CRM-2",
        "Configuration",
        "FAIL",
        "CRM connector reports NOT configured",
        "Check API URL, API key, and enabled flag in server/.env"
      );
      return;
    }
    record("CRM-2", "Configuration", "PASS", "Connector is configured");

    // Test connection
    const connected = await crm.testConnection();
    if (!connected) {
      record(
        "CRM-3",
        "Connection Test",
        "FAIL",
        "Connection test failed — cannot reach CRM",
        "Check TWENTY_API_URL and TWENTY_API_KEY (run: npx ts-node test/diagnose-twenty.ts)"
      );
      return;
    }
    record("CRM-3", "Connection Test", "PASS", "Connection to CRM is alive");

    // Test schema discovery (Twenty only)
    if (provider === "twenty" && typeof (crm as any).discoverSchema === "function") {
      try {
        const schema = await (crm as any).discoverSchema();
        if (schema && schema.objects && schema.objects.length > 0) {
          const personObj = schema.objects.find((o: any) => o.nameSingular === "person");
          if (personObj) {
            const customFieldNames = personObj.fields
              .filter((f: any) => f.isCustom)
              .map((f: any) => f.name);
            record(
              "CRM-4",
              "Schema Discovery",
              "PASS",
              `Schema OK — ${schema.objects.length} objects, Person has ${personObj.fields.length} fields (${customFieldNames.length} custom)`
            );

            // Check for expected custom fields
            const expectedCustom = ["externalid", "source", "qualificationscore", "qualificationlevel"];
            const customFieldsEnabled =
              (process.env.TWENTY_CUSTOM_FIELDS || "").trim().toLowerCase() === "true";

            if (customFieldsEnabled) {
              const missingCustom = expectedCustom.filter(
                (f) => !customFieldNames.some((n: string) => n.toLowerCase() === f)
              );
              if (missingCustom.length > 0) {
                record(
                  "CRM-5",
                  "Custom Fields",
                  "WARN",
                  `Missing custom fields in schema: [${missingCustom.join(", ")}]`,
                  "Create these fields in Twenty: Settings > Data model > People > Add field"
                );
              } else {
                record("CRM-5", "Custom Fields", "PASS", "All expected custom fields found in schema");
              }
            } else {
              record(
                "CRM-5",
                "Custom Fields",
                "SKIP",
                "TWENTY_CUSTOM_FIELDS not enabled — skipping field check"
              );
            }
          } else {
            record("CRM-4", "Schema Discovery", "WARN", "Schema loaded but 'person' object not found");
          }
        } else {
          record("CRM-4", "Schema Discovery", "WARN", "Schema discovery returned empty");
        }
      } catch (schemaErr: any) {
        record("CRM-4", "Schema Discovery", "WARN", `Schema discovery failed: ${schemaErr.message}`);
      }
    }

    // Live push test (only if --push flag)
    if (LIVE_PUSH) {
      console.log("\n  🔴 LIVE PUSH TEST (--push flag active)\n");

      const testLead = {
        person: {
          externalId: `test-domain-switch-${Date.now()}`,
          firstName: "TestSwitch",
          lastName: "Validation",
          fullName: "TestSwitch Validation",
          phone: `06${Date.now().toString().slice(-8)}`,
          email: `test-switch-${Date.now()}@test.local`,
          qualificationScore: 85,
          qualificationLevel: "HOT" as const,
          source: "CHATBOT" as const,
        },
        projectType: "Test Domain Switch",
        need: "Validation automatique du changement de domaine",
        location: "Test City",
        qualificationScore: 85,
        summary: "Test automatique de changement de domaine — peut être supprimé.",
        notes: `Test domain switch validation\nDomain: ${process.env.BOT_DOMAIN || "unknown"}\nTimestamp: ${new Date().toISOString()}`,
        agentNote: "Lead de test automatique, peut être supprimé.",
        domain: process.env.BOT_DOMAIN || "unknown",
        domainName: "Test Domain",
        missingFields: [],
        sessionId: `test-switch-${Date.now()}`,
      };

      const session = `test-switch-${Date.now()}`;

      try {
        const pushResult = await crm.pushLead(testLead, session);
        if (pushResult.success) {
          record(
            "CRM-6",
            "Live Push",
            "PASS",
            `Lead pushed successfully — recordId: ${pushResult.recordId || "N/A"}`
          );
        } else {
          record(
            "CRM-6",
            "Live Push",
            "FAIL",
            `Push failed: ${pushResult.error || "Unknown error"}`,
            "Check Twenty API logs and permissions"
          );
        }
      } catch (pushErr: any) {
        record(
          "CRM-6",
          "Live Push",
          "FAIL",
          `Push exception: ${pushErr.message}`,
          "Check network connectivity and API credentials"
        );
      }
    } else {
      record("CRM-6", "Live Push", "SKIP", "Add --push flag to test live CRM push");
    }
  } catch (err: any) {
    record(
      "CRM-1",
      "CRM Import",
      "FAIL",
      `Failed to load CRM module: ${err.message}`,
      "Check for compilation errors or missing dependencies"
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Cross-Domain Isolation Check
// ---------------------------------------------------------------------------

function checkIsolation(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 5: Cross-Domain Isolation                      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const botDomain = (process.env.BOT_DOMAIN || "immobilier").toLowerCase().trim();

  // Check that prompts don't leak other domain content
  try {
    const { getSystemPrompt } = require("../src/core/prompts");
    const profile = getSystemPrompt();
    const prompt = profile.systemPrompt.toLowerCase();

    if (botDomain === "garage" || botDomain === "automobile" || botDomain === "auto") {
      // Garage domain: should NOT contain immobilier terms in the MISSION or CHECKLIST sections
      const immoLeaks = [
        "achat immobilier",
        "vente immobilier",
        "conseiller immobilier",
        "agence immobilière",
        "type de projet (achat",
      ];
      const foundLeaks = immoLeaks.filter((term) => prompt.includes(term));
      if (foundLeaks.length > 0) {
        record(
          "ISO-1",
          "Prompt Leak Check",
          "FAIL",
          `Garage prompt contains immobilier terms: [${foundLeaks.join(", ")}]`,
          "Check prompts.ts — the GARAGE_SYSTEM_PROMPT should not reference immobilier concepts"
        );
      } else {
        record("ISO-1", "Prompt Leak Check", "PASS", "No immobilier terms found in garage prompt");
      }
    } else if (botDomain === "immobilier" || botDomain === "immo") {
      // Immobilier domain: should NOT contain garage terms
      const garageLeaks = [
        "mécanicien",
        "atelier mécanique",
        "diagnostic électronique",
        "type d'intervention (entretien",
        "motrio",
      ];
      const foundLeaks = garageLeaks.filter((term) => prompt.includes(term));
      if (foundLeaks.length > 0) {
        record(
          "ISO-1",
          "Prompt Leak Check",
          "FAIL",
          `Immobilier prompt contains garage terms: [${foundLeaks.join(", ")}]`,
          "Check prompts.ts — the IMMOBILIER_SYSTEM_PROMPT should not reference garage concepts"
        );
      } else {
        record("ISO-1", "Prompt Leak Check", "PASS", "No garage terms found in immobilier prompt");
      }
    } else {
      record("ISO-1", "Prompt Leak Check", "SKIP", `Domain '${botDomain}' — no cross-check available`);
    }

    // Check that qualification contract matches prompt domain
    try {
      const { QualificationService } = require("../src/services/qualification.service");
      const contract = QualificationService.getContract();

      // Verify typeEnum makes sense for the domain
      if (botDomain === "garage" || botDomain === "automobile" || botDomain === "auto") {
        if (contract.typeEnum.includes("Achat immobilier")) {
          record(
            "ISO-2",
            "Contract/Prompt Alignment",
            "FAIL",
            "Garage domain contract has immobilier typeEnum values",
            "Check DOMAIN_CONTRACTS.garage.typeEnum in qualification.service.ts"
          );
        } else if (contract.typeEnum.includes("Entretien") || contract.typeEnum.includes("Diagnostic")) {
          record("ISO-2", "Contract/Prompt Alignment", "PASS", "Garage typeEnum values are correct");
        } else {
          record("ISO-2", "Contract/Prompt Alignment", "WARN", `Unexpected typeEnum: '${contract.typeEnum.slice(0, 50)}...'`);
        }
      } else if (botDomain === "immobilier" || botDomain === "immo") {
        if (contract.typeEnum.includes("Entretien")) {
          record(
            "ISO-2",
            "Contract/Prompt Alignment",
            "FAIL",
            "Immobilier domain contract has garage typeEnum values"
          );
        } else if (contract.typeEnum.includes("Achat") || contract.typeEnum.includes("Location")) {
          record("ISO-2", "Contract/Prompt Alignment", "PASS", "Immobilier typeEnum values are correct");
        } else {
          record("ISO-2", "Contract/Prompt Alignment", "WARN", `Unexpected typeEnum: '${contract.typeEnum.slice(0, 50)}...'`);
        }
      } else {
        record("ISO-2", "Contract/Prompt Alignment", "SKIP", `Domain '${botDomain}' — no specific check`);
      }
    } catch (contractErr: any) {
      record("ISO-2", "Contract/Prompt Alignment", "SKIP", `Could not load contract: ${contractErr.message}`);
    }
  } catch (promptErr: any) {
    record("ISO-1", "Prompt Leak Check", "SKIP", `Could not load prompts: ${promptErr.message}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Profile Files Check
// ---------------------------------------------------------------------------

function checkProfileFiles(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PHASE 6: Profile Files                               ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const profilesDir = path.resolve(__dirname, "../../profiles");

  if (!fs.existsSync(profilesDir)) {
    record("PRF-1", "Profiles Directory", "WARN", `Profiles directory not found: ${profilesDir}`);
    return;
  }

  const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith(".json") && f !== "profile-schema.json");
  record("PRF-1", "Profiles Directory", "PASS", `Found ${files.length} profile(s): [${files.join(", ")}]`);

  const botDomain = (process.env.BOT_DOMAIN || "").toLowerCase().trim();
  const domainToProfile: Record<string, string> = {
    immobilier: "immobilier.json",
    immo: "immobilier.json",
    garage: "garage_motrio.json",
    automobile: "garage_motrio.json",
    auto: "garage_motrio.json",
    restaurant: "restaurant.json",
    generic: "generic.json",
  };

  const expectedFile = domainToProfile[botDomain];
  if (expectedFile) {
    if (files.includes(expectedFile)) {
      record("PRF-2", "Matching Profile", "PASS", `Profile '${expectedFile}' exists for domain '${botDomain}'`);

      // Validate profile JSON structure
      try {
        const content = fs.readFileSync(path.join(profilesDir, expectedFile), "utf-8");
        const profile = JSON.parse(content);
        if (profile.domain && profile.branding && profile.qualification) {
          if (profile.domain !== botDomain && !(botDomain === "auto" || botDomain === "automobile")) {
            // Allow garage aliases
            const garageAliases = ["garage", "automobile", "auto"];
            const immoAliases = ["immobilier", "immo"];
            const match =
              (garageAliases.includes(botDomain) && profile.domain === "garage") ||
              (immoAliases.includes(botDomain) && profile.domain === "immobilier");
            if (!match) {
              record(
                "PRF-3",
                "Profile Domain",
                "WARN",
                `Profile domain='${profile.domain}' doesn't match BOT_DOMAIN='${botDomain}'`
              );
            } else {
              record("PRF-3", "Profile Domain", "PASS", `Profile domain='${profile.domain}' matches`);
            }
          } else {
            record("PRF-3", "Profile Domain", "PASS", `Profile domain='${profile.domain}' matches`);
          }
        } else {
          record("PRF-3", "Profile Structure", "WARN", "Profile JSON missing required keys (domain, branding, qualification)");
        }
      } catch (parseErr: any) {
        record("PRF-3", "Profile Parse", "FAIL", `Cannot parse ${expectedFile}: ${parseErr.message}`);
      }
    } else {
      record(
        "PRF-2",
        "Matching Profile",
        "WARN",
        `No profile file '${expectedFile}' for domain '${botDomain}'`,
        "Profile files are optional — domain contract in qualification.service.ts is sufficient"
      );
    }
  } else {
    record("PRF-2", "Matching Profile", "SKIP", `No profile mapping for domain '${botDomain}'`);
  }
}

// ---------------------------------------------------------------------------
// Summary & Main
// ---------------------------------------------------------------------------

function printSummary(): number {
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const warnCount = results.filter((r) => r.status === "WARN").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  VALIDATION SUMMARY                                   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`  ✅ Passed:  ${passCount}`);
  console.log(`  ❌ Failed:  ${failCount}`);
  console.log(`  ⚠️  Warnings: ${warnCount}`);
  console.log(`  ⏭️  Skipped: ${skipCount}`);
  console.log(`  ─────────────────`);
  console.log(`  Total:     ${results.length}`);

  if (failCount > 0) {
    console.log("\n  ❌ CRITICAL FAILURES:\n");
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => {
        console.log(`     [${r.id}] ${r.label}: ${r.message}`);
        if (r.fix) console.log(`        └─ FIX: ${r.fix}`);
      });
  }

  if (warnCount > 0) {
    console.log("\n  ⚠️  WARNINGS:\n");
    results
      .filter((r) => r.status === "WARN")
      .forEach((r) => {
        console.log(`     [${r.id}] ${r.label}: ${r.message}`);
        if (r.fix) console.log(`        └─ FIX: ${r.fix}`);
      });
  }

  if (failCount === 0 && warnCount === 0) {
    console.log("\n  🎉 ALL CHECKS PASSED — domain switch is validated!\n");
  } else if (failCount === 0) {
    console.log("\n  ✅ No critical failures. Warnings should be reviewed.\n");
  } else {
    console.log("\n  🔴 CRITICAL FAILURES DETECTED — fix before deploying.\n");
  }

  // JSON output for automation
  console.log(
    JSON.stringify({
      event: "domain_switch.validation",
      ts: new Date().toISOString(),
      domain: process.env.BOT_DOMAIN || "unknown",
      provider: process.env.CRM_PROVIDER || "unknown",
      passed: passCount,
      failed: failCount,
      warnings: warnCount,
      skipped: skipCount,
      failures: results.filter((r) => r.status === "FAIL").map((r) => r.id),
    })
  );

  return failCount > 0 ? 1 : warnCount > 0 ? 2 : 0;
}

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(56));
  console.log("  DOMAIN SWITCH VALIDATION — OracleSentinel");
  console.log("═".repeat(56));
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Mode: ${LIVE_PUSH ? "FULL (with live CRM push)" : "DRY RUN (add --push for live test)"}`);
  console.log(`  BOT_DOMAIN: ${process.env.BOT_DOMAIN || "(not set)"}`);
  console.log(`  CRM_PROVIDER: ${process.env.CRM_PROVIDER || "(not set)"}`);
  console.log("═".repeat(56));

  // Run all phases
  checkEnvVariables();
  checkDomainConsistency();
  checkPromptConsistency();
  await checkCRMConnectivity();
  checkIsolation();
  checkProfileFiles();

  // Print summary and exit
  const exitCode = printSummary();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal validation error:", err);
  process.exit(1);
});
