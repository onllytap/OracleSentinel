import { LLMService } from "./llm.service";
import { getRuntimeDomain, type RuntimeDomain } from "./domain.service";

// ============================================
// DOMAIN CONFIGURATION
// ============================================

export type DomainType = RuntimeDomain;

export interface DomainContract {
  name: string;
  requiredFields: (keyof ExtractedLeadData)[];
  scoringRules: Record<string, number>;
  extractionPromptIntro: string;
  typeNormalizer: (raw: string) => string | null;
  typeEnum: string;
  besoinLabel: string;
  adresseLabel: string;
  extractionExamples: string;
  questionHints: Record<string, string>;
}

// ============================================
// DOMAIN CONTRACTS
// ============================================

const DOMAIN_CONTRACTS: Record<DomainType, DomainContract> = {
  immobilier: {
    name: "Immobilier",
    requiredFields: [
      "prenom",
      "nom",
      "numero_telephone",
      "type",
      "besoin",
      "adresse",
    ],
    scoringRules: {
      "prenom+nom": 15,
      numero_telephone: 20,
      email: 10,
      type: 15,
      besoin: 15,
      adresse: 15,
      date_rdv: 10,
    },
    extractionPromptIntro:
      "Tu es un extracteur de données EXPERT pour CRM immobilier.",
    typeNormalizer: (raw: string): string | null => {
      const lower = raw.toLowerCase();
      if (
        lower.includes("achat") ||
        lower.includes("acheter") ||
        lower.includes("cherche")
      )
        return "Achat immobilier";
      if (lower.includes("vente") || lower.includes("vendre"))
        return "Vente immobilier";
      if (lower.includes("location") || lower.includes("louer"))
        return "Location";
      return null;
    },
    typeEnum: "Achat immobilier|Vente immobilier|Location",
    besoinLabel: "description du bien recherché (ex: T3, maison, etc.)",
    adresseLabel: "secteur/ville recherché",
    extractionExamples: `EXEMPLES D'EXTRACTION:
Input: "Je m'appelle Jean Dupont, je cherche un T3 aux Sables, 06 12 34 56 78"
Output: {"prenom": "Jean", "nom": "Dupont", "numero_telephone": "0612345678", "type": "Achat immobilier", "besoin": "T3", "adresse": "Les Sables d'Olonne", ...}

Input: "Marie Martin ici, T2 pour location à La Roche, mon tel 0698765432"
Output: {"prenom": "Marie", "nom": "Martin", "numero_telephone": "0698765432", "type": "Location", "besoin": "T2", "adresse": "La Roche", ...}`,
    questionHints: {
      prenom: "demander le prénom",
      nom: "demander le nom de famille",
      type: "demander le type de projet (achat/vente/location)",
      besoin: "demander la description du bien recherché",
      adresse: "demander le secteur ou la ville",
      numero_telephone: "demander le numéro de téléphone",
      date_rdv: "proposer un rendez-vous",
    },
  },

  garage: {
    name: "Garage Automobile",
    requiredFields: [
      "prenom",
      "nom",
      "numero_telephone",
      "type",
      "besoin",
      "adresse",
    ],
    scoringRules: {
      "prenom+nom": 15,
      numero_telephone: 20,
      email: 10,
      type: 15,
      besoin: 15,
      adresse: 15,
      date_rdv: 10,
    },
    extractionPromptIntro:
      "Tu es un extracteur de données EXPERT pour CRM garage automobile / atelier mécanique.",
    typeNormalizer: (raw: string): string | null => {
      const lower = raw.toLowerCase();
      if (
        lower.includes("entretien") ||
        lower.includes("revision") ||
        lower.includes("révision") ||
        lower.includes("vidange")
      )
        return "Entretien";
      if (
        lower.includes("panne") ||
        lower.includes("réparation") ||
        lower.includes("reparation") ||
        lower.includes("casse")
      )
        return "Réparation";
      if (
        lower.includes("diagnostic") ||
        lower.includes("voyant") ||
        lower.includes("controle") ||
        lower.includes("contrôle")
      )
        return "Diagnostic";
      if (lower.includes("pneu") || lower.includes("pneumatique"))
        return "Pneumatiques";
      if (
        lower.includes("carrosserie") ||
        lower.includes("tôle") ||
        lower.includes("peinture")
      )
        return "Carrosserie";
      if (lower.includes("climatisation") || lower.includes("clim"))
        return "Climatisation";
      if (lower.includes("frein")) return "Freinage";
      if (lower.includes("embrayage")) return "Embrayage";
      if (lower.includes("distribution")) return "Distribution";
      if (
        lower.includes("ct") ||
        lower.includes("contrôle technique") ||
        lower.includes("controle technique")
      )
        return "Contrôle technique";
      // Fallback: return the raw value cleaned up if it looks meaningful
      if (raw.trim().length > 2) return raw.trim();
      return null;
    },
    typeEnum:
      "Entretien|Réparation|Diagnostic|Pneumatiques|Carrosserie|Climatisation|Freinage|Embrayage|Distribution|Contrôle technique",
    besoinLabel:
      "description du problème ou de l'intervention souhaitée (ex: vidange, freins qui grincent, voyant moteur, révision 60000km)",
    adresseLabel: "ville/secteur du client (pour localisation atelier)",
    extractionExamples: `EXEMPLES D'EXTRACTION:
Input: "Bonjour, j'ai une Clio 4 diesel 2018, le voyant moteur est allumé et perte de puissance, 06 12 34 56 78, je m'appelle Pierre Durand"
Output: {"prenom": "Pierre", "nom": "Durand", "numero_telephone": "0612345678", "type": "Diagnostic", "besoin": "Voyant moteur allumé + perte de puissance - Clio 4 diesel 2018", "adresse": null, ...}

Input: "Marie Martin, je voudrais faire la vidange de ma 308 à La Roche, 0698765432"
Output: {"prenom": "Marie", "nom": "Martin", "numero_telephone": "0698765432", "type": "Entretien", "besoin": "Vidange - Peugeot 308", "adresse": "La Roche", ...}`,
    questionHints: {
      prenom: "demander le prénom du client",
      nom: "demander le nom de famille",
      type: "demander le type d'intervention (entretien, réparation, diagnostic, etc.)",
      besoin:
        "demander une description du problème ou de l'intervention souhaitée (symptôme, véhicule, kilométrage)",
      adresse: "demander la ville ou le secteur du client",
      numero_telephone: "demander le numéro de téléphone pour le rappel/RDV",
      date_rdv: "proposer un créneau de rendez-vous atelier",
    },
  },

  oraclesentinel: {
    name: "OracleSentinel / TS Industry",
    requiredFields: [
      "prenom",
      "nom",
      "numero_telephone",
      "email",
      "type",
      "besoin",
      "adresse",
    ],
    scoringRules: {
      "prenom+nom": 15,
      numero_telephone: 20,
      email: 15,
      type: 15,
      besoin: 20,
      adresse: 10,
      date_rdv: 5,
    },
    extractionPromptIntro:
      "Tu es un extracteur de données EXPERT pour CRM TS Industry - Cabinet de conseil en Intelligence Artificielle et Automatisation.",
    typeNormalizer: (raw: string): string | null => {
      const lower = raw.toLowerCase();
      if (
        lower.includes("audit") ||
        lower.includes("faisabilité") ||
        lower.includes("diagnostic")
      )
        return "Audit de Faisabilité";
      if (
        lower.includes("architecture") ||
        lower.includes("stratégie") ||
        lower.includes("conception")
      )
        return "Architecture Stratégique";
      if (
        lower.includes("déploiement") ||
        lower.includes("intégration") ||
        lower.includes("implémentation")
      )
        return "Déploiement & Intégration";
      if (
        lower.includes("optimisation") ||
        lower.includes("amélioration") ||
        lower.includes("scale")
      )
        return "Optimisation Continue";
      if (
        lower.includes("automatisation") ||
        lower.includes("automation") ||
        lower.includes("processus")
      )
        return "Automatisation de Processus";
      if (
        lower.includes("crm") ||
        lower.includes("oracle") ||
        lower.includes("système")
      )
        return "CRM OracleSentinel";
      if (
        lower.includes("prospection") ||
        lower.includes("acquisition") ||
        lower.includes("leads")
      )
        return "Acquisition de Leads";
      if (
        lower.includes("seo") ||
        lower.includes("référencement") ||
        lower.includes("contenu")
      )
        return "SEO & Contenu";
      if (lower.includes("formation") || lower.includes("training"))
        return "Formation & Accompagnement";
      // Fallback: return the raw value cleaned up if it looks meaningful
      if (raw.trim().length > 2) return raw.trim();
      return null;
    },
    typeEnum:
      "Audit de Faisabilité|Architecture Stratégique|Déploiement & Intégration|Optimisation Continue|Automatisation de Processus|CRM OracleSentinel|Acquisition de Leads|SEO & Contenu|Formation & Accompagnement",
    besoinLabel:
      "description du projet ou du besoin (ex: automatisation des processus, implémentation CRM, optimisation des ventes)",
    adresseLabel: "ville/secteur ou localisation de l'entreprise",
    extractionExamples: `EXEMPLES D'EXTRACTION:
Input: "Je suis Pierre Durand, PDG de TechSolutions à Paris. Nous avons 50 employés et voulons automatiser notre prospection. Mon tel 06 12 34 56 78, email pierre@techsolutions.fr"
Output: {"prenom": "Pierre", "nom": "Durand", "numero_telephone": "0612345678", "email": "pierre@techsolutions.fr", "type": "Automatisation de Processus", "besoin": "Automatisation de la prospection - TechSolutions, 50 employés", "adresse": "Paris", ...}

Input: "Marie Martin, DG de LogiPro à Lyon. Nous cherchons à déployer OracleSentinel pour centraliser notre CRM. 0698765432, marie@logipro.fr"
Output: {"prenom": "Marie", "nom": "Martin", "numero_telephone": "0698765432", "email": "marie@logipro.fr", "type": "CRM OracleSentinel", "besoin": "Déploiement CRM OracleSentinel - LogiPro", "adresse": "Lyon", ...}`,
    questionHints: {
      prenom: "demander le prénom du contact",
      nom: "demander le nom de famille",
      type: "demander le type de projet (audit, architecture, déploiement, automatisation, CRM, etc.)",
      besoin:
        "demander une description détaillée du besoin ou du projet (taille entreprise, processus actuels, objectifs)",
      adresse: "demander la ville ou le secteur de l'entreprise",
      numero_telephone: "demander le numéro de téléphone",
      email: "demander l'adresse email professionnelle",
      date_rdv: "proposer un audit de faisabilité ou un rendez-vous de découverte",
    },
  },

  generic: {
    name: "Générique",
    requiredFields: [
      "prenom",
      "nom",
      "numero_telephone",
      "type",
      "besoin",
      "adresse",
    ],
    scoringRules: {
      "prenom+nom": 15,
      numero_telephone: 20,
      email: 10,
      type: 15,
      besoin: 15,
      adresse: 15,
      date_rdv: 10,
    },
    extractionPromptIntro: "Tu es un extracteur de données EXPERT pour CRM.",
    typeNormalizer: (raw: string): string | null => {
      if (raw && raw.trim().length > 1) return raw.trim();
      return null;
    },
    typeEnum: "(type de projet/service libre)",
    besoinLabel: "description du besoin ou de la demande",
    adresseLabel: "ville/secteur/adresse",
    extractionExamples: "",
    questionHints: {
      prenom: "demander le prénom",
      nom: "demander le nom de famille",
      type: "demander le type de projet ou service",
      besoin: "demander une description du besoin",
      adresse: "demander la localisation",
      numero_telephone: "demander le numéro de téléphone",
      date_rdv: "proposer un rendez-vous",
    },
  },
};

