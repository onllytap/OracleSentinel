# 🔒 PROMPT ULTIME — CHANGEMENT DE DOMAINE ORACLESENTINEL

> **Classification : DOCUMENT OPÉRATIONNEL CRITIQUE**
> **Version : 1.0**
> **Dernière mise à jour : 2025-07-17**
> **Auteur : Lead AI Architect — OracleSentinel**

---

## 0. PRÉAMBULE — À LIRE AVANT TOUTE ACTION

Ce document est le **guide de référence absolu** pour changer le domaine métier d'un agent OracleSentinel (ex : passer de "garage automobile" à "immobilier", "restaurant", "cabinet médical", etc.).

Il est conçu pour être donné **tel quel** à n'importe quelle IA (Claude, GPT, Gemini, Copilot, Cursor, etc.) comme contexte de travail.

**Règle n°1 : Aucune modification ne doit être faite "au feeling". Chaque changement suit une checklist déterministe.**

---

## 1. ARCHITECTURE — LES 3 COUCHES À COMPRENDRE

Le système repose sur **3 couches strictement séparées**. Un changement de domaine touche les 3, mais de manière différente.

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE A — PERSONNALITÉ / ROLEPLAY                            │
│  Fichier : server/src/core/prompts.ts                          │
│  Rôle : Ton, style, persona, règles de conversation            │
│  ⚠️  NE DÉCIDE JAMAIS d'un RDV. Ne contient AUCUNE logique.   │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE B — QUALIFICATION / SCHÉMA MÉTIER                      │
│  Fichier : server/src/services/qualification.service.ts         │
│  Rôle : Champs requis, scoring, extraction LLM, Domain Contract│
│  ⚠️  C'est la VÉRITÉ MÉTIER. Le LLM ne peut PAS la contredire.│
├─────────────────────────────────────────────────────────────────┤
│  COUCHE C — ORCHESTRATION / DÉCISION                           │
│  Fichier : server/src/services/chat.service.ts                  │
│  Rôle : Construit le prompt, appelle le LLM, push CRM          │
│  ⚠️  NE PAS MODIFIER sauf bug structurel.                      │
└─────────────────────────────────────────────────────────────────┘
```

### Règle fondamentale

> **A (personnalité) ne contrôle JAMAIS B (qualification) ou C (orchestration).**
> **Seul C peut autoriser un RDV, et SEULEMENT si B dit "COMPLET ✅".**

---

## 2. INVENTAIRE COMPLET — FICHIERS À MODIFIER

### 2.1 Fichiers qui DOIVENT changer (obligatoire)

| # | Fichier | Quoi modifier | Couche |
|---|---------|--------------|--------|
| 1 | `server/.env` | `BOT_DOMAIN=<nouveau_domaine>` | Config |
| 2 | `server/.env` | Variables `VAR_*` (adresse, horaires, site, etc.) | Config |
| 3 | `server/src/core/prompts.ts` | System prompt complet (persona, ton, règles) | A |
| 4 | `server/src/services/qualification.service.ts` | Domain Contract (si nouveau domaine) | B |

### 2.2 Fichiers qui NE DOIVENT PAS changer

| Fichier | Raison |
|---------|--------|
| `server/src/services/chat.service.ts` | Orchestration générique, domain-agnostic |
| `server/src/services/llm.service.ts` | Couche LLM pure, aucun lien métier |
| `server/src/services/groq.service.ts` | Provider LLM, aucun lien métier |
| `server/src/services/knowledge.service.ts` | RAG générique |
| `server/src/services/crm/*` | Connecteurs CRM génériques |
| `server/src/controllers/*` | Routes HTTP, aucun lien métier |

### 2.3 Fichiers optionnels

| Fichier | Quand le modifier |
|---------|-------------------|
| `server/src/config/site-config.ts` | Si scraping de catalogue (immobilier, auto occasion) |
| Knowledge base (DB) | Si le nouveau domaine a besoin de contenu RAG |

---

## 3. PROCÉDURE ÉTAPE PAR ÉTAPE

### ÉTAPE 1 — Définir le Domain Contract

**Fichier : `server/src/services/qualification.service.ts`**

Chercher le dictionnaire `DOMAIN_CONTRACTS` et ajouter un nouveau domaine. Voici le template :

```typescript
mon_domaine: {
    name: "Nom Affiché",
    requiredFields: [
      // Les champs OBLIGATOIRES pour qu'un lead soit complet
      // Choisir parmi : prenom, nom, numero_telephone, email, type, besoin, adresse, date_rdv
      "prenom",
      "nom",
      "numero_telephone",
      "type",       // Type de projet/service
      "besoin",     // Description du besoin
      "adresse",    // Localisation
    ],
    scoringRules: {
      // Points attribués par champ collecté (total max = 100)
      "prenom+nom": 15,
      numero_telephone: 20,
      email: 10,
      type: 15,
      besoin: 15,
      adresse: 15,
      date_rdv: 10,
    },
    extractionPromptIntro:
      "Tu es un extracteur de données EXPERT pour CRM [MON DOMAINE].",
    typeNormalizer: (raw: string): string | null => {
      // Fonction qui normalise les types bruts en catégories propres
      const lower = raw.toLowerCase();
      if (lower.includes("mot_clé_1")) return "Catégorie A";
      if (lower.includes("mot_clé_2")) return "Catégorie B";
      if (raw.trim().length > 2) return raw.trim();
      return null;
    },
    typeEnum: "Catégorie A|Catégorie B|Catégorie C",
    besoinLabel: "description du besoin en langage métier",
    adresseLabel: "ville/secteur/zone pertinente",
    extractionExamples: `EXEMPLES D'EXTRACTION:
Input: "exemple de message client typique"
Output: {"prenom": "...", "nom": "...", ...}`,
    questionHints: {
      prenom: "demander le prénom",
      nom: "demander le nom de famille",
      type: "demander le type de [SERVICE/PROJET]",
      besoin: "demander une description du [BESOIN MÉTIER]",
      adresse: "demander la ville / le secteur",
      numero_telephone: "demander le numéro de téléphone",
      date_rdv: "proposer un rendez-vous",
    },
  },
```

### ÉTAPE 2 — Configurer le .env

**Fichier : `server/.env`**

```env
# ━━━ DOMAINE ━━━
BOT_DOMAIN=mon_domaine

# ━━━ VARIABLES DYNAMIQUES (injectées dans le prompt via {DYNAMIC_VARIABLES}) ━━━
VAR_NOM_ENTREPRISE=Mon Entreprise
VAR_ADRESSE=123 Rue Example, 75001 Paris
VAR_TELEPHONE=01 23 45 67 89
VAR_HORAIRES=Lun-Ven 9h-18h, Sam 9h-12h
VAR_SITE_WEB=https://www.mon-entreprise.fr
VAR_EMAIL_CONTACT=contact@mon-entreprise.fr
# Ajouter autant de VAR_* que nécessaire. Elles sont automatiquement
# chargées par VariablesService et injectées dans le system prompt.

# ━━━ SCORING ━━━
AIRTABLE_MIN_SCORE=60
# Score minimum pour push CRM. Recommandé : 60 (WARM+)
# Ne JAMAIS mettre en dessous de 40 en production.
```

### ÉTAPE 3 — Réécrire le System Prompt

**Fichier : `server/src/core/prompts.ts`**

C'est le fichier le plus sensible. Voici les **règles absolues** à respecter :

#### SECTIONS OBLIGATOIRES (ne jamais supprimer)

```
1. 🔒 SÉCURITÉ - RÈGLES ABSOLUES
   → Anti-jailbreak, anti-prompt-injection
   → Adapter la phrase de réponse polie au nouveau domaine
   → Ex: "Je suis l'assistant [NOM]. Comment puis-je vous aider ?"

2. ⛔ RÈGLE ANTI-HALLUCINATION — RENDEZ-VOUS
   → NE JAMAIS SUPPRIMER NI MODIFIER CETTE SECTION
   → C'est le garde-fou qui empêche le LLM de confirmer des RDV
   → Elle référence la section "ÉTAT QUALIFICATION" injectée dynamiquement

3. 🎯 MISSIONS CLÉS
   → Adapter au nouveau métier (comprendre, informer, qualifier, orienter)

4. {CHAT_TURN_HINT}
   → Placeholder OBLIGATOIRE. Remplacé dynamiquement par chat.service.ts
   → Ne JAMAIS le supprimer

5. 🏢 INFOS ENTREPRISE
   → {DYNAMIC_VARIABLES} — Placeholder OBLIGATOIRE
   → Remplacé par les VAR_* du .env

6. 🚫 RÈGLES D'OR (TON & STYLE)
   → Adapter au domaine (concis, pro, pas de blabla)

7. 🔍 UTILISATION DU CONTEXTE (RAG)
   → Adapter au type de contenu RAG du domaine

8. 📞 COLLECTE DE LEADS (CHECKLIST)
   → DOIT correspondre EXACTEMENT aux requiredFields du Domain Contract
   → Si le contract demande [type, besoin, adresse, prenom, nom, tel]
   → La checklist doit lister ces mêmes champs
```

#### PLACEHOLDERS OBLIGATOIRES (ne jamais supprimer)

| Placeholder | Remplacé par | Fichier source |
|------------|-------------|----------------|
| `{DYNAMIC_VARIABLES}` | Variables VAR_* du .env | `variables.service.ts` |
| `{CHAT_TURN_HINT}` | Hint contextuel (nudge lead, intention visite) | `chat.service.ts` |

> **⚠️ ATTENTION :** La section "ÉTAT QUALIFICATION" (🟢 COMPLET ou 🔴 INCOMPLET) est injectée **dynamiquement à la fin du prompt** par `buildQualificationHint()`. Elle n'est PAS dans le fichier `prompts.ts`. Ne pas essayer de la hardcoder.

### ÉTAPE 4 — Redémarrer et tester

```bash
cd server
npm run dev
# ou: npx nodemon src/index.ts
```

---

## 4. EXEMPLES CONCRETS DE DOMAINES

### 4.1 Garage Automobile (actuel)

```
BOT_DOMAIN=garage
```

| Champ | Valeur |
|-------|--------|
| `type` | Entretien, Réparation, Diagnostic, Pneumatiques, Freinage... |
| `besoin` | "Voyant moteur allumé + perte de puissance - Clio 4 diesel 2018" |
| `adresse` | Ville du client |
| Persona | Mécanicien expert Motrio, pédagogue, concis |

### 4.2 Immobilier

```
BOT_DOMAIN=immobilier
```

| Champ | Valeur |
|-------|--------|
| `type` | Achat immobilier, Vente immobilier, Location |
| `besoin` | "T3 centre-ville, balcon, parking" |
| `adresse` | Ville/secteur recherché |
| Persona | Agent immobilier, conseiller, orienté solution |

### 4.3 Restaurant (exemple nouveau domaine)

```
BOT_DOMAIN=restaurant
```

| Champ | Valeur |
|-------|--------|
| `type` | Réservation, Événement privé, Traiteur, Renseignement |
| `besoin` | "Table pour 6, samedi soir, terrasse si possible" |
| `adresse` | Ville du client (pour livraison/traiteur) |
| Persona | Maître d'hôtel virtuel, chaleureux, efficace |

### 4.4 Cabinet Médical (exemple nouveau domaine)

```
BOT_DOMAIN=medical
```

| Champ | Valeur |
|-------|--------|
| `type` | Consultation, Suivi, Urgence, Renouvellement ordonnance |
| `besoin` | "Douleur genou gauche depuis 2 semaines" |
| `adresse` | Ville/quartier du patient |
| Persona | Assistant médical, empathique, prudent ("consulter un médecin") |

---

## 5. ERREURS CRITIQUES À NE JAMAIS FAIRE

### ❌ ERREUR 1 — Modifier le prompt SANS modifier le Domain Contract

**Symptôme :** Le bot parle comme un garagiste mais extrait des données immobilières.
**Cause :** `prompts.ts` dit "garage" mais `qualification.service.ts` a encore `BOT_DOMAIN=immobilier` ou le contract n'existe pas.
**Fix :** TOUJOURS modifier les DEUX fichiers ensemble.

### ❌ ERREUR 2 — Supprimer la section anti-hallucination RDV

**Symptôme :** Le bot confirme des RDV à score 20/100.
**Cause :** La section `⛔ RÈGLE ANTI-HALLUCINATION — RENDEZ-VOUS` a été supprimée du prompt.
**Fix :** Cette section est **NON NÉGOCIABLE**. La remettre immédiatement.

### ❌ ERREUR 3 — Supprimer les placeholders `{DYNAMIC_VARIABLES}` ou `{CHAT_TURN_HINT}`

**Symptôme :** Le bot ne connaît plus l'adresse/les horaires, ou ne nudge plus les leads.
**Cause :** Les placeholders ont été supprimés lors de la réécriture du prompt.
**Fix :** Vérifier que les deux placeholders sont présents dans `prompts.ts`.

### ❌ ERREUR 4 — Mettre AIRTABLE_MIN_SCORE < 40 en production

**Symptôme :** Des leads non qualifiés (juste un prénom) sont pushés au CRM.
**Cause :** Le seuil est trop bas.
**Fix :** Minimum 40, recommandé 60.

### ❌ ERREUR 5 — Hardcoder la logique métier dans chat.service.ts

**Symptôme :** Chaque changement de domaine nécessite de modifier l'orchestrateur.
**Cause :** Des `if (domaine === 'garage')` ou du code métier-spécifique dans chat.service.ts.
**Fix :** Toute la logique métier va dans le Domain Contract + le prompt. L'orchestrateur est GÉNÉRIQUE.

### ❌ ERREUR 6 — Oublier de changer les `VAR_*` dans le .env

**Symptôme :** Le bot dit "Notre atelier Motrio, 45 Promenade..." alors qu'on est un restaurant.
**Cause :** Les variables dynamiques n'ont pas été mises à jour.
**Fix :** Mettre à jour TOUTES les `VAR_*` dans le .env.

### ❌ ERREUR 7 — Créer un Domain Contract avec des requiredFields qui ne matchent pas ExtractedLeadData

**Symptôme :** Erreur TypeScript ou champs jamais collectés.
**Cause :** Le `requiredFields` contient des noms de champs qui n'existent pas dans l'interface `ExtractedLeadData`.
**Fix :** Les seuls champs valides sont : `prenom`, `nom`, `numero_telephone`, `email`, `type`, `besoin`, `adresse`, `date_rdv`.

### ❌ ERREUR 8 — Laisser le catch vide sur buildQualificationHint

**Symptôme :** Le bot confirme des RDV alors que la qualification est incomplète.
**Cause :** Le `try/catch` dans `chat.service.ts` autour de `buildQualificationHint()` avale une erreur silencieusement.
**Fix :** Si `buildQualificationHint` crash, c'est un bug CRITIQUE à corriger. Ne JAMAIS ignorer cette erreur. Vérifier que la méthode existe et retourne bien un string ou null.

---

## 6. CHECKLIST DE VALIDATION POST-CHANGEMENT

Après chaque changement de domaine, vérifier :

```
□ 1. BOT_DOMAIN dans .env correspond au nouveau domaine
□ 2. Le Domain Contract existe dans DOMAIN_CONTRACTS (qualification.service.ts)
□ 3. Les requiredFields du contract sont tous dans ExtractedLeadData
□ 4. Le typeNormalizer couvre les cas métier principaux
□ 5. Les questionHints sont en français et adaptés au domaine
□ 6. Le system prompt (prompts.ts) a été réécrit pour le nouveau domaine
□ 7. La section ⛔ ANTI-HALLUCINATION RDV est présente et intacte
□ 8. {DYNAMIC_VARIABLES} est présent dans le prompt
□ 9. {CHAT_TURN_HINT} est présent dans le prompt
□ 10. La checklist 📞 COLLECTE DE LEADS correspond aux requiredFields
□ 11. Les VAR_* dans .env sont à jour (adresse, horaires, site, etc.)
□ 12. AIRTABLE_MIN_SCORE >= 40
□ 13. Le serveur démarre sans erreur (npm run dev)
□ 14. TypeScript compile sans erreur (npx tsc --noEmit)
□ 15. Test conversation : le bot ne confirme PAS de RDV avant score >= 70
□ 16. Test conversation : le bot pose les bonnes questions métier
□ 17. Test conversation : les logs montrent le bon Domain dans l'extraction
□ 18. Test CRM : un lead complet est correctement pushé
```

---

## 7. PROMPT À DONNER À UNE IA POUR EFFECTUER LE CHANGEMENT

Copier-coller ce bloc tel quel à n'importe quelle IA (Claude, GPT, Cursor, etc.) :

---

> ### 🎯 MISSION : Changer le domaine du chatbot OracleSentinel
>
> **Nouveau domaine :** [ÉCRIRE ICI : ex "restaurant", "cabinet médical", "salon de coiffure"]
> **Nom de l'entreprise :** [ÉCRIRE ICI]
> **Adresse :** [ÉCRIRE ICI]
> **Téléphone :** [ÉCRIRE ICI]
> **Horaires :** [ÉCRIRE ICI]
> **Site web :** [ÉCRIRE ICI]
>
> ### CONTEXTE TECHNIQUE
>
> Le projet est un chatbot Node/TypeScript avec :
> - Un moteur conversationnel (LLM Groq/OpenRouter + mémoire PostgreSQL)
> - Un moteur de qualification (extraction structurée + score 0-100)
> - Un push CRM conditionnel (score >= AIRTABLE_MIN_SCORE + isComplete)
> - Un system prompt avec garde-fous anti-hallucination
>
> ### FICHIERS À MODIFIER (et UNIQUEMENT ceux-là)
>
> 1. **`server/.env`** — Changer `BOT_DOMAIN`, les `VAR_*`, et `AIRTABLE_MIN_SCORE`
> 2. **`server/src/services/qualification.service.ts`** — Ajouter un Domain Contract dans `DOMAIN_CONTRACTS` si le domaine n'existe pas encore. Les domaines existants sont : `immobilier`, `garage`, `generic`.
> 3. **`server/src/core/prompts.ts`** — Réécrire le `SYSTEM_PROMPT` pour le nouveau domaine.
>
> ### RÈGLES ABSOLUES (ZERO TOLÉRANCE)
>
> - **NE JAMAIS** supprimer la section `⛔ RÈGLE ANTI-HALLUCINATION — RENDEZ-VOUS` dans prompts.ts
> - **NE JAMAIS** supprimer les placeholders `{DYNAMIC_VARIABLES}` et `{CHAT_TURN_HINT}`
> - **NE JAMAIS** modifier `chat.service.ts`, `llm.service.ts`, ou `groq.service.ts`
> - **NE JAMAIS** mettre `AIRTABLE_MIN_SCORE` en dessous de 40
> - **NE JAMAIS** inventer des noms de champs dans `requiredFields` — les seuls valides sont : `prenom`, `nom`, `numero_telephone`, `email`, `type`, `besoin`, `adresse`, `date_rdv`
> - La checklist `📞 COLLECTE DE LEADS` dans le prompt DOIT correspondre aux `requiredFields` du Domain Contract
> - Le `typeNormalizer` DOIT couvrir les 5-10 cas métier les plus courants du domaine
> - Les `questionHints` DOIVENT être en français et naturels
> - Les `extractionExamples` DOIVENT contenir 2-3 exemples réalistes du domaine
>
> ### FORMAT DE LIVRAISON
>
> Fournir :
> 1. Le contenu complet du nouveau Domain Contract (à insérer dans `DOMAIN_CONTRACTS`)
> 2. Le contenu complet du nouveau `SYSTEM_PROMPT` (pour prompts.ts)
> 3. Les lignes `.env` à modifier
> 4. Un test conversationnel de 5 messages simulés pour valider le comportement
>
> ### VÉRIFICATION
>
> Après les modifications, vérifier que :
> - `npx tsc --noEmit` ne retourne AUCUNE erreur
> - Le serveur démarre (`npm run dev`)
> - Un message "Bonjour" reçoit une réponse cohérente avec le nouveau domaine
> - Le bot ne confirme PAS de RDV avant que TOUS les requiredFields soient collectés

---

## 8. MÉCANISME INTERNE — COMMENT ÇA MARCHE

Pour comprendre pourquoi ces règles existent, voici le flux exact d'un message :

```
1. Client envoie un message
   │
2. chat.service.ts charge l'historique
   │
3. chat.service.ts construit systemPromptWithVars :
   │  = SYSTEM_PROMPT
   │    .replace("{DYNAMIC_VARIABLES}", variables du .env)
   │    .replace("{CHAT_TURN_HINT}", hint contextuel)
   │
4. SI userTurns >= 2 :
   │  → QualificationService.extractLeadData(historique)
   │  → QualificationService.buildQualificationHint(résultat)
   │  → Le hint est CONCATÉNÉ au system prompt
   │  → Le LLM reçoit "ÉTAT QUALIFICATION: INCOMPLET ❌ / manque: X, Y, Z"
   │  → Le LLM est INTERDIT de confirmer un RDV
   │
5. LLM génère sa réponse (avec le prompt enrichi)
   │
6. La réponse est sauvegardée en DB
   │
7. QualificationService.extractLeadData(historique complet)
   │  → Utilise le Domain Contract (BOT_DOMAIN) pour :
   │     - Choisir le bon prompt d'extraction
   │     - Normaliser les types via typeNormalizer
   │     - Calculer le score via scoringRules
   │     - Identifier les missingFields via requiredFields
   │
8. SI isComplete && score >= AIRTABLE_MIN_SCORE :
   │  → Push CRM
   │
9. Retour de la réponse au client
```

**Point critique :** L'étape 4 est le GARDE-FOU. Si `buildQualificationHint` échoue (erreur, méthode manquante), le LLM ne sait PAS qu'il y a des champs manquants et peut halluciner une confirmation de RDV. C'est exactement le bug qui a été corrigé.

---

## 9. FAQ

### Q: Puis-je ajouter des champs custom à ExtractedLeadData ?

**R:** Oui, mais il faut :
1. Ajouter le champ à l'interface `ExtractedLeadData`
2. L'ajouter à `extractFieldsBestEffort`
3. L'ajouter au prompt d'extraction
4. L'ajouter au Domain Contract si c'est un required field
5. Mettre à jour `buildQualificationHint` si nécessaire

### Q: Puis-je avoir plusieurs domaines actifs en même temps ?

**R:** Pas dans la version actuelle (un seul `BOT_DOMAIN` par instance). Pour du multi-domaine, il faut déployer plusieurs instances ou implémenter un tenant-level domain routing.

### Q: Le scoring est-il configurable par domaine ?

**R:** Oui, chaque Domain Contract a ses propres `scoringRules`. Vous pouvez par exemple donner plus de poids au téléphone (30 pts) et moins à l'adresse (5 pts) pour un domaine où la localisation est moins importante.

### Q: Comment tester sans CRM ?

**R:** Mettre `AIRTABLE_ENABLED=false` dans le .env. Le scoring et la qualification fonctionnent toujours, seul le push CRM est désactivé. Vérifier les logs `📊 Qualification Score` et `📋 Missing fields`.

---

## 10. RÉSUMÉ EXÉCUTIF

| Action | Fichier | Temps estimé |
|--------|---------|-------------|
| Changer `BOT_DOMAIN` + `VAR_*` | `.env` | 2 min |
| Créer un Domain Contract | `qualification.service.ts` | 15 min |
| Réécrire le System Prompt | `prompts.ts` | 30 min |
| Tester (conversation + logs + CRM) | Terminal | 15 min |
| **Total** | | **~1h** |

**Aucune ligne de `chat.service.ts` ne doit être touchée.**
**Aucune ligne de `llm.service.ts` ne doit être touchée.**
**Le changement de domaine est une opération de CONFIGURATION, pas de DÉVELOPPEMENT.**

---

*Document maintenu par l'équipe OracleSentinel. Toute modification doit être validée par le Lead AI Architect.*