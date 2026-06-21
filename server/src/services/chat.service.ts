import { pool } from "../db/pool";
import { LLMService } from "./llm.service";
import { KnowledgeService } from "./knowledge.service";
import {
  QualificationService,
  QualificationResult,
} from "./qualification.service";
import { VariablesService } from "./variables.service";
import { AirtableService, LeadData } from "./airtable.service";
import { getCRMConnector, CdmLead } from "./crm";
import { CatalogService } from "./catalog.service";

import { getSystemPrompt } from "../core/prompts";
import { getEffectiveIdentityPromptBlock } from "./tenant-config.service";
import { debugLog } from "../utils/debug-log";

// ─── T6: additive runtime hooks — per-tenant CRM routing, billing/metering,
// serve guard, audit. Each of these Wave-1 services is designed to NEVER throw
// on the chat hot path (or is wrapped at the call site), so the chat always
// degrades gracefully and never 500s. ──────────────────────────────────────
import { pushLeadForTenant } from "./tenant-crm.service";
import { BILLING_ENABLED, recordUsage, isOverQuota } from "./billing.service";
import { isTenantServable } from "./tenant.service";
import { appendAudit } from "./audit.service";

// Response type with RAG and qualification metadata
export interface ChatResponse {
  response: string;
  sessionId: string;
  usedKnowledge: boolean;
  sourcePages?: { title: string; url: string }[];
  suggestedActions?: { type: string; label: string; data?: any }[];
  qualification?: {
    score: number;
    missingFields: string[];
    isComplete: boolean;
    pushedToCRM: boolean;
  };
}