// ============================================
// TYPES
// ============================================

export interface ExtractedLeadData {
  prenom?: string;
  nom?: string;
  numero_telephone?: string;
  email?: string;
  type?: string;
  besoin?: string;
  adresse?: string;
  date_rdv?: string;
  notes?: string;
  agentNote?: string;
}

export interface QualificationResult {
  leadData: ExtractedLeadData;
  score: number;
  missingFields: string[];
  isComplete: boolean;
  conversationSummary: string;
  notes: string;
  agentNote: string;
}

// ============================================
// QUALIFICATION SERVICE
// ============================================

export class QualificationService {
  // ─── Domain resolution ───────────────────────────────────

  /**
   * Resolve the current domain from the active runtime profile,
   * with BOT_DOMAIN as backward-compatible fallback.
   */
  static getDomain(): DomainType {
    return getRuntimeDomain();
  }

  /**
   * Get the domain contract for the current (or specified) domain.
   */
  static getContract(domain?: DomainType): DomainContract {
    const d = domain || this.getDomain();
    return DOMAIN_CONTRACTS[d] || DOMAIN_CONTRACTS.generic;
  }

  // ─── JSON extraction helpers ─────────────────────────────

  private static extractJsonObject(text: string): any | null {
    const start = text.indexOf("{");
    if (start === -1) return null;

    const candidate = text.slice(start);
    const match = candidate.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : candidate;

    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

  private static extractFieldsBestEffort(text: string): any {
    const getString = (key: string): string | null => {
      const reQuoted = new RegExp(`"${key}"\\s*:\\s*"([^\"\\n\\r]*)`, "i");
      const m1 = text.match(reQuoted);
      if (m1 && typeof m1[1] === "string") return m1[1];

      const reNull = new RegExp(`"${key}"\\s*:\\s*null`, "i");
      if (reNull.test(text)) return null;

      return null;
    };

    const getNumber = (key: string): number | null => {
      const re = new RegExp(`"${key}"\\s*:\\s*(\\d{1,3})`, "i");
      const m = text.match(re);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? n : null;
    };

    return {
      prenom: getString("prenom"),
      nom: getString("nom"),
      numero_telephone: getString("numero_telephone"),
      email: getString("email"),
      type: getString("type"),
      besoin: getString("besoin"),
      adresse: getString("adresse"),
      date_rdv: getString("date_rdv"),
      score: getNumber("score"),
      summary: getString("summary"),
      notes: getString("notes"),
    };
  }

  // ─── Core extraction ─────────────────────────────────────

  /**
   * Extract lead data from conversation using LLM with domain-aware prompt.
   */
  static async extractLeadData(
    conversationHistory: { role: string; content: string }[],
  ): Promise<QualificationResult> {
    const contract = this.getContract();

    const conversationText = conversationHistory
      .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
      .join("\n");

    const extractionPrompt = `${contract.extractionPromptIntro}

CONVERSATION:
${conversationText}

INSTRUCTIONS CRITIQUES:
1. Lis TOUTE la conversation, même si c'est un long pavé
2. Extrais TOUTES les informations présentes, même si elles sont mélangées
3. Si le client donne plusieurs infos d'un coup, extrais-les TOUTES
4. Si un nom complet est donné (ex: "Jean Dupont"), sépare prénom et nom
5. Normalise les numéros de téléphone (garde uniquement les chiffres)
6. Détecte le type de projet même s'il est implicite

EXTRAIS CE JSON (et RIEN d'autre):
{
    "prenom": "prénom du client ou null",
    "nom": "nom de famille ou null",
    "numero_telephone": "numéro sans espaces (ex: 0612345678) ou null",
    "email": "adresse email ou null",
    "type": "${contract.typeEnum} ou null",
    "besoin": "${contract.besoinLabel} ou null",
    "adresse": "${contract.adresseLabel} ou null",
    "date_rdv": "date format YYYY-MM-DD ou null",
    "score": "<entier exact 0-100, voir RÈGLES ci-dessous>",
    "summary": "résumé du projet en 2 phrases max",
    "notes": "<NOTE CRM PROFESSIONNELLE, voir FORMAT ci-dessous>",
    "agentNote": "2-3 lignes MAX, rédigées COMME UN AGENT HUMAIN après avoir parlé au client. Ton naturel et professionnel."
}

═══════════════════════════════════════════════════
RÈGLES DE SCORING (entier EXACT 0-100, PAS d'arrondi en multiples de 5) :
═══════════════════════════════════════════════════
Score = somme pondérée des signaux détectés dans la conversation, clampé entre 0 et 100.

SIGNAUX POSITIFS :
+ Intention explicite d'achat / RDV demandé : +18
+ Timing < 30 jours : +14 ; 1-3 mois : +9 ; >3 mois : +4
+ Budget confirmé : +12 ; budget probable : +6
+ Autorité décisionnaire (c'est l'acheteur/décideur) : +10 ; influenceur : +5
+ Fit clair avec l'offre (besoin = offre) : +12 ; fit partiel : +6
+ Prénom ET Nom fournis : +8
+ Téléphone fourni : +10
+ Email fourni : +4
+ Localisation précise (ville/quartier) : +6
+ Date RDV proposée ou acceptée : +5

SIGNAUX NÉGATIFS :
- Objection bloquante (prix trop élevé, concurrence choisie, pas prioritaire) : -8 à -15 selon gravité
- Information critique manquante (besoin non exprimé) : -4
- Information critique manquante (timing inconnu) : -4
- Information critique manquante (budget inconnu) : -4

IMPORTANT : Le score DOIT être un entier EXACT (exemples valides: 23, 26, 47, 63, 78).
Les valeurs comme 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95 sont INTERDITES sauf si le calcul tombe exactement dessus.

═══════════════════════════════════════════════════
FORMAT DE LA NOTE CRM (champ "notes") :
═══════════════════════════════════════════════════
Rédige une note professionnelle en français (2 à 6 lignes), exploitable par un commercial.
Contenu obligatoire (si disponible dans la conversation) :
- Ligne 1 : Besoin principal et contexte du client
- Ligne 2 : Timing / urgence
- Ligne 3 : Budget si mentionné
- Ligne 4 : Objections ou risques identifiés
- Ligne 5-6 : Prochaine étape recommandée

INTERDITS : contenu vide, généralités vagues, inventions non présentes dans la conversation.
Si aucune info contextuelle n'est disponible, écrire exactement :
"Premier contact — à qualifier lors du prochain échange."

${contract.extractionExamples}

Réponds UNIQUEMENT avec le JSON, sans markdown ni explication.`;

    try {
      const response = await LLMService.generateResponse(
        [{ role: "user", content: extractionPrompt }],
        "Tu es un extracteur JSON EXPERT. Tu dois extraire TOUTES les informations présentes dans la conversation, même si elles sont données en vrac. Réponds uniquement avec du JSON valide.",
        { maxTokens: 400, temperature: 0, topP: 1 },
      );

      const extracted =
        this.extractJsonObject(response) ??
        this.extractFieldsBestEffort(response);
      if (!extracted || typeof extracted !== "object") {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "❌ Failed to extract JSON from LLM response:",
            response,
          );
        } else {
          console.error("❌ Failed to extract JSON from LLM response");
        }
        return this.getEmptyResult();
      }

      // Clean and normalize phone number
      let cleanPhone = extracted.numero_telephone;
      if (cleanPhone) {
        cleanPhone = cleanPhone.replace(/\D/g, "");
        if (cleanPhone.startsWith("33")) {
          cleanPhone = "0" + cleanPhone.substring(2);
        }
      }

      // Normalize type using domain contract
      let normalizedType = extracted.type;
      if (normalizedType) {
        const domainNormalized = contract.typeNormalizer(normalizedType);
        if (domainNormalized) {
          normalizedType = domainNormalized;
        }
      }

      // Build result with cleaned data
      const leadData: ExtractedLeadData = {
        prenom: extracted.prenom?.trim() || undefined,
        nom: extracted.nom?.trim() || undefined,
        numero_telephone: cleanPhone || undefined,
        email: extracted.email?.trim() || undefined,
        type: normalizedType || undefined,
        besoin: extracted.besoin?.trim() || undefined,
        adresse: extracted.adresse?.trim() || undefined,
        date_rdv: extracted.date_rdv || undefined,
        notes: extracted.notes?.trim() || undefined,
      };

      const missingFields = this.getMissingFields(leadData);
      const score =
        typeof extracted.score === "number"
          ? extracted.score
          : this.calculateScore(leadData);

      // Log extraction for debugging
      if (process.env.NODE_ENV !== "production") {
        const collected = Object.entries(leadData)
          .filter(([_, v]) => v != null && v !== "")
          .map(([k, _]) => k);
        console.log("📊 Extraction Result:");
        console.log(`   Domain: ${contract.name}`);
        console.log(`   Collected: [ ${collected.join(", ")} ]`);
        console.log(`   Missing: [ ${missingFields.join(", ")} ]`);
        console.log(`   Score: ${score}`);
      }
      console.log(`📊 Qualification Score: ${score}/100`);
      console.log(
        `📋 Missing fields: ${missingFields.length > 0 ? missingFields.join(", ") : "None"}`,
      );

      return {
        leadData,
        score,
        missingFields,
        isComplete: missingFields.length === 0,
        conversationSummary: extracted.summary || "Conversation en cours",
        notes: extracted.notes || "Premier contact — à qualifier lors du prochain échange.",
        agentNote: extracted.agentNote || "Nouveau contact, à qualifier.",
      };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("❌ Error extracting lead data:", error);
      } else {
        console.error("❌ Error extracting lead data");
      }
      return this.getEmptyResult();
    }
  }

  // ─── Qualification hint for LLM (THE CRITICAL METHOD) ────

  /**
   * Build a qualification-awareness hint to inject into the system prompt
   * BEFORE the LLM generates its response.
   *
   * This is the GUARDRAIL that prevents the bot from confirming
   * appointments when required fields are still missing.
   *
   * Returns null if no hint is needed (all fields collected).
   */
  static buildQualificationHint(
    qualResult: QualificationResult,
  ): string | null {
    const { missingFields, score, leadData } = qualResult;
    const contract = this.getContract();

    // Build collected fields summary
    const collected = Object.entries(leadData)
      .filter(([_, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${v}`);

    // If all required fields are present AND score is high enough, allow confirmation
    if (missingFields.length === 0 && score >= 70) {
      return `

━━━━━━━━━━━━━━━━━━━━━━
🟢 ÉTAT QUALIFICATION (DONNÉES SYSTÈME - NE PAS DIVULGUER AU CLIENT)
━━━━━━━━━━━━━━━━━━━━━━
Score: ${score}/100
Statut: COMPLET ✅
Données collectées: ${collected.join(" | ")}

Tu PEUX maintenant proposer de confirmer un rendez-vous ou résumer le dossier.
`;
    }

    // === CRITICAL GUARDRAIL ===
    // Missing fields exist → FORBID any appointment confirmation

    // Build the list of questions the bot SHOULD ask next
    const nextQuestions = missingFields
      .slice(0, 3) // Max 3 at a time to not overwhelm
      .map((f) => contract.questionHints[f] || `demander ${f}`)
      .join(", ");

    // Friendly labels for missing fields
    const missingLabels = missingFields.map((f) => {
      const labels: Record<string, string> = {
        prenom: "prénom",
        nom: "nom de famille",
        numero_telephone: "téléphone",
        type: "type d'intervention/projet",
        besoin: "description du besoin",
        adresse: "localisation/ville",
        date_rdv: "date de rendez-vous",
        email: "email",
      };
      return labels[f] || f;
    });

    return `

━━━━━━━━━━━━━━━━━━━━━━
🔴 ÉTAT QUALIFICATION (DONNÉES SYSTÈME - NE PAS DIVULGUER AU CLIENT)
━━━━━━━━━━━━━━━━━━━━━━
Score: ${score}/100
Statut: INCOMPLET ❌
Données collectées: ${collected.length > 0 ? collected.join(" | ") : "Aucune"}
Données MANQUANTES: ${missingLabels.join(", ")}

⛔ RÈGLE ABSOLUE — INTERDICTION DE CONFIRMATION DE RDV:
- Tu ne dois JAMAIS dire "rendez-vous confirmé", "nous vous attendons", "c'est noté pour [date]", ou toute phrase qui laisse croire qu'un RDV est pris.
- Tu ne dois JAMAIS annoncer une date/heure de RDV comme validée.
- Tu ne dois JAMAIS dire qu'un dossier est complet.
- Raison: il manque encore ${missingFields.length} information(s) obligatoire(s).

✅ CE QUE TU DOIS FAIRE À LA PLACE:
- Continuer la conversation normalement
- Poser UNE question naturelle pour obtenir l'info manquante la plus importante
- Prochaine(s) question(s) suggérée(s): ${nextQuestions}
- Intègre la question dans le flux naturel de la conversation (ne fais pas un interrogatoire)
━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  // ─── Missing fields (domain-aware) ───────────────────────

  /**
   * Get list of missing required fields based on current domain contract.
   */
  static getMissingFields(data: ExtractedLeadData): string[] {
    const contract = this.getContract();
    return contract.requiredFields.filter((field) => !data[field]);
  }

  // ─── Scoring (domain-aware) ──────────────────────────────

  /**
   * Calculate qualification score based on collected data.
   * Uses weighted signal analysis to produce exact integers (no multiples of 5).
   * This is a FALLBACK — the LLM prompt also computes a score.
   */
  static calculateScore(data: ExtractedLeadData): number {
    let score = 0;

    // Identity signals
    if (data.prenom && data.nom) score += 8;
    else if (data.prenom || data.nom) score += 3;

    // Contact signals
    if (data.numero_telephone) score += 10;
    if (data.email) score += 4;

    // Intent signals (weighted higher for quality)
    if (data.type) score += 12;
    if (data.besoin) {
      // Longer/more detailed besoin = higher fit signal
      const besoinLen = data.besoin.length;
      score += besoinLen > 40 ? 12 : besoinLen > 15 ? 9 : 6;
    }

    // Location signal
    if (data.adresse) {
      const adresseLen = data.adresse.length;
      score += adresseLen > 20 ? 6 : 4;
    }

    // Appointment = strong intent
    if (data.date_rdv) score += 18;

    // Notes context bonus (indicates richer conversation)
    if (data.notes && data.notes.length > 30) score += 3;

    // Penalty for missing critical info
    if (!data.besoin) score -= 4;
    if (!data.numero_telephone && !data.email) score -= 4;

    return Math.min(100, Math.max(0, score));
  }

  // ─── Question hints (domain-aware) ───────────────────────

  /**
   * Get the next question hint based on missing fields.
   * Uses domain-specific question templates.
   */
  static getNextQuestionHint(missingFields: string[]): string {
    const contract = this.getContract();

    if (missingFields.length === 0) {
      return "toutes les informations sont collectées, proposer de confirmer le rendez-vous";
    }

    const hint = contract.questionHints[missingFields[0]];
    return hint || "continuer la conversation";
  }

  // ─── Empty result helper ─────────────────────────────────

  /**
   * Get empty result for error cases.
   */
  private static getEmptyResult(): QualificationResult {
    const contract = this.getContract();
    return {
      leadData: {},
      score: 0,
      missingFields: [...contract.requiredFields],
      isComplete: false,
      conversationSummary: "",
      notes: "",
      agentNote: "",
    };
  }
}