export interface ConversationSummary {
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface LeadFormSubmission {
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  projet: "Achat" | "Vente" | "Location" | "Autre";
  details?: string;
}

// ============================================================================
// T6 — additive runtime hooks (per-tenant CRM routing). Module-level + exported
// so it is unit-testable in isolation (see __tests__/chat-crm-hook.test.ts).
// ============================================================================

/**
 * Documented sentinel returned by `pushLeadForTenant` when the per-tenant CRM
 * SUBSYSTEM itself failed internally (DB read, decryption, or a connector that
 * threw) — as opposed to a clean provider-side rejection. `pushLeadForTenant`
 * swallows internal errors into this value instead of throwing, so this is the
 * signal the spec's "on throw → fall back to the global push as a safety net"
 * intent actually fires on. We therefore treat it like a throw: audit + fall
 * back to the global push so a qualified lead is never dropped.
 */
const TENANT_CRM_SUBSYSTEM_ERROR = "tenant_crm_push_failed";

/**
 * T6 / R17 — Route a qualified lead to the TENANT's own CRM (additive hook).
 * NEVER throws. Decision table:
 *   - handled === false ................. { pushed:false }  → caller runs the EXISTING global push unchanged
 *   - handled, success === true ......... { pushed:true }   → tenant CRM owns the lead; skip the global push
 *   - handled, clean provider rejection . audit + { pushed:true }  → tenant CRM owns the lead; skip the global push
 *   - handled, subsystem sentinel ....... audit + { pushed:false } → safety net: caller falls back to the global push
 *   - unexpected throw .................. best-effort audit + { pushed:false } → safety net: caller falls back to global
 *
 * Dedup is handled downstream by the existing connectors (crm_pushed_leads);
 * no new dedup logic is introduced here.
 */
export async function routeQualifiedLead(
  tenantId: string,
  cdmLead: CdmLead,
  sessionId: string,
): Promise<{ pushed: boolean }> {
  try {
    const { handled, result } = await pushLeadForTenant(
      tenantId,
      cdmLead,
      sessionId,
    );

    // No usable per-tenant CRM → caller keeps the EXISTING global push.
    if (!handled) {
      return { pushed: false };
    }

    // Tenant CRM handled the push but reported a failure.
    if (result?.success === false) {
      await appendAudit({
        actor: "system",
        action: "crm.push_fail",
        targetType: "tenant",
        targetId: tenantId,
        meta: { error: result?.error ?? "unknown" },
      });

      // Subsystem failure (not a clean provider rejection) → fall back to the
      // global push as a safety net so the qualified lead is never dropped.
      if (result?.error === TENANT_CRM_SUBSYSTEM_ERROR) {
        return { pushed: false };
      }

      // Clean provider-side rejection → the tenant CRM owns this lead; do NOT
      // also run the global push.
      return { pushed: true };
    }

    // Tenant CRM handled the push successfully.
    return { pushed: true };
  } catch (err: any) {
    // Safety net: NEVER throw. Best-effort audit, then let the caller run the
    // existing global push (pushed:false).
    try {
      await appendAudit({
        actor: "system",
        action: "crm.push_fail",
        targetType: "tenant",
        targetId: tenantId,
        meta: { error: err?.message ?? "route_qualified_lead_threw" },
      });
    } catch {
      /* audit is best-effort and must never throw here */
    }
    return { pushed: false };
  }
}

export class ChatService {
  static async processMessage(
    sessionId: string,
    userMessage: string,
    tenantId?: string,
  ): Promise<ChatResponse> {
    const effectiveTenantId =
      typeof tenantId === "string" && tenantId.trim()
        ? tenantId.trim()
        : "default";
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const t0 = Date.now();
    debugLog("chat.start", {
      requestId,
      tenantId: effectiveTenantId,
      sessionId,
      userMessage,
    });

    // ─── T6 / R19.4 — Serve guard (FAIL-OPEN) ──────────────────────────────
    // Refuse to serve a tenant that is explicitly suspended/archived, with a
    // deterministic reply and NO LLM call. isTenantServable() is itself
    // fail-open; the extra try/catch is defence-in-depth so an error here can
    // never block the chat (→ continue normally). Placed BEFORE pool.connect()
    // so an early return never leaks a pooled client.
    try {
      if (!(await isTenantServable(effectiveTenantId))) {
        debugLog("chat.serve_guard.blocked", {
          requestId,
          tenantId: effectiveTenantId,
        });
        return {
          response:
            "L'assistant est momentanément indisponible. Merci de réessayer plus tard ou de contacter directement l'agence.",
          sessionId: sessionId,
          usedKnowledge: false,
          sourcePages: undefined,
          suggestedActions: [
            { type: "contact_agent", label: "💬 Contacter un agent" },
          ],
          qualification: {
            score: 0,
            missingFields: [],
            isComplete: false,
            pushedToCRM: false,
          },
        };
      }
    } catch (err: any) {
      // FAIL-OPEN: never block serving on a guard error.
      debugLog("chat.serve_guard.skipped", {
        requestId,
        tenantId: effectiveTenantId,
        error: err?.message,
      });
    }

    // ─── T6 / R18.4 — Paywall (billing quota) ──────────────────────────────
    // When billing is ON and the tenant is over its monthly message quota,
    // return a deterministic reply with NO LLM call. Inert when billing is off
    // (BILLING_ENABLED=false short-circuits before any quota lookup). Any error
    // → continue normally.
    try {
      if (
        BILLING_ENABLED &&
        (await isOverQuota(effectiveTenantId, "message"))
      ) {
        debugLog("chat.paywall.blocked", {
          requestId,
          tenantId: effectiveTenantId,
        });
        return {
          response:
            "La limite d'utilisation de l'assistant a été atteinte pour le moment. Merci de contacter l'agence pour rétablir le service.",
          sessionId: sessionId,
          usedKnowledge: false,
          sourcePages: undefined,
          suggestedActions: [
            { type: "contact_agent", label: "💬 Contacter un agent" },
          ],
          qualification: {
            score: 0,
            missingFields: [],
            isComplete: false,
            pushedToCRM: false,
          },
        };
      }
    } catch (err: any) {
      // Never block the chat on a billing-check error.
      debugLog("chat.paywall.skipped", {
        requestId,
        tenantId: effectiveTenantId,
        error: err?.message,
      });
    }

    const client = await pool.connect();
    try {
      // 1. Upsert Conversation
      const convRes = await client.query(
        `INSERT INTO conversations (tenant_id, session_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [effectiveTenantId, sessionId],
      );
      const conversationId = convRes.rows[0].id;
      debugLog("chat.conversation.upserted", { requestId, conversationId });

      // 2. Save User Message
      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [effectiveTenantId, conversationId, userMessage],
      );

      // 3. Load History
      const maxHistoryMessages = Math.max(
        10,
        Math.min(
          200,
          parseInt(process.env.CHAT_HISTORY_LIMIT || "80", 10) || 80,
        ),
      );
      const historyRes = await client.query(
        `SELECT role, content FROM messages
         WHERE conversation_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC LIMIT $3`,
        [conversationId, effectiveTenantId, maxHistoryMessages],
      );

      const history = historyRes.rows.reverse().map((row) => ({
        role: row.role as "user" | "assistant",
        content: row.content as string,
      }));

      debugLog("chat.history.loaded", {
        requestId,
        conversationId,
        historyCount: history.length,
        maxHistoryMessages,
      });

      const userTurns = history.filter((m) => m.role === "user").length;
      const leadNudgeAfterTurns = Math.max(
        0,
        parseInt(process.env.LEAD_NUDGE_AFTER_TURNS || "25", 10) || 25,
      );

      const wantsHumanOrVisit =
        /\b(visite|visiter|rendez[- ]?vous|rdv|rappeler|rappel|appelez|appeler|t[ée]l[ée]phone|t[ée]l[ée]phoner|contacter|contact|conseiller|agent)\b/i.test(
          userMessage,
        );
      const refusesLead =
        /\b(juste|simplement)\b[\s\S]{0,30}\b(infos?|informations?|renseigne(ment)?s?)\b/i.test(
          userMessage,
        ) ||
        /\b(pas|aucun)\b[\s\S]{0,20}\b(rendez[- ]?vous|rdv|appel|rappel|contact)\b/i.test(
          userMessage,
        );

      const chatTurnHint = wantsHumanOrVisit
        ? `IMPORTANT: Le client exprime une intention de visite/contact. Demande les coordonnées nécessaires (prénom, nom, téléphone) de manière polie et concise avant de proposer un créneau.`
        : !refusesLead &&
          leadNudgeAfterTurns > 0 &&
          userTurns >= leadNudgeAfterTurns
          ? `IMPORTANT: La conversation dure depuis un moment. Propose UNE OPTION (sans insister) pour être rappelé ou planifier une visite. Ne demande PAS prénom/nom/téléphone tant que le client n'a pas confirmé qu'il souhaite être contacté.`
          : "";

      // 4. RAG: Check if knowledge lookup is needed
      let knowledgeContext = "";
      let sourcePages: { title: string; url: string }[] = [];
      const lastAssistantMessage =
        [...history].reverse().find((m) => m.role === "assistant")?.content ||
        "";
      const reversed = [...history].reverse();
      const firstUserIdx = reversed.findIndex((m) => m.role === "user");
      const secondUserIdx =
        firstUserIdx >= 0
          ? reversed.findIndex((m, i) => i > firstUserIdx && m.role === "user")
          : -1;
      const lastUserMessage =
        firstUserIdx >= 0 ? reversed[firstUserIdx].content : "";
      const previousUserMessage =
        secondUserIdx >= 0 ? reversed[secondUserIdx].content : "";
      const initialNeedsLookup =
        KnowledgeService.needsKnowledgeLookup(userMessage);

      const trimmedUser = (userMessage || "").trim();
      const isShortReply = trimmedUser.length > 0 && trimmedUser.length < 10;
      const isYesNo = /^(oui|non|yes|no)$/i.test(trimmedUser);
      const isNumberOnly = /^\d{1,4}([.,]\d+)?$/.test(trimmedUser);
      const lastAskedForCriteria =
        /(surface|m²|m2|pi(è|e)ces|chambres?|budget|€|euros?|confirmer|v(é|e)rif)/i.test(
          lastAssistantMessage,
        );
      const forcedNeedsLookup =
        !initialNeedsLookup &&
        isShortReply &&
        (isYesNo || isNumberOnly) &&
        lastAskedForCriteria;

      const asksForReference = /\b(r(é|e)f(é|e)rence|reference|ref)\b/i.test(
        userMessage,
      );
      const forcedNeedsLookupRef = !initialNeedsLookup && asksForReference;

      const asksForThreeResults =
        !initialNeedsLookup &&
        /\b(3|trois)\b[\s\S]{0,30}\b(r(é|e)sultat|resultat|annonce|bien)s?\b/i.test(
          userMessage,
        );
      const lastAssistantRefsForResults = Array.from(
        new Set(
          Array.from(
            lastAssistantMessage.matchAll(/\b[A-Z]{2,6}\d{3,10}\b/g),
          ).map((m) => m[0]),
        ),
      );
      const forcedNeedsLookupResults =
        asksForThreeResults && lastAssistantRefsForResults.length > 0;

      const lastAssistantAskedFullName =
        /(pr(é|e)nom\s+et\s+nom|prenom\s+et\s+nom|pr(é|e)nom\s+.*\bnom\b|\bnom\b\s+.*pr(é|e)nom)/i.test(
          lastAssistantMessage,
        );
      if (lastAssistantAskedFullName) {
        const normalized = String(userMessage || "")
          .trim()
          .replace(/[’']/g, " ")
          .replace(/[-_/]+/g, " ")
          .replace(/\s+/g, " ")
          .replace(/^[^a-zA-ZÀ-ÿ]+/, "")
          .replace(/[^a-zA-ZÀ-ÿ\s]+$/, "")
          .trim();

        const candidate = normalized
          .replace(/^je\s+m\s+appelle\s+/i, "")
          .replace(/^moi\s+c\s+est\s+/i, "")
          .replace(/^c\s+est\s+/i, "")
          .replace(/^bonjour\s+/i, "")
          .replace(/^bonsoir\s+/i, "")
          .trim();

        const parts = candidate.split(" ").filter(Boolean);
        const looksLikePhone = /\b\d{10}\b/.test(candidate.replace(/\D/g, ""));

        if (!looksLikePhone && parts.length === 1 && parts[0].length >= 2) {
          const aiResponseText = `Merci ${parts[0]}. Pouvez-vous me donner votre nom de famille (pour compléter votre dossier) ?`;
          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
            [effectiveTenantId, conversationId, aiResponseText],
          );

          return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: false,
            sourcePages: undefined,
            suggestedActions: [
              { type: "contact_agent", label: "💬 Contacter un agent" },
            ],
            qualification: {
              score: 0,
              missingFields: ["nom"],
              isComplete: false,
              pushedToCRM: false,
            },
          };
        }
      }

      // If the assistant already cited a reference in the previous message, answer deterministically.
      if (asksForReference) {
        const refsInLastAssistant = Array.from(
          new Set(
            Array.from(
              lastAssistantMessage.matchAll(/\b[A-Z]{2,6}\d{3,10}\b/g),
            ).map((m) => m[0]),
          ),
        );

        if (refsInLastAssistant.length === 1) {
          const aiResponseText = refsInLastAssistant[0];
          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
            [effectiveTenantId, conversationId, aiResponseText],
          );

          debugLog("reference.answer.from_last_assistant", {
            requestId,
            reference: aiResponseText,
          });

          return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: true,
            sourcePages: undefined,
            suggestedActions: [
              { type: "contact_agent", label: "💬 Contacter un agent" },
            ],
            qualification: {
              score: 0,
              missingFields: [],
              isComplete: false,
              pushedToCRM: false,
            },
          };
        }

        if (refsInLastAssistant.length > 1) {
          const aiResponseText = `J'ai plusieurs références possibles : ${refsInLastAssistant.join(", ")}. Laquelle voulez-vous (ou précisez le prix / surface / quartier) ?`;
          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
            [effectiveTenantId, conversationId, aiResponseText],
          );

          debugLog("reference.answer.from_last_assistant", {
            requestId,
            references: refsInLastAssistant,
          });

          return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: true,
            sourcePages: undefined,
            suggestedActions: [
              { type: "contact_agent", label: "💬 Contacter un agent" },
            ],
            qualification: {
              score: 0,
              missingFields: [],
              isComplete: false,
              pushedToCRM: false,
            },
          };
        }
      }

      const needsLookup =
        initialNeedsLookup ||
        forcedNeedsLookup ||
        forcedNeedsLookupRef ||
        forcedNeedsLookupResults;
      debugLog("rag.decision", {
        requestId,
        needsLookup,
        initialNeedsLookup,
        forcedNeedsLookup,
        forcedNeedsLookupRef,
        forcedNeedsLookupResults,
        isShortReply,
        isYesNo,
        isNumberOnly,
      });

      const looksLikeRef =
        /\bref\s*\d{3,10}\b/i.test(userMessage) ||
        /\bref\d{3,10}\b/i.test(userMessage);

      // 5. LLM: Generate response
      // Build base system prompt with variables (DOMAIN-AWARE)
      const domainProfile = getSystemPrompt(); // Uses active profile domain, then BOT_DOMAIN fallback
      debugLog("chat.domain.selected", {
        requestId,
        domainId: domainProfile.domainId,
        domainName: domainProfile.domainName,
      });

      let systemPromptWithVars = domainProfile.systemPrompt.replace(
        "{DYNAMIC_VARIABLES}",
        VariablesService.getFormattedContext(),
      ).replace("{CHAT_TURN_HINT}", chatTurnHint);

      // Per-agency identity/personality override (Command Center, Phase 2 B).
      // Appended AFTER the global prompt so it takes precedence. Returns "" when
      // this tenant has no override → prompt is byte-identical to before.
      // Never throws: a tenant-config issue must never break the chat.
      try {
        const tenantBlock =
          await getEffectiveIdentityPromptBlock(effectiveTenantId);
        if (tenantBlock) {
          systemPromptWithVars += tenantBlock;
          debugLog("chat.tenant.override.applied", {
            requestId,
            tenantId: effectiveTenantId,
            blockChars: tenantBlock.length,
          });
        }
      } catch (err: any) {
        debugLog("chat.tenant.override.skipped", {
          requestId,
          tenantId: effectiveTenantId,
          error: err?.message,
        });
      }

      // Inject qualification awareness: if we have prior history, run a quick
      // qualification check so the LLM knows what data is still missing.
      // This prevents the bot from confirming appointments too early.
      if (userTurns >= 2) {
        try {
          const priorHistory = [
            ...history,
            { role: "user" as const, content: userMessage },
          ];
          const priorQual =
            await QualificationService.extractLeadData(priorHistory);
          const qualHint =
            QualificationService.buildQualificationHint(priorQual);
          if (qualHint) {
            systemPromptWithVars += qualHint;
          }
        } catch (err: any) {
          // CRITICAL: If qualification hint fails, it's a bug that MUST be fixed
          // The LLM will not know what fields are missing and may hallucinate RDV confirmations
          console.error(
            `❌ CRITICAL: buildQualificationHint failed (requestId=${requestId}):`,
            err.message,
          );
          console.error("Stack:", err.stack);
          // Inject explicit warning to LLM to prevent hallucination
          systemPromptWithVars += `\n\n⚠️ SYSTÈME EN MODE DÉGRADÉ: La qualification automatique est temporairement indisponible. NE CONFIRME AUCUN RENDEZ-VOUS. Demande TOUTES les informations (prénom, nom, téléphone, besoin, localisation) avant toute confirmation.`;
        }
      }

      if (needsLookup) {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            "🔍 Knowledge lookup triggered for:",
            userMessage.substring(0, 50),
          );
        } else {
          console.log("🔍 Knowledge lookup triggered");
        }
        const lookupQuery = forcedNeedsLookupRef
          ? previousUserMessage
            ? `${previousUserMessage}\n${userMessage}`
            : userMessage
          : forcedNeedsLookupResults
            ? `${lastAssistantRefsForResults.join(" ")}\n${userMessage}`
            : userMessage;

        debugLog("rag.lookup.query", {
          requestId,
          forcedNeedsLookupRef,
          lookupQuery,
        });

        const chunks = await KnowledgeService.searchKnowledge({
          query: lookupQuery,
          tenantId: effectiveTenantId,
          requestId,
        });

        if (chunks.length > 0) {
          knowledgeContext = KnowledgeService.buildContext(chunks);
          sourcePages = chunks.map((c) => ({ title: c.title, url: c.url }));
          console.log(`📚 Found ${chunks.length} relevant knowledge chunks`);

          debugLog("rag.result", {
            requestId,
            chunksCount: chunks.length,
            sourcePagesCount: sourcePages.length,
            knowledgeContextChars: knowledgeContext.length,
          });

          if (asksForReference) {
            const refs = Array.from(
              knowledgeContext.matchAll(
                /\bR(é|e)f(é|e)rence\s*:\s*([^\s|\n]+)/gi,
              ),
            ).map((m) => m[3]);
            const uniqueRefs = Array.from(
              new Set(refs.map((r) => String(r).trim()).filter(Boolean)),
            );

            debugLog("reference.question", {
              requestId,
              refsFound: uniqueRefs,
              refsCount: uniqueRefs.length,
            });

            // Handle references found in knowledge base
            if (uniqueRefs.length === 1) {
              const refResponseText = uniqueRefs[0];
              await client.query(
                `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
                [effectiveTenantId, conversationId, refResponseText],
              );
              debugLog("reference.answer.from_knowledge", {
                requestId,
                reference: refResponseText,
              });
              return {
                response: refResponseText,
                sessionId: sessionId,
                usedKnowledge: true,
                sourcePages: sourcePages.length > 0 ? sourcePages : undefined,
                suggestedActions: [
                  { type: "contact_agent", label: "💬 Contacter un agent" },
                ],
                qualification: {
                  score: 0,
                  missingFields: [],
                  isComplete: false,
                  pushedToCRM: false,
                },
              };
            }

            if (uniqueRefs.length > 1) {
              const multiRefText = `J'ai plusieurs références possibles : ${uniqueRefs.join(", ")}. Laquelle voulez-vous (ou précisez le prix / surface / quartier) ?`;
              await client.query(
                `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
                [effectiveTenantId, conversationId, multiRefText],
              );
              debugLog("reference.answer.from_knowledge.multiple", {
                requestId,
                references: uniqueRefs,
              });
              return {
                response: multiRefText,
                sessionId: sessionId,
                usedKnowledge: true,
                sourcePages: sourcePages.length > 0 ? sourcePages : undefined,
                suggestedActions: [
                  { type: "contact_agent", label: "💬 Contacter un agent" },
                ],
                qualification: {
                  score: 0,
                  missingFields: [],
                  isComplete: false,
                  pushedToCRM: false,
                },
              };
            }
          } // close if (asksForReference)
        } else if (looksLikeRef) {
          const aiResponseText = `Je ne retrouve pas cette référence dans le catalogue pour l'instant. Pouvez-vous me confirmer la ville ou m'envoyer le lien de l'annonce ?`;

          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
            [effectiveTenantId, conversationId, aiResponseText],
          );

          return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: false,
            sourcePages: undefined,
            suggestedActions: [
              { type: "contact_agent", label: "💬 Contacter un agent" },
            ],
            qualification: {
              score: 0,
              missingFields: [],
              isComplete: false,
              pushedToCRM: false,
            },
          };
        } else {
          // Domain-agnostic missing field check using QualificationService
          const priorForCriteria = [
            ...history,
            { role: "user" as const, content: userMessage },
          ];
          let criteriaQual: QualificationResult | null = null;
          try {
            criteriaQual =
              await QualificationService.extractLeadData(priorForCriteria);
          } catch {
            /* ignore */
          }

          const missing: string[] =
            criteriaQual?.missingFields?.filter(
              (f: string) =>
                ![
                  "prenom",
                  "nom",
                  "numero_telephone",
                  "date_rdv",
                  "email",
                ].includes(f),
            ) || [];

          const aiResponseText =
            missing.length > 0
              ? `Parfait, j'ai bien noté. Pour mieux vous orienter, il me manque quelques infos : ${QualificationService.getNextQuestionHint(missing)}. Pouvez-vous me préciser ?`
              : `Merci, j'ai bien noté toutes les informations. Je vérifie ce que nous avons qui correspond.`;

          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
            [effectiveTenantId, conversationId, aiResponseText],
          );

          return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: false,
            sourcePages: undefined,
            suggestedActions: [
              { type: "contact_agent", label: "💬 Contacter un agent" },
            ],
            qualification: {
              score: 0,
              missingFields: [],
              isComplete: false,
              pushedToCRM: false,
            },
          };
        }
      }

      // 5. Generate AI Response with optional knowledge context
      const enhancedPrompt = knowledgeContext
        ? `${knowledgeContext}\n\n${systemPromptWithVars}`
        : systemPromptWithVars;

      debugLog("llm.prompt.built", {
        requestId,
        needsLookup,
        knowledgeContextChars: knowledgeContext.length,
        systemPromptChars: systemPromptWithVars.length,
        enhancedPromptChars: enhancedPrompt.length,
      });

      const llmT0 = Date.now();
      const aiResponseText = await LLMService.generateResponse(
        history,
        enhancedPrompt,
        { requestId },
      );
      const llmMs = Date.now() - llmT0;

      debugLog("llm.response", {
        requestId,
        llmMs,
        responseChars: aiResponseText.length,
        responsePreview: aiResponseText.slice(0, 180),
      });

      // 6. Save Assistant Message
      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`,
        [effectiveTenantId, conversationId, aiResponseText],
      );

      // 7. QUALIFICATION: Extract lead data and calculate score
      const updatedHistory = [
        ...history,
        { role: "assistant" as const, content: aiResponseText },
      ];
      const qualificationResult =
        await QualificationService.extractLeadData(updatedHistory);

      console.log(`📊 Qualification Score: ${qualificationResult.score}/100`);
      console.log(
        `📋 Missing fields: ${qualificationResult.missingFields.join(", ") || "None"}`,
      );

      // 8. CRM: Push to CRM if lead is complete and score is high enough
      let pushedToCRM = false;
      const minScore = parseInt(
        process.env.CRM_MIN_PUSH_SCORE ||
        process.env.AIRTABLE_MIN_SCORE ||
        "60",
      );

      const wantsEstimate = /\b(estimation|estimer|estime)\b/i.test(
        userMessage,
      );
      const forcedDateRdv = (process.env.FORCE_DATE_RDV || "").trim();

      const guessDateRdv = (): string | undefined => {
        const userTexts = updatedHistory
          .filter((m) => m.role === "user")
          .map((m) => String(m.content || ""))
          .slice(-12);

        const now = new Date();
        const fmt = (d: Date): string => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        };

        const normalize = (s: string): string =>
          s.toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

        const parseDmy = (
          dd: number,
          mm: number,
          yyyy?: number,
        ): Date | null => {
          const year = yyyy ?? now.getFullYear();
          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
          const d = new Date(year, mm - 1, dd);
          if (
            d.getFullYear() !== year ||
            d.getMonth() !== mm - 1 ||
            d.getDate() !== dd
          )
            return null;
          return d;
        };

        const nextDow = (dow: number, forceNextWeek: boolean): Date => {
          const base = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
          );
          const delta = (dow - base.getDay() + 7) % 7;
          const add = forceNextWeek
            ? delta === 0
              ? 7
              : delta + 7
            : delta === 0
              ? 7
              : delta;
          base.setDate(base.getDate() + add);
          return base;
        };

        const dows: Record<string, number> = {
          dimanche: 0,
          lundi: 1,
          mardi: 2,
          mercredi: 3,
          jeudi: 4,
          vendredi: 5,
          samedi: 6,
        };

        for (const raw of [...userTexts].reverse()) {
          const t = normalize(raw);

          const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
          if (iso) {
            const d = parseDmy(Number(iso[3]), Number(iso[2]), Number(iso[1]));
            if (d) return fmt(d);
          }

          const dmy = t.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
          if (dmy) {
            const d = parseDmy(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]));
            if (d) return fmt(d);
          }

          const dmyShort = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
          if (dmyShort) {
            const d = parseDmy(Number(dmyShort[1]), Number(dmyShort[2]));
            if (d) {
              if (d.getTime() < now.getTime())
                d.setFullYear(d.getFullYear() + 1);
              return fmt(d);
            }
          }

          const dowMatch = t.match(
            /\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/,
          );
          if (dowMatch) {
            const dow = dows[dowMatch[1]];
            const forceNextWeek = /\bprochain\b/.test(t);
            return fmt(nextDow(dow, forceNextWeek));
          }
        }

        return undefined;
      };

      if (
        qualificationResult.isComplete &&
        qualificationResult.score >= minScore
      ) {
        const baseNotes = (qualificationResult.notes || "").trim();
        const extractedNotes = (
          qualificationResult.leadData.notes || ""
        ).trim();
        const rawExtractedDateRdv = qualificationResult.leadData.date_rdv;
        const guessedDateRdv = guessDateRdv();

        const normalizeIsoDate = (value: unknown): string | undefined => {
          if (typeof value !== "string") return undefined;
          const v = value.trim();
          if (!v) return undefined;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
          return undefined;
        };

        const extractedDateRdv = normalizeIsoDate(rawExtractedDateRdv);
        const computedDateRdv =
          forcedDateRdv || extractedDateRdv || guessedDateRdv;

        debugLog("airtable.date_rdv.compute", {
          requestId,
          forcedDateRdv: forcedDateRdv || undefined,
          rawExtractedDateRdv: rawExtractedDateRdv || undefined,
          extractedDateRdv: extractedDateRdv || undefined,
          guessedDateRdv: guessedDateRdv || undefined,
          finalDateRdv: computedDateRdv || undefined,
        });

        const refsInConversation = Array.from(
          new Set(
            updatedHistory.flatMap((m) =>
              Array.from(
                String(m.content || "").matchAll(/\bREF\d{3,10}\b/gi),
              ).map((x) => x[0].toUpperCase()),
            ),
          ),
        );

        let propertyNotes = "";
        if (refsInConversation.length > 0) {
          try {
            const properties = await CatalogService.searchForContext({
              tenantId: effectiveTenantId,
              query: refsInConversation.join(" "),
              limit: 3,
              requestId,
            });

            if (properties.length > 0) {
              propertyNotes = properties
                .map((p) => {
                  const price =
                    p.prix != null
                      ? `${p.prix.toLocaleString("fr-FR")} €`
                      : "Prix NC";
                  const surface =
                    p.surface_m2 != null ? `${p.surface_m2}m²` : "Surface NC";
                  const loc = [p.ville, p.code_postal]
                    .filter(Boolean)
                    .join(" ");
                  const url = p.url_annonce ? ` | ${p.url_annonce}` : "";
                  return `${p.id_unique} | ${loc} | ${price} | ${surface}${url}`.trim();
                })
                .join("\n");
            }
          } catch {
            propertyNotes = "";
          }
        }

        // Build CDM lead for multi-provider CRM push
        const fullName =
          `${qualificationResult.leadData.prenom || ""} ${qualificationResult.leadData.nom || ""}`.trim();
        const notesText = [
          baseNotes ||
          extractedNotes ||
          qualificationResult.conversationSummary ||
          "Aucune note particulière",
          propertyNotes,
        ]
          .filter(Boolean)
          .join("\n\n");
        const phoneNumber = qualificationResult.leadData.numero_telephone || "";

        // Compute qualification level from score
        const computeQualificationLevel = (
          score: number,
        ): "COLD" | "WARM" | "HOT" => {
          if (score < 40) return "COLD";
          if (score < 70) return "WARM";
          return "HOT";
        };

        // Compute stable externalId based on PERSON identity (not session)
        // Priority: phone (normalized) > email
        // This allows updates across multiple conversations with same person
        const normalizedPhone = phoneNumber.replace(/\D/g, "").slice(-9);
        const extractedEmail = (qualificationResult.leadData as any).email;
        const stableExternalId = normalizedPhone
          ? `phone-${normalizedPhone}`
          : extractedEmail
            ? `email-${extractedEmail.toLowerCase()}`
            : `session-${sessionId}`; // Fallback only if no phone/email

        const cdmLead: CdmLead = {
          person: {
            // Use stable person identifier (phone > email > sessionId)
            externalId: stableExternalId,
            firstName: qualificationResult.leadData.prenom || "",
            lastName: qualificationResult.leadData.nom || "",
            fullName,
            phone: phoneNumber,
            // Email if extracted from conversation
            email: extractedEmail || undefined,
            // Address/location
            address: qualificationResult.leadData.adresse || undefined,
            // Score and computed level
            qualificationScore: qualificationResult.score,
            qualificationLevel: computeQualificationLevel(
              qualificationResult.score,
            ),
            // Source is always CHATBOT for leads from this chat service
            source: "CHATBOT",
            // CRM notes (mapped to notesExpertise in Twenty)
            notes: notesText,
          },
          projectType: qualificationResult.leadData.type || "Non spécifié",
          need: qualificationResult.leadData.besoin || "",
          location: qualificationResult.leadData.adresse || "",
          appointmentDate: computedDateRdv,
          tags: wantsEstimate ? ["Estimation"] : undefined,
          qualificationScore: qualificationResult.score,
          summary: qualificationResult.conversationSummary,
          notes: notesText,
          // Human-like agent impression note (2-3 lines)
          agentNote: qualificationResult.agentNote,
          // ─── P0-B: Structured note fields ───────────────────────────
          domain: domainProfile.domainId,
          domainName: domainProfile.domainName,
          missingFields: qualificationResult.missingFields,
          sessionId: sessionId,
        };

        // Also keep legacy LeadData for backward compat (old AirtableService still available)
        const leadData: LeadData = {
          prenom: qualificationResult.leadData.prenom || "",
          nom: qualificationResult.leadData.nom || "",
          nom_complet: fullName,
          numero_telephone: phoneNumber,
          type: cdmLead.projectType,
          besoin: cdmLead.need,
          adresse: cdmLead.location,
          date_rdv: computedDateRdv,
          tags: wantsEstimate ? ["Estimation"] : undefined,
          qualification: qualificationResult.score,
          details: qualificationResult.conversationSummary,
          notes: notesText,
        };

        // ─── T6 / R17 — per-tenant CRM routing (additive, never throws) ───
        // Route to the TENANT's own CRM first. When the tenant has no usable
        // CRM (or its subsystem failed) routeQualifiedLead returns pushed:false
        // and we run the EXISTING global push below, byte-for-byte unchanged.
        // When the tenant CRM owns the lead it returns pushed:true and we skip
        // the global push (any failure was already audited).
        const tenantRoute = await routeQualifiedLead(
          effectiveTenantId,
          cdmLead,
          sessionId,
        );

        if (!tenantRoute.pushed) {
        // ===== EXISTING GLOBAL CRM PUSH — logic byte-for-byte unchanged =====
        try {
          const crm = getCRMConnector();
          console.log(
            `🚀 Pushing qualified lead to CRM (${crm.providerName})...`,
          );

          const pushResult = await crm.pushLead(cdmLead, sessionId);
          pushedToCRM = pushResult.success;

          // ✅ Log push result (no more silent failures)
          if (pushedToCRM) {
            console.log(
              `✅ CRM push SUCCESS (${crm.providerName}) — recordId=${pushResult.recordId?.slice(0, 8) || "N/A"}`,
            );
            // Mark conversation as completed
            await client.query(
              `UPDATE conversations SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
              [conversationId, effectiveTenantId],
            );

            // Also save to local leads table
            await client.query(
              `INSERT INTO leads (tenant_id, conversation_id, phone, chat_summary)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT DO NOTHING`,
              [
                effectiveTenantId,
                conversationId,
                phoneNumber,
                qualificationResult.conversationSummary,
              ],
            );
          } else {
            // ❌ Log push failure with reason
            const reason = pushResult.error || "Unknown error";
            const isDuplicate = pushResult.duplicate === true;
            console.warn(
              `⚠️ CRM push FAILED (${crm.providerName}) — reason=${reason}, duplicate=${isDuplicate}`,
            );
          }
        } catch (crmError) {
          console.error(
            "❌ CRM/DB Update Failed (Non-fatal, continuing chat):",
            crmError,
          );
        }
        // ===== END EXISTING GLOBAL CRM PUSH =====
        } else {
          // Tenant CRM owns this lead → reflect it in the response metadata.
          pushedToCRM = true;
        }

        // T6 / R18 — meter the qualified lead (NO-OP when billing is off;
        // recordUsage never throws, the wrap is defence-in-depth).
        try {
          await recordUsage(effectiveTenantId, "lead");
        } catch {
          /* metering must never break the chat */
        }
      } else {
        // Diagnostic logging: explain WHY CRM push was skipped (gating decision)
        const reasons: string[] = [];
        if (!qualificationResult.isComplete) {
          reasons.push(
            `incomplete (missing: ${qualificationResult.missingFields.join(", ")})`,
          );
        }
        if (qualificationResult.score < minScore) {
          reasons.push(
            `score too low (${qualificationResult.score}/${minScore})`,
          );
        }
        console.log(
          `⏸️ CRM push SKIPPED — ${reasons.join(" + ")} [provider=${process.env.CRM_PROVIDER || "none"}, minScore=${minScore}]`,
        );
      }

      // 9. Legacy: Check for email and notify via Slack
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      const emailMatch = userMessage.match(emailRegex);

      if (emailMatch && process.env.SLACK_WEBHOOK_URL) {
        const email = emailMatch[0];
        if (process.env.NODE_ENV !== "production") {
          console.log(`📧 Email detected: ${email}`);
        } else {
          console.log("📧 Email detected");
        }

        try {
          await fetch(process.env.SLACK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🚨 **NOUVEAU LEAD** 🚨\n\n📧 Email: ${email}\n📊 Score: ${qualificationResult.score}/100\n🆔 Session: ${sessionId}`,
            }),
          });
        } catch (error) {
          console.error("❌ Failed to send Slack notification:", error);
        }
      }

      // 10. Determine suggested actions dynamically
      let suggestedActions: { type: string; label: string }[] = [];

      if (wantsHumanOrVisit) {
        suggestedActions = [
          { type: "schedule_visit", label: "📅 Planifier une visite" },
          { type: "request_callback", label: "📞 Être rappelé" },
        ];
      } else if (
        !refusesLead &&
        qualificationResult.isComplete &&
        qualificationResult.score >= 50
      ) {
        // Highly qualified lead -> Push for conversion
        suggestedActions = [
          { type: "schedule_visit", label: "📅 Planifier une visite" },
          { type: "request_estimate", label: "📋 Estimation gratuite" },
        ];
      } else if (
        !refusesLead &&
        leadNudgeAfterTurns > 0 &&
        userTurns >= leadNudgeAfterTurns
      ) {
        // Long conversation -> gentle, optional nudge
        suggestedActions = [
          { type: "request_callback", label: "📞 Être rappelé" },
          { type: "view_properties", label: "🏠 Voir les biens" },
        ];
      } else if (needsLookup && sourcePages.length > 0) {
        // Property info context -> keep it helpful, non-pushy
        suggestedActions = [
          { type: "view_properties", label: "🏠 Voir les biens" },
          { type: "contact_agent", label: "💬 Contacter un agent" },
        ];
      } else {
        // General conversation
        suggestedActions = [
          { type: "view_properties", label: "🏠 Voir nos annonces" },
          { type: "contact_agent", label: "💬 Contacter un agent" },
        ];
      }

      // T6 / R18 — meter the processed message on the normal reply path
      // (NO-OP when billing is off; recordUsage never throws, wrap is
      // defence-in-depth).
      try {
        await recordUsage(effectiveTenantId, "message");
      } catch {
        /* metering must never break the chat */
      }

      return {
        response: aiResponseText,
        sessionId: sessionId,
        usedKnowledge: needsLookup && sourcePages.length > 0,
        sourcePages: sourcePages.length > 0 ? sourcePages : undefined,
        suggestedActions: suggestedActions as any, // Cast to match frontend type
        qualification: {
          score: qualificationResult.score,
          missingFields: qualificationResult.missingFields,
          isComplete: qualificationResult.isComplete,
          pushedToCRM: pushedToCRM,
        },
      };
    } finally {
      debugLog("CHAT_DEBUG.chat.end", { requestId, totalMs: Date.now() - t0 });
      client.release();
    }
  }

  static async listConversations(
    tenantId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<ConversationSummary[]> {
    const client = await pool.connect();
    try {
      const effectiveTenantId =
        typeof tenantId === "string" && tenantId.trim()
          ? tenantId.trim()
          : "default";
      const result = await client.query(
        `SELECT
                    c.session_id,
                    c.status,
                    c.created_at,
                    c.updated_at,
                    m.created_at AS last_message_at,
                    m.content AS last_message_content
                 FROM conversations c
                 LEFT JOIN LATERAL (
                    SELECT created_at, content
                    FROM messages
                    WHERE conversation_id = c.id AND tenant_id = c.tenant_id
                    ORDER BY created_at DESC
                    LIMIT 1
                 ) m ON true
                 WHERE c.tenant_id = $3
                 ORDER BY c.updated_at DESC
                 LIMIT $1 OFFSET $2`,
        [limit, offset, effectiveTenantId],
      );

      return result.rows.map((row) => ({
        sessionId: row.session_id,
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        lastMessageAt: row.last_message_at
          ? new Date(row.last_message_at).toISOString()
          : undefined,
        lastMessagePreview: row.last_message_content
          ? String(row.last_message_content).slice(0, 120)
          : undefined,
      }));
    } finally {
      client.release();
    }
  }

  static async getConversationMessages(
    sessionId: string,
    tenantId: string,
    limit: number = 100,
  ): Promise<ConversationMessage[]> {
    const client = await pool.connect();
    try {
      const effectiveTenantId =
        typeof tenantId === "string" && tenantId.trim()
          ? tenantId.trim()
          : "default";
      const result = await client.query(
        `SELECT m.role, m.content, m.created_at
                 FROM messages m
                 INNER JOIN conversations c ON c.id = m.conversation_id
                 WHERE c.session_id = $1 AND c.tenant_id = $2 AND m.tenant_id = c.tenant_id
                 ORDER BY m.created_at ASC
                 LIMIT $3`,
        [sessionId, effectiveTenantId, limit],
      );

      return result.rows.map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    } finally {
      client.release();
    }
  }

  static async submitLeadForm(
    sessionId: string,
    form: LeadFormSubmission,
    tenantId?: string,
  ): Promise<{ success: boolean; pushedToCRM: boolean; error?: string }> {
    const client = await pool.connect();
    try {
      const effectiveTenantId =
        typeof tenantId === "string" && tenantId.trim()
          ? tenantId.trim()
          : "default";
      const convRes = await client.query(
        `INSERT INTO conversations (tenant_id, session_id)
                 VALUES ($1, $2)
                 ON CONFLICT (tenant_id, session_id) DO UPDATE SET updated_at = NOW()
                 RETURNING id`,
        [effectiveTenantId, sessionId],
      );
      const conversationId = convRes.rows[0].id;

      const userContent = `[FORMULAIRE]
Nom: ${form.prenom} ${form.nom}
Téléphone: ${form.telephone}
Email: ${form.email || ""}
Projet: ${form.projet}
Détails: ${form.details || ""}`;

      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [effectiveTenantId, conversationId, userContent],
      );

      const cdmFormLead: CdmLead = {
        person: {
          firstName: form.prenom,
          lastName: form.nom,
          fullName: `${form.prenom} ${form.nom}`.trim(),
          phone: form.telephone,
          email: form.email,
        },
        projectType: form.projet,
        need: form.details || form.projet,
        location: "Non renseigné",
        qualificationScore: 80,
        summary: `Projet: ${form.projet}\n${form.details || ""}`.trim(),
        notes: "Lead envoyé depuis formulaire",
      };

      const crm = getCRMConnector();
      const pushResult = await crm.pushLead(cdmFormLead, sessionId);
      if (!pushResult.success && pushResult.error === "DUPLICATE_PHONE") {
        return { success: false, pushedToCRM: false, error: "DUPLICATE_PHONE" };
      }
      const pushedToCRM = pushResult.success;

      if (pushedToCRM) {
        await client.query(
          `UPDATE conversations SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
          [conversationId, effectiveTenantId],
        );
      }

      await client.query(
        `INSERT INTO leads (tenant_id, conversation_id, email, phone, chat_summary)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING`,
        [
          effectiveTenantId,
          conversationId,
          form.email || null,
          form.telephone,
          `Formulaire: ${form.projet}`,
        ],
      );

      return { success: true, pushedToCRM };
    } finally {
      client.release();
    }
  }
}
