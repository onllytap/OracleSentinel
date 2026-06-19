# 🔥 PROMPT CHANGEMENT ULTIME — OracleSentinel

> **Version**: 3.0 — Post-P0 CRM Fix
> **Dernière mise à jour**: Juillet 2025
> **Audience**: Toute IA externe (Claude, ChatGPT, Gemini, etc.) chargée de modifier le domaine ou le CRM
> **Règle d'or**: Ce fichier est la **SINGLE SOURCE OF TRUTH**. En cas de doute, ce document prime.

---

## TABLE DES MATIÈRES

1. [Architecture en 3 couches](#1-architecture-en-3-couches)
2. [Changement de domaine métier](#2-changement-de-domaine-métier)
3. [Changement de CRM (Twenty / Airtable)](#3-changement-de-crm-twenty--airtable)
4. [Variables d'environnement — Référence complète](#4-variables-denvironnement--référence-complète)
5. [Règles non négociables](#5-règles-non-négociables)
6. [Diagnostic CRM — Arbre de décision](#6-diagnostic-crm--arbre-de-décision)
7. [Twenty CRM — Guide opérationnel complet](#7-twenty-crm--guide-opérationnel-complet)
8. [Airtable — Guide opérationnel complet](#8-airtable--guide-opérationnel-complet)
9. [Qualification & Gating — Comment le push est décidé](#9-qualification--gating--comment-le-push-est-décidé)
10. [Sécurité des secrets](#10-sécurité-des-secrets)
11. [Scripts de validation](#11-scripts-de-validation)
12. [Checklist universelle de changement](#12-checklist-universelle-de-changement)
13. [Bugs connus et pièges historiques](#13-bugs-connus-et-pièges-historiques)
14. [Glossaire](#14-glossaire)

---

## 1. Architecture en 3 couches

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE A — Persona / Roleplay                                  │
│  Fichier: server/src/core/prompts.ts                            │
│  Rôle: Ton, style, sécurité, anti-hallucination                 │
│  Contient: {DYNAMIC_VARIABLES} et {CHAT_TURN_HINT} (OBLIGATOIRE)│
│  Modifié: OUI pour changement de domaine                        │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE B — Domain Contract (qualification)                      │
│  Fichier: server/src/services/qualification.service.ts           │
│  Rôle: requiredFields, scoringRules, typeNormalizer, hints       │
│  Modifié: NON (sauf nouveau domaine pas encore dans les contrats)│
├─────────────────────────────────────────────────────────────────┤
│  COUCHE C — Orchestrateur + CRM Push                             │
│  Fichier: server/src/services/chat.service.ts                    │
│  Rôle: Build prompt, call LLM, gating, push CRM                 │
│  Modifié: JAMAIS (sauf bug structurel prouvé par preuve)         │
├─────────────────────────────────────────────────────────────────┤
│  COUCHE D — Connecteurs CRM                                      │
│  Fichiers: server/src/services/crm/*.ts                          │
│  Rôle: Twenty / Airtable adapters, upsert, dedup                │
│  Modifié: JAMAIS pour un changement de domaine                   │
└─────────────────────────────────────────────────────────────────┘
```

### Fichiers impliqués — Carte complète

| Fichier | Modifié pour domaine? | Modifié pour CRM? | Rôle |
|---------|----------------------|-------------------|------|
| `server/.env` | ✅ OUI (`BOT_DOMAIN`) | ✅ OUI (`CRM_PROVIDER`, `TWENTY_*`) | Configuration runtime |
| `server/src/core/prompts.ts` | ✅ OUI (persona) | ❌ NON | Prompt système LLM |
| `server/src/services/qualification.service.ts` | ⚠️ Seulement si nouveau domaine | ❌ NON | Contrats métier |
| `server/src/services/chat.service.ts` | ❌ **JAMAIS** | ❌ **JAMAIS** | Orchestrateur |
| `server/src/services/crm/config.ts` | ❌ NON | ❌ NON (lit .env) | Config CRM centralisée |
| `server/src/services/crm/crm-factory.ts` | ❌ NON | ❌ NON | Singleton CRM |
| `server/src/services/crm/twenty-connector.ts` | ❌ NON | ❌ NON | Adaptateur Twenty |
| `server/src/services/crm/twenty-mapping.config.ts` | ❌ NON | ❌ NON | Mapping champs |
| `server/src/services/crm/airtable-connector.ts` | ❌ NON | ❌ NON | Adaptateur Airtable |
| `server/src/factory/config-synthesizer.ts` | ❌ NON | ❌ NON | Factory UI → .env |

---

## 2. Changement de domaine métier

### 2.1. Domaines pré-configurés

| Domaine | `BOT_DOMAIN` | Alias acceptés | Contrat dans qualification.service.ts |
|---------|-------------|----------------|---------------------------------------|
| Immobilier | `immobilier` | `immo` | ✅ Ligne 27-80 |
| Garage auto | `garage` | `automobile`, `auto` | ✅ Ligne 82-170 |
| Générique | `generic` | — | ✅ Ligne 172-209 |

### 2.2. Procédure exacte (3 étapes)

#### Étape 1 : `server/.env`

```env
# Changer cette ligne :
BOT_DOMAIN=garage
```

**Valeurs possibles** : `immobilier` | `immo` | `garage` | `automobile` | `auto` | `generic`

> ⚠️ Si `BOT_DOMAIN` est vide ou absent, le système **fallback à `immobilier`** avec un warning dans les logs.

#### Étape 2 : `server/src/core/prompts.ts`

Modifier **3 sections** :

| Section | Lignes approx. | Quoi changer |
|---------|----------------|--------------|
| Rôle/expertise | Ligne 3 | "assistant MÉCANICIEN" → "assistant PLOMBIER" etc. |
| Missions clés | ~Ligne 39 | Adapter les missions au domaine |
| Checklist leads | ~Lignes 101-106 | Aligner avec `requiredFields` du contrat |

**RÈGLES ABSOLUES pour prompts.ts** :
- `{DYNAMIC_VARIABLES}` doit rester EXACTEMENT tel quel (pas de suppression, pas de renommage)
- `{CHAT_TURN_HINT}` doit rester EXACTEMENT tel quel
- La section `🔒 SÉCURITÉ` ne doit JAMAIS être modifiée
- La section `⛔ RÈGLE ANTI-HALLUCINATION — RENDEZ-VOUS` ne doit JAMAIS être supprimée

#### Étape 3 : Vérification

```bash
cd server
npx ts-node scripts/crm-smoke-test.ts
```

Attendu dans les logs au démarrage :
```
[QualificationService] Domain: garage
📊 Qualification Score: XX/100
```

### 2.3. Créer un NOUVEAU domaine (ex: restaurant, plombier)

Si le domaine n'existe pas encore dans `DOMAIN_CONTRACTS` :

1. Ouvrir `server/src/services/qualification.service.ts`
2. Ajouter un nouveau contrat dans `DOMAIN_CONTRACTS` (copier `garage` comme modèle)
3. Ajouter la reconnaissance du nom dans `getDomain()` (switch/if)
4. Mettre à jour `DomainType` (union type ligne 7)

**Structure d'un contrat** :
```typescript
restaurant: {
    name: "Restaurant",
    requiredFields: ["prenom", "nom", "numero_telephone", "type", "besoin", "adresse"],
    scoringRules: {
        "prenom+nom": 15,
        numero_telephone: 20,
        email: 10,
        type: 15,       // Réservation / Événement / Traiteur
        besoin: 15,      // Nombre de couverts, menu, date
        adresse: 15,     // Pas forcément critique pour un restaurant
        date_rdv: 10,
    },
    extractionPromptIntro: "Tu es un extracteur de données EXPERT pour CRM restaurant.",
    typeNormalizer: (raw: string): string | null => { /* ... */ },
    typeEnum: "Réservation|Événement|Traiteur|Autre",
    besoinLabel: "nombre de couverts, type de repas, allergies",
    adresseLabel: "pas nécessaire (restaurant fixe)",
    extractionExamples: "...",
    questionHints: { /* ... */ },
}
```

> **IMPORTANT** : Les `requiredFields` DOIVENT correspondre aux clés de `ExtractedLeadData` (prenom, nom, numero_telephone, email, type, besoin, adresse, date_rdv). On ne peut PAS ajouter de nouveaux champs sans modifier l'interface.

---

## 3. Changement de CRM (Twenty / Airtable)

### 3.1. Vue d'ensemble

| Paramètre | Twenty | Airtable |
|-----------|--------|----------|
| `CRM_PROVIDER` | `twenty` | `airtable` |
| API type | REST (`/rest/people`, `/rest/companies`) | Webhook |
| Auth | Bearer JWT (API Key) | Webhook URL (secret intégré) |
| Upsert | Par `externalId` → email → phone | Par webhook (pas d'upsert natif) |
| Custom fields | Oui (configurable) | Via mapping webhook |

### 3.2. Passer à Twenty

```env
# server/.env — Section CRM
CRM_PROVIDER=twenty
CRM_MIN_PUSH_SCORE=60

# Twenty spécifique
TWENTY_ENABLED=true
TWENTY_API_URL=https://votre-instance.twenty.com
TWENTY_API_KEY=eyJhbG...votre_clé_jwt
TWENTY_TIMEOUT_MS=10000
TWENTY_CUSTOM_FIELDS=true
TWENTY_FIELD_EXTERNALID=externalid
TWENTY_FIELD_SOURCE=source
TWENTY_FIELD_QUALIFICATIONSCORE=qualificationscore
TWENTY_FIELD_QUALIFICATIONLEVEL=qualificationlevel
TWENTY_DEFAULT_SOURCE=CHATBOT
TWENTY_DEFAULT_PHONE_COUNTRY=FR
```

### 3.3. Passer à Airtable

```env
# server/.env — Section CRM
CRM_PROVIDER=airtable

# Airtable spécifique
AIRTABLE_ENABLED=true
AIRTABLE_WEBHOOK_URL=https://hooks.airtable.com/workflows/v1/genericWebhook/...
AIRTABLE_TIMEOUT_MS=10000
AIRTABLE_FIELD_FIRSTNAME=prenom
AIRTABLE_FIELD_LASTNAME=nom
AIRTABLE_FIELD_FULLNAME=nom_complet
AIRTABLE_FIELD_PHONE=numero_telephone
AIRTABLE_FIELD_EMAIL=email
AIRTABLE_FIELD_TYPE=type
AIRTABLE_FIELD_NEED=besoin
AIRTABLE_FIELD_ADDRESS=adresse
AIRTABLE_FIELD_QUALIFICATION=qualification
AIRTABLE_FIELD_DETAILS=details
AIRTABLE_FIELD_NOTES=notes
AIRTABLE_FIELD_AGENTNOTE=impression_agent
AIRTABLE_FIELD_APPOINTMENT=date_rdv
AIRTABLE_FIELD_TAGS=tags
```

### 3.4. Désactiver le CRM

```env
CRM_PROVIDER=none
```

> ⚠️ **PIÈGE HISTORIQUE** : `CRM_PROVIDER=none` est le défaut si la variable est absente. Après un changement de domaine, **TOUJOURS** vérifier que `CRM_PROVIDER` n'a pas été remis à `none`.

---

## 4. Variables d'environnement — Référence complète

### 4.1. Variables critiques pour le push CRM

| Variable | Valeur par défaut | Impact si manquante/erronée |
|----------|-------------------|----------------------------|
| `CRM_PROVIDER` | `none` | **Push désactivé** — rien ne part au CRM |
| `CRM_MIN_PUSH_SCORE` | `60` | Seuil de score pour déclencher le push |
| `BOT_DOMAIN` | `immobilier` | Mauvais contrat → mauvais champs → score bas → pas de push |
| `TWENTY_API_URL` | — | Push Twenty impossible |
| `TWENTY_API_KEY` | — | Push Twenty impossible (401) |
| `TWENTY_ENABLED` | `true` | Si `false`, Twenty désactivé même avec CRM_PROVIDER=twenty |
| `TWENTY_CUSTOM_FIELDS` | `false` | Si `false`, pas de score/level/source dans Twenty |

### 4.2. Variable legacy (rétrocompatibilité)

| Variable legacy | Remplacée par | Comportement |
|----------------|---------------|--------------|
| `AIRTABLE_MIN_SCORE` | `CRM_MIN_PUSH_SCORE` | `chat.service.ts` lit `CRM_MIN_PUSH_SCORE` d'abord, puis fallback `AIRTABLE_MIN_SCORE`, puis `60` |

### 4.3. Arbre de résolution du seuil de push

```
CRM_MIN_PUSH_SCORE défini ?
  ├─ OUI → utiliser cette valeur
  └─ NON → AIRTABLE_MIN_SCORE défini ?
              ├─ OUI → utiliser cette valeur
              └─ NON → 60 (défaut hardcodé)
```

---

## 5. Règles non négociables

### 🚫 INTERDICTIONS ABSOLUES

| # | Règle | Raison |
|---|-------|--------|
| 1 | **JAMAIS** supprimer `{DYNAMIC_VARIABLES}` dans `prompts.ts` | Le bot perd les infos entreprise (horaires, adresse, etc.) |
| 2 | **JAMAIS** supprimer `{CHAT_TURN_HINT}` dans `prompts.ts` | Le bot perd le guidage de qualification |
| 3 | **JAMAIS** modifier `chat.service.ts` sauf bug structurel **prouvé** | Risque de régression sur toute la chaîne |
| 4 | **JAMAIS** laisser un `catch {}` silencieux autour de `buildQualificationHint()` | Le bot hallucine des confirmations de RDV |
| 5 | **JAMAIS** écrire de valeur redactée dans `.env` (via Factory ou manuellement) | Les secrets sont perdus, API cassée |
| 6 | **JAMAIS** annoncer "MISSION ACCOMPLIE" sans preuve exécutable | Erreur historique de ClaudeCode — exiger test reproductible |
| 7 | **JAMAIS** introduire un système `BOT_PROFILE` / `profiles/*.json` tant que P0 instable | Refonte prématurée, régression garantie |
| 8 | **JAMAIS** avoir deux domaines actifs simultanément | Un seul `BOT_DOMAIN`, un seul prompt actif |

### ✅ OBLIGATIONS

| # | Règle |
|---|-------|
| 1 | Toujours vérifier `CRM_PROVIDER` après un changement de domaine |
| 2 | Toujours redémarrer le serveur après modification de `.env` |
| 3 | Toujours exécuter `npx ts-node scripts/crm-smoke-test.ts` après un changement |
| 4 | Toujours aligner la checklist dans `prompts.ts` avec les `requiredFields` du contrat |
| 5 | Toujours tester avec une conversation complète avant de valider |

---

## 6. Diagnostic CRM — Arbre de décision

Quand le push CRM ne fonctionne pas, suivre cet arbre **dans l'ordre** :

```
Le push CRM ne fonctionne pas
│
├─ 1. CRM_PROVIDER est-il défini et ≠ "none" ?
│     ├─ NON → FIX: CRM_PROVIDER=twenty (ou airtable) dans server/.env
│     └─ OUI ↓
│
├─ 2. Le lead est-il COMPLET (isComplete=true) ?
│     ├─ NON → Vérifier dans les logs:
│     │         📋 Missing fields: type, besoin, adresse
│     │         ⏸️ CRM push SKIPPED — incomplete (missing: ...)
│     │
│     │     Cause probable:
│     │     - BOT_DOMAIN mal configuré → mauvais contrat → extraction échoue
│     │     - Le prompt ne guide pas vers les bons champs
│     │     - La conversation n'a pas encore assez d'infos
│     │
│     └─ OUI ↓
│
├─ 3. Le score est-il ≥ CRM_MIN_PUSH_SCORE (défaut: 60) ?
│     ├─ NON → Le log affiche:
│     │         ⏸️ CRM push SKIPPED — score too low (35/60)
│     │
│     │     Cause probable:
│     │     - Champs collectés mais pas assez (score trop faible)
│     │     - Ajuster CRM_MIN_PUSH_SCORE si le seuil est trop haut
│     │
│     └─ OUI ↓
│
├─ 4. Le push est-il TENTÉ ? (chercher dans les logs)
│     ├─ Pas de "🚀 Pushing qualified lead to CRM" → Le code gating a un bug
│     └─ "🚀 Pushing qualified lead to CRM (twenty)..." trouvé ↓
│
├─ 5. Le push a-t-il RÉUSSI ?
│     ├─ "✅ CRM push SUCCESS" → Le push fonctionne !
│     │     Si le record n'apparaît pas dans Twenty:
│     │     - Mauvais workspace (vérifier workspaceId dans le JWT)
│     │     - Mauvais tenant/routing
│     │
│     ├─ "⚠️ CRM push FAILED" → Lire la raison:
│     │     - reason=401 → TWENTY_API_KEY invalide ou expiré
│     │     - reason=403 → Permissions insuffisantes
│     │     - reason=404 → TWENTY_API_URL incorrect
│     │     - reason=422 → Payload invalide (mapping champs)
│     │     - reason=timeout → TWENTY_TIMEOUT_MS trop court
│     │     - reason=STRICT_REQUIRE_ID → personId non retourné
│     │     - reason=STRICT_VERIFY_WRITE → Vérification post-écriture échouée
│     │
│     └─ "❌ CRM/DB Update Failed" → Exception non gérée (stack trace)
│
└─ 6. Si tout semble OK mais record absent dans Twenty:
      - Vérifier le workspaceId dans le JWT (doit correspondre à l'instance)
      - Vérifier TWENTY_API_URL (self-hosted vs cloud)
      - Chercher par externalId ou téléphone dans Twenty
```

---

## 7. Twenty CRM — Guide opérationnel complet

### 7.1. Type d'API

Twenty utilise une **API REST** avec les endpoints :

| Opération | Méthode | Endpoint | Usage dans le code |
|-----------|---------|----------|-------------------|
| Lister/chercher personnes | `GET` | `/rest/people` | Recherche dedup |
| Créer personne | `POST` | `/rest/people` | Création lead |
| Mettre à jour personne | `PATCH` | `/rest/people/{id}` | Update lead |
| Créer entreprise | `POST` | `/rest/companies` | Optionnel |
| Créer opportunité | `POST` | `/rest/opportunities` | Optionnel |
| Créer note | `POST` | `/rest/notes` | Détails conversation |
| Découvrir schéma | `GET` | `/api/rest/metadata/objects` | Diagnostic |

### 7.2. Authentification

```http
Authorization: Bearer <TWENTY_API_KEY>
Content-Type: application/json
```

Le `TWENTY_API_KEY` est un **JWT** contenant :
- `sub` : ID utilisateur
- `type` : `API_KEY`
- `workspaceId` : UUID du workspace
- `iat` / `exp` : dates de création / expiration

**Vérification manuelle** (décode le JWT) :
```bash
echo "VOTRE_JWT" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

### 7.3. Logique d'upsert (idempotence)

L'upsert suit cette priorité :

```
1. Chercher par externalId (champ custom) → si trouvé → PATCH (update)
2. Chercher par email (primaryEmail) → si trouvé → PATCH (update)
3. Chercher par téléphone (primaryPhoneNumber) → si trouvé → PATCH (update)
4. Rien trouvé → POST (create)
```

Le `externalId` est calculé dans `chat.service.ts` :
```
phone normalisé (9 derniers chiffres) ? → "phone-XXXXXXXXX"
email ?                                  → "email-xxx@yyy.com"
ni l'un ni l'autre ?                     → "session-<sessionId>" (fallback)
```

### 7.4. Mapping des champs critiques

| Champ CDM | Champ Twenty REST API | Type | Notes |
|-----------|-----------------------|------|-------|
| firstName | `name.firstName` | string | Standard |
| lastName | `name.lastName` | string | Standard |
| phone | `phones.primaryPhoneNumber` | string | Chiffres uniquement |
| phoneCountry | `phones.primaryPhoneCountryCode` | string | Code ISO: "FR", "US" |
| email | `emails.primaryEmail` | string | Standard |
| externalId | `externalid` (custom) | string | Clé d'idempotence |
| qualificationScore | `qualificationscore` (custom) | number | **0-1** (pas 0-100 !) |
| qualificationLevel | `qualificationlevel` (custom) | select | `COLD` \| `WARM` \| `HOT` |
| source | `source` (custom) | select | `CHATBOT` \| `WEBSITE_FORM` \| `ADS` \| `MANUAL` |

> ⚠️ **Score normalisé** : Twenty affiche en %, donc on écrit `score / 100` (ex: 85 → 0.85).
> Voir `normalizeScoreForTwenty()` dans `twenty-mapping.config.ts`.

> ⚠️ **Champs custom** : Nécessitent `TWENTY_CUSTOM_FIELDS=true` ET que les champs existent dans le schéma Twenty (créés manuellement dans l'UI Twenty > Settings > Data model > People > Add field).

### 7.5. Score → Qualification Level

| Score | Level | Couleur Twenty |
|-------|-------|---------------|
| 0–39 | `COLD` | 🔵 |
| 40–69 | `WARM` | 🟡 |
| 70–100 | `HOT` | 🔴 |

### 7.6. Erreurs fréquentes Twenty

| Code HTTP | Cause | Fix |
|-----------|-------|-----|
| 401 | API key invalide ou expirée | Régénérer dans Twenty > Settings > API Keys |
| 403 | Workspace incorrect ou permissions | Vérifier `workspaceId` dans le JWT |
| 404 | URL de base incorrecte | Vérifier `TWENTY_API_URL` (doit pointer vers l'instance, pas `api.twenty.com` si self-hosted) |
| 422 | Payload invalide | Vérifier le mapping des champs (noms exacts, types) |
| 429 | Rate limit | Le code gère automatiquement (retry avec backoff) |
| 500 | Bug serveur Twenty | Réessayer plus tard, vérifier les logs Twenty |

### 7.7. Self-hosted vs Cloud

| | Self-hosted | Cloud (twenty.com) |
|---|-----------|-------------------|
| URL | `https://votre-domaine.com` | `https://api.twenty.com` |
| API Key | Générée localement | Générée sur twenty.com |
| `workspaceId` | Présent dans JWT | Peut être absent |

> ⚠️ **PIÈGE** : Si le JWT contient un `workspaceId` mais l'URL pointe vers `api.twenty.com`, le workspace ne sera pas trouvé. Le connecteur détecte ce cas et log un warning.

---

## 8. Airtable — Guide opérationnel complet

### 8.1. Type d'API

Airtable utilise un **Webhook** (automation) :

| Opération | Méthode | Endpoint |
|-----------|---------|----------|
| Push lead | `POST` | `AIRTABLE_WEBHOOK_URL` |

### 8.2. Payload envoyé

Le payload est un objet JSON plat avec les champs configurés via `AIRTABLE_FIELD_*` :

```json
{
  "prenom": "Jean",
  "nom": "Dupont",
  "nom_complet": "Jean Dupont",
  "numero_telephone": "0612345678",
  "email": "jean@example.com",
  "type": "Entretien",
  "besoin": "Vidange Clio 4",
  "adresse": "Chartres",
  "qualification": 85,
  "details": "Résumé de la conversation...",
  "notes": "Notes contextuelles...",
  "impression_agent": "Client pressé, semble connaître son véhicule...",
  "date_rdv": "2025-07-20",
  "tags": ["Estimation"]
}
```

### 8.3. Pas d'upsert natif

Airtable via webhook ne fait **pas** de dedup. Chaque push crée un nouveau record.
La dedup est gérée côté bot :
- Table `crm_pushed_leads` en base PostgreSQL
- Vérification par téléphone normalisé (30 jours de cooldown)

### 8.4. Configuration des champs

Les noms de colonnes Airtable sont configurables via `AIRTABLE_FIELD_*` dans `.env`.
Chaque variable mappe un champ CDM vers un nom de colonne Airtable :

```
AIRTABLE_FIELD_FIRSTNAME → colonne "prenom" dans Airtable
AIRTABLE_FIELD_PHONE     → colonne "numero_telephone" dans Airtable
```

---

## 9. Qualification & Gating — Comment le push est décidé

### 9.1. Fichier : `server/src/services/chat.service.ts` (lignes ~607-922)

Le push est décidé par **DEUX conditions conjointes** :

```typescript
if (qualificationResult.isComplete && qualificationResult.score >= minScore) {
    // → Push CRM
} else {
    // → Log diagnostic "⏸️ CRM push SKIPPED — ..."
}
```

### 9.2. Calcul de `isComplete`

```typescript
// qualification.service.ts
const missingFields = contract.requiredFields.filter(field => !data[field]);
const isComplete = missingFields.length === 0;
```

Les `requiredFields` dépendent du **domaine** (`BOT_DOMAIN`).

Pour **garage** : `prenom, nom, numero_telephone, type, besoin, adresse`
Pour **immobilier** : `prenom, nom, numero_telephone, type, besoin, adresse`
Pour **generic** : idem

### 9.3. Calcul du score

```
prenom + nom présents    → +15
numero_telephone         → +20
email                    → +10
type                     → +15
besoin                   → +15
adresse                  → +15
date_rdv                 → +10
                    TOTAL = 100 max
```

### 9.4. Calcul de `minScore`

```typescript
const minScore = parseInt(
    process.env.CRM_MIN_PUSH_SCORE ||
    process.env.AIRTABLE_MIN_SCORE ||
    "60"
);
```

### 9.5. Résumé visuel

```
Conversation en cours
    │
    ▼
extractLeadData(history) → { leadData, score, missingFields, isComplete }
    │
    ├─ isComplete=false OR score < minScore
    │   └─ ⏸️ Log "CRM push SKIPPED" + raisons
    │
    └─ isComplete=true AND score >= minScore
        │
        ▼
    Build CDM Lead (person + opportunity + notes)
        │
        ▼
    getCRMConnector().pushLead(cdmLead, sessionId)
        │
        ├─ CRM_PROVIDER=none → No-op (silently "succeeds")
        ├─ CRM_PROVIDER=twenty → TwentyConnector.pushLead()
        │     ├─ upsertPerson (search → create/update)
        │     ├─ upsertCompany (if provided)
        │     ├─ linkPersonToCompany
        │     ├─ upsertOpportunity
        │     └─ createNote
        └─ CRM_PROVIDER=airtable → AirtableConnector.pushLead()
              └─ POST webhook with flat payload
```

### 9.6. Logs à surveiller

| Log | Signification |
|-----|--------------|
| `📊 Qualification Score: 85/100` | Score calculé |
| `📋 Missing fields: None` | Tous les champs requis sont présents |
| `📋 Missing fields: type, besoin, adresse` | Champs manquants → isComplete=false |
| `⏸️ CRM push SKIPPED — incomplete (missing: type, besoin) + score too low (35/60)` | Gating actif, push non tenté |
| `🚀 Pushing qualified lead to CRM (twenty)...` | Push en cours |
| `✅ CRM push SUCCESS (twenty) — recordId=abc123...` | Push réussi |
| `⚠️ CRM push FAILED (twenty) — reason=..., duplicate=false` | Push échoué |
| `❌ CRM/DB Update Failed (Non-fatal, continuing chat):` | Exception non gérée |
| `[CRM] Provider: DISABLED (CRM_PROVIDER=none)` | CRM désactivé au démarrage |
| `[CRM] Provider: Twenty CRM` | Twenty activé au démarrage |
| `[Twenty] ⚠️ TWENTY_API_KEY is not set` | Clé API manquante |
| `[Twenty] ⚠️ TOKEN EXPIRED` | JWT expiré |

---

## 10. Sécurité des secrets

### 10.1. Mécanisme de protection (Factory)

Le fichier `server/src/factory/config-synthesizer.ts` contient un système de protection :

1. **Liste des clés secrètes** (`SECRET_KEY_EXACT`) :
   - `JWT_SECRET`, `ADMIN_API_KEY`, `TWENTY_API_KEY`, `TWENTY_API_URL`,
   - `AIRTABLE_WEBHOOK_URL`, `DATABASE_URL`, `GROQ_API_KEY`, etc.

2. **Détection de valeurs redactées** (`isRedactedValue()`) :
   - Pattern `xxx...yyy` (ellipsis au milieu)
   - Pattern `•••` (bullets)
   - Pattern `***` (asterisks)

3. **Logique de protection** lors de `saveConfig()` :
   - Étape 1 : Backup automatique de `.env` existant
   - Étape 2 : Lecture de TOUTES les valeurs actuelles
   - Étape 3 : Pour chaque clé secrète :
     - Si la nouvelle valeur est redactée → **substituer** par l'ancienne valeur
     - Si aucune ancienne valeur → **commenter** la ligne (ne pas écrire de placeholder)
   - Étape 4 : Vérification d'intégrité post-écriture
   - Étape 5 : **Rollback automatique** si une valeur redactée a traversé

### 10.2. Risques connus

| Risque | Scénario | Mitigation |
|--------|----------|------------|
| Factory écrase secret | UI envoie valeur redactée | `isRedactedValue()` + substitution |
| Backup manquant | Premier run sans `.env` | Vérifier `.env.backup.*` |
| Secret trop court | API key tronquée | Validation longueur dans `validator.ts` |
| Secret expiré | JWT Twenty expire | `validateConfiguration()` vérifie `exp` |

### 10.3. Restauration d'urgence

```bash
# Lister les backups
ls -la server/.env.backup.*

# Restaurer le plus récent
cp server/.env.backup.<TIMESTAMP> server/.env

# Redémarrer
cd server && npm run dev
```

---

## 11. Scripts de validation

### 11.1. Smoke test CRM (Node.js, cross-platform)

```bash
cd server
npx ts-node scripts/crm-smoke-test.ts          # Dry run (pas de push)
npx ts-node scripts/crm-smoke-test.ts --push    # Avec push de test réel
```

**Vérifie** : env config, connectivité Twenty, factory CRM, gating logic, intégrité secrets.

### 11.2. Smoke test Factory (PowerShell)

```powershell
.\scripts\factory-smoke.ps1               # Basic
.\scripts\factory-smoke.ps1 -LivePush     # Avec push test
```

**Vérifie** : prérequis, domaine, CRM provider, API Twenty, secrets, serveur, endpoints.

### 11.3. Validation CRM config

```bash
cd server
npx ts-node scripts/validate-crm-config.ts
```

### 11.4. Test rapide de connectivité Twenty (curl)

```bash
# Remplacer <URL> et <KEY> par vos valeurs
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer <KEY>" \
  "<URL>/rest/people?limit=1"
```

Attendu : HTTP 200 + JSON avec `data.people`.

---

## 12. Checklist universelle de changement

### Changement de DOMAINE (ex: immobilier → garage)

```
[ ] 1. server/.env : BOT_DOMAIN=garage
[ ] 2. server/.env : Vérifier CRM_PROVIDER=twenty (pas "none" !)
[ ] 3. server/src/core/prompts.ts : Adapter la persona (rôle, missions, checklist)
[ ] 4. server/src/core/prompts.ts : Vérifier {DYNAMIC_VARIABLES} présent
[ ] 5. server/src/core/prompts.ts : Vérifier {CHAT_TURN_HINT} présent
[ ] 6. server/.env : COMPANY_NAME, COMPANY_DESCRIPTION mis à jour
[ ] 7. Redémarrer le serveur : cd server && npm run dev
[ ] 8. Exécuter : npx ts-node scripts/crm-smoke-test.ts
[ ] 9. Test conversation complète (tous les champs collectés)
[ ] 10. Vérifier dans les logs : "Domain: Garage Automobile"
[ ] 11. Vérifier : pas de question de l'ancien domaine (achat/vente/location)
[ ] 12. Vérifier : push CRM affiché "✅ CRM push SUCCESS" (ou SKIPPED si incomplet)
```

### Changement de CRM (ex: Airtable → Twenty)

```
[ ] 1. server/.env : CRM_PROVIDER=twenty
[ ] 2. server/.env : TWENTY_API_URL=https://votre-instance.com
[ ] 3. server/.env : TWENTY_API_KEY=eyJhbG...
[ ] 4. server/.env : TWENTY_ENABLED=true
[ ] 5. server/.env : TWENTY_CUSTOM_FIELDS=true (si champs custom créés)
[ ] 6. Tester la connectivité : curl GET /rest/people?limit=1
[ ] 7. Redémarrer le serveur
[ ] 8. Exécuter : npx ts-node scripts/crm-smoke-test.ts --push
[ ] 9. Vérifier le record dans l'UI Twenty
[ ] 10. Vérifier externalId, qualificationScore, source dans le record
```

### Checklist rapide post-changement (copy/paste)

```bash
# 1. Vérifier la config
grep -E "BOT_DOMAIN|CRM_PROVIDER|TWENTY_ENABLED" server/.env

# 2. Smoke test CRM (sans push)
cd server && npx ts-node scripts/crm-smoke-test.ts

# 3. Test connectivité Twenty direct
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $(grep TWENTY_API_KEY server/.env | cut -d= -f2)" \
  "$(grep TWENTY_API_URL server/.env | cut -d= -f2 | tr -d '\"' | sed 's:/*$::')/rest/people?limit=1"

# 4. Smoke test avec push
cd server && npx ts-node scripts/crm-smoke-test.ts --push
```

---

## 13. Bugs connus et pièges historiques

### Bug P0 #1 : `BOT_DOMAIN` manquant (résolu)

- **Symptôme** : Le bot garage demandait "achat/vente/location" (questions immobilier)
- **Cause** : `BOT_DOMAIN` absent de `server/.env` → fallback à `immobilier`
- **Fix** : Ajouter `BOT_DOMAIN=garage` dans `server/.env`

### Bug P0 #2 : `CRM_PROVIDER=none` après changement de domaine (résolu)

- **Symptôme** : Le push CRM ne se fait plus après passage au domaine garage
- **Cause** : `CRM_PROVIDER=none` dans `server/.env` — le CRM est entièrement désactivé
- **Fix** : Changer `CRM_PROVIDER=none` → `CRM_PROVIDER=twenty`
- **Piège** : Le no-op connector retourne `{ success: true }` silencieusement — on croit que ça marche

### Bug P0 #3 : `catch {}` silencieux autour de `buildQualificationHint()` (résolu)

- **Symptôme** : Le bot confirmait des RDV sans avoir toutes les infos
- **Cause** : L'erreur dans `buildQualificationHint()` était avalée par un catch vide
- **Fix** : Le catch log l'erreur ET injecte un message de dégradation dans le prompt

### Piège #4 : Variable legacy `AIRTABLE_MIN_SCORE`

- **Contexte** : `chat.service.ts` lisait `AIRTABLE_MIN_SCORE` alors que le CRM config utilise `CRM_MIN_PUSH_SCORE`
- **Fix** : Le code lit maintenant `CRM_MIN_PUSH_SCORE` en priorité, puis `AIRTABLE_MIN_SCORE`, puis défaut `60`

### Piège #5 : Factory UI qui écrase les secrets

- **Contexte** : La Factory UI envoie des valeurs redactées ("sk-proj-A...xyz9")
- **Protection** : `config-synthesizer.ts` détecte et substitue automatiquement
- **Si ça arrive quand même** : Restaurer depuis `server/.env.backup.<timestamp>`

### Piège #6 : Refonte BOT_PROFILE prématurée

- **Contexte** : ClaudeCode a tenté d'introduire un système `profiles/*.json` avant que le P0 soit stable
- **Règle** : Ne PAS introduire de système de profils tant que le pipeline domain+CRM est stable
- **Mécanisme actuel** : `BOT_DOMAIN` + contrats dans `qualification.service.ts` = suffisant

---

## 14. Guide de changement Twenty (NOUVEAU)

### 14.1. Vérification pré-changement

Avant TOUT changement de domaine ou de CRM, exécutez cette vérification :

```bash
# Depuis la racine du projet
cd server
grep -E "^(BOT_DOMAIN|CRM_PROVIDER|TWENTY_API_URL|TWENTY_API_KEY|TWENTY_ENABLED|TWENTY_CUSTOM_FIELDS|CRM_MIN_PUSH_SCORE)" .env
```

**Résultat attendu** (exemple pour garage + Twenty) :
```
BOT_DOMAIN=garage
CRM_PROVIDER=twenty
TWENTY_API_URL=https://votre-instance-twenty.com
TWENTY_API_KEY=eyJhbG... (JWT complet, non expiré)
TWENTY_ENABLED=true
TWENTY_CUSTOM_FIELDS=true
CRM_MIN_PUSH_SCORE=60
```

> ⚠️ **PIÈGE MORTEL** : Si `CRM_PROVIDER=none`, le no-op connector est actif.
> Il retourne `{ success: true }` **sans contacter Twenty**.
> Les logs affichent `✅ CRM push SUCCESS (none)` — on croit que ça marche, mais RIEN n'est écrit.
> C'est le Bug P0 #2 documenté section 13.

### 14.2. Adapter les champs Twenty pour un nouveau domaine

Les champs Twenty sont définis dans `server/src/services/crm/twenty-mapping.config.ts`.

Les champs **standard** (name, phones, emails) ne changent JAMAIS entre domaines.

Les champs **custom** (externalId, qualificationScore, qualificationLevel, source) sont identiques pour tous les domaines.

| Champ CDM | Champ Twenty | Change entre domaines ? | Notes |
|-----------|-------------|------------------------|-------|
| `firstName` | `name.firstName` | ❌ Non | Standard |
| `lastName` | `name.lastName` | ❌ Non | Standard |
| `phone` | `phones.primaryPhoneNumber` | ❌ Non | Chiffres uniquement |
| `email` | `emails.primaryEmail` | ❌ Non | Standard |
| `externalId` | `externalid` (custom) | ❌ Non | Clé d'idempotence auto-calculée |
| `qualificationScore` | `qualificationscore` (custom) | ❌ Non | 0-1 (normalisé depuis 0-100) |
| `qualificationLevel` | `qualificationlevel` (custom) | ❌ Non | COLD/WARM/HOT auto-calculé |
| `source` | `source` (custom) | ❌ Non | Toujours "CHATBOT" |
| `projectType` | Note uniquement | ✅ Oui | Valeur du `type` extrait (domaine-dépendant) |
| `need` | Note uniquement | ✅ Oui | Valeur du `besoin` extrait |
| `location` | Note uniquement | ✅ Oui | Valeur de l'`adresse` extraite |

**Conclusion** : Aucune modification de mapping Twenty n'est nécessaire lors d'un changement de domaine.
Les données domain-spécifiques (type, besoin, adresse) sont transportées dans les **NOTES** (voir 14.4).

### 14.3. Adapter les champs Twenty si vous ajoutez des custom fields

Si vous créez de nouveaux champs custom dans Twenty (ex: `vehicleBrand` pour garage), vous devez :

1. **Créer le champ** dans Twenty UI : Settings > Data model > People > Add field
2. **Ajouter la variable d'env** dans `server/.env` :
   ```
   TWENTY_FIELD_VEHICLEBRAND=vehiclebrand
   ```
3. **Modifier** `server/src/services/crm/twenty-connector.ts` dans `upsertPerson()` :
   ```typescript
   // Après les custom fields existants (ligne ~600)
   if (customFieldsEnabled) {
       // ... champs existants ...
       const fieldVehicleBrand = process.env.TWENTY_FIELD_VEHICLEBRAND || 'vehiclebrand';
       if (lead.person.vehicleBrand) {
           payload[fieldVehicleBrand] = lead.person.vehicleBrand;
       }
   }
   ```
4. **Ajouter le champ** dans `CdmPerson` dans `server/src/services/crm/types.ts`
5. **Mapper** dans `chat.service.ts` lors de la construction du `cdmLead`

> ⚠️ Ne faites cela que si le champ est CRITIQUE pour le workflow CRM.
> Les données domain-spécifiques sont déjà dans les NOTES — un champ custom n'est nécessaire que pour le filtrage/tri dans l'UI Twenty.

### 14.4. Comment les NOTES sont construites et adaptées

Les notes sont créées dans `server/src/services/crm/twenty-connector.ts` méthode `createNote()` (ligne ~1285).

Le template est **automatiquement adapté** au domaine grâce aux champs du CDM :

```
══════════════════════════════════════════════════
📋 FICHE LEAD CHATBOT — {lead.person.fullName}
══════════════════════════════════════════════════

🏷️ CONTEXTE MÉTIER
   Domaine: {lead.domainName}          ← "Garage Automobile" ou "Immobilier"
   Type de projet: {lead.projectType}  ← "Diagnostic" ou "Achat immobilier"

🎯 INTENTION / BESOIN
   {lead.need}                          ← "Voyant moteur Clio 4" ou "T3 centre-ville"

📍 LOCALISATION
   {lead.location}                      ← "Chartres" ou "Les Sables d'Olonne"

📊 QUALIFICATION
   Score: {lead.qualificationScore}/100 ({qualLevel})
   Statut: COMPLET ✅ / INCOMPLET ❌

📝 CHAMPS COLLECTÉS
   - Prénom: {lead.person.firstName}
   - Nom: {lead.person.lastName}
   - Téléphone: {lead.person.phone}
   - Email: {lead.person.email}
   - Type: {lead.projectType}
   - Besoin: {lead.need}
   - Localisation: {lead.location}
   - RDV: {lead.appointmentDate}

💬 IMPRESSION AGENT
   {lead.agentNote}

📝 RÉSUMÉ CONVERSATION
   {lead.summary}

📎 NOTES ADDITIONNELLES
   {lead.notes}

🔍 TRAÇABILITÉ (SYSTÈME)
   SessionId: {lead.sessionId}
   ExternalId: {lead.person.externalId}
   Source: CHATBOT
   Horodatage: {timestamp}
══════════════════════════════════════════════════
```

**Aucune modification n'est nécessaire** lors d'un changement de domaine.
Le template s'adapte automatiquement via les valeurs du CDM.

### 14.5. Vérifier que les notes arrivent dans Twenty

Après un push réussi, vérifiez dans les logs :

```
[Twenty] Creating structured note for person abc12345...
[Twenty]   Domain: garage, Score: 85, Missing: 0
[Twenty] Note created and attached: def67890...
```

Dans l'UI Twenty :
1. Ouvrez le contact
2. L'onglet "Notes" doit contenir une note avec le titre :
   `Lead Garage Automobile — Jean Dupont — 09/02/2026`
3. Le corps contient toutes les données listées ci-dessus

Si la note n'apparaît pas :
- Vérifiez le log `[Twenty] Note creation FAILED: HTTP XXX` → problème de permissions ou de schéma
- Vérifiez que l'endpoint `/rest/notes` est accessible (curl test)
- Vérifiez que `/rest/noteTargets` est accessible (pour l'attachement au contact)

---

## 15. Guide de changement Airtable (NOUVEAU)

### 15.1. Variables d'environnement Airtable

```
CRM_PROVIDER=airtable
AIRTABLE_ENABLED=true
AIRTABLE_WEBHOOK_URL=https://hooks.airtable.com/workflows/v1/...
```

### 15.2. Payload Airtable et adaptation au domaine

Le connecteur Airtable envoie un **payload plat** via webhook. Les noms de champs sont configurables :

| Variable d'env | Défaut | Contenu (exemple garage) |
|---------------|--------|--------------------------|
| `AIRTABLE_FIELD_FIRSTNAME` | `prenom` | "Jean" |
| `AIRTABLE_FIELD_LASTNAME` | `nom` | "Dupont" |
| `AIRTABLE_FIELD_FULLNAME` | `nom_complet` | "Jean Dupont" |
| `AIRTABLE_FIELD_PHONE` | `numero_telephone` | "(+33) 612-345-678" |
| `AIRTABLE_FIELD_TYPE` | `type` | "Diagnostic" (garage) / "Achat immobilier" (immo) |
| `AIRTABLE_FIELD_NEED` | `besoin` | "Voyant moteur Clio 4" |
| `AIRTABLE_FIELD_ADDRESS` | `adresse` | "Chartres" |
| `AIRTABLE_FIELD_QUALIFICATION` | `qualification` | 85 (score 0-100) |
| `AIRTABLE_FIELD_DETAILS` | `details` | Résumé conversation |
| `AIRTABLE_FIELD_NOTES` | `notes` | Notes collectées |
| `AIRTABLE_FIELD_APPOINTMENT` | `date_rdv` | "2026-03-15" |
| `AIRTABLE_FIELD_AGENTNOTE` | `impression_agent` | Note agent humain-like |
| `AIRTABLE_FIELD_TAGS` | `tags` | "Estimation" (si applicable) |
| `AIRTABLE_FIELD_EMAIL` | `email` | (si collecté) |

### 15.3. Adapter les champs Airtable pour un nouveau domaine

**Aucune modification de code n'est nécessaire.** Les valeurs des champs (`type`, `besoin`, `adresse`) changent automatiquement selon le domaine.

Si votre table Airtable a des colonnes avec des valeurs prédéfinies (ex: dropdown "type" avec "Achat/Vente/Location"), vous devez :

1. **Ajouter les nouvelles valeurs** dans Airtable (ex: "Diagnostic", "Entretien", "Réparation" pour garage)
2. OU **changer le type de colonne** en "Single line text" (accepte tout)

### 15.4. Pas d'upsert natif

Airtable via webhook ne supporte PAS l'upsert. Chaque push crée un **nouveau record**.
La déduplication est gérée côté chatbot via la table PostgreSQL `crm_pushed_leads` (par téléphone, 30 jours).

---

## 16. Comment tester sans casser la prod (NOUVEAU)

### 16.1. Méthode recommandée : environnement de test

```bash
# 1. Copier le .env
cp server/.env server/.env.backup.manual

# 2. Modifier pour le test
# Dans server/.env, changer :
BOT_DOMAIN=garage
CRM_PROVIDER=twenty  # ou "none" si test dialogue uniquement

# 3. Redémarrer
cd server && npm run dev

# 4. Tester la conversation
# (via le widget ou curl)

# 5. Restaurer
cp server/.env.backup.manual server/.env
cd server && npm run dev
```

### 16.2. Test dialogue SANS push CRM

Pour tester le dialogue sans toucher au CRM :
```
CRM_PROVIDER=none
```
Le no-op connector accepte tout silencieusement. Utile pour valider le prompt/extraction.

> ⚠️ Ne PAS oublier de remettre `CRM_PROVIDER=twenty` après le test.

### 16.3. Test CRM isolé (sans conversation)

```bash
cd server
npx ts-node test/test-crm-integration.ts
```

Ce script teste : connexion, upsert person, idempotence, company, opportunity, pushLead complet, déduplication, schema discovery.

### 16.4. Test diagnostic Twenty (authentification)

```bash
cd server
npx ts-node test/diagnose-twenty.ts
```

Teste : clé API, format JWT, expiration, endpoints, métadonnées.

### 16.5. Test end-to-end via curl

```bash
# Envoyer un message au bot
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bonjour, problème de freins Clio 4, Jean Dupont 0612345678 Chartres", "sessionId": "test-e2e-001"}'
```

Puis vérifier les logs pour la séquence complète (voir section 9.6).

### 16.6. Séquence de validation complète (copy/paste)

```bash
# ─── ÉTAPE 1 : Vérifier la configuration ───────────────────────
cd server
echo "=== ENV CHECK ==="
grep -E "^(BOT_DOMAIN|CRM_PROVIDER|TWENTY_API_URL|TWENTY_ENABLED)" .env

# ─── ÉTAPE 2 : Tester la connectivité CRM ──────────────────────
echo "=== CRM CONNECTIVITY ==="
npx ts-node test/diagnose-twenty.ts

# ─── ÉTAPE 3 : Tester le push isolé ────────────────────────────
echo "=== CRM INTEGRATION ==="
npx ts-node test/test-crm-integration.ts

# ─── ÉTAPE 4 : Tester une conversation complète ────────────────
echo "=== E2E CONVERSATION ==="
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bonjour problème freins Clio 4 diesel 2018, voyant allumé, Jean Dupont 0612345678 Chartres, dispo samedi", "sessionId": "test-validation-'$(date +%s)'"}'

# ─── ÉTAPE 5 : Vérifier les logs ───────────────────────────────
echo "=== CHECK LOGS ==="
echo "Chercher dans les logs :"
echo "  1. [Prompts] Domain prompt selected: garage"
echo "  2. 🚀 Pushing qualified lead to CRM (twenty)..."
echo "  3. ✅ CRM push SUCCESS (twenty) — recordId=..."
echo "  4. [Twenty] Note created and attached: ..."
```

---

## 17. Guide pour IA : "Change mon agent garage en agent restaurateur" (NOUVEAU)

### 17.1. Instructions complètes pour un changement de domaine par IA

Si une IA reçoit l'instruction "change le domaine de X vers Y", voici EXACTEMENT ce qu'elle doit faire :

#### Fichiers à LIRE en premier (source de vérité)
1. `PROMPT_CHANGEMENT_ULTIME.md` — ce fichier
2. `server/.env` — configuration actuelle
3. `server/src/services/qualification.service.ts` — contrats de domaine existants
4. `server/src/core/prompts.ts` — prompts existants

#### Fichiers à MODIFIER (ordre strict)

**Étape 1 : `server/.env`**
```
BOT_DOMAIN=restaurant    # ← nouveau domaine
# NE PAS TOUCHER à CRM_PROVIDER, TWENTY_API_URL, TWENTY_API_KEY !
```

**Étape 2 : `server/src/services/qualification.service.ts`**
- Ajouter le type dans `DomainType` : `"restaurant"`
- Ajouter un bloc dans `DOMAIN_CONTRACTS` :
```typescript
restaurant: {
    name: "Restaurant",
    requiredFields: ["prenom", "nom", "numero_telephone", "type", "besoin", "adresse"],
    scoringRules: {
        "prenom+nom": 15, numero_telephone: 20, email: 10,
        type: 15, besoin: 15, adresse: 15, date_rdv: 10,
    },
    extractionPromptIntro: "Tu es un extracteur de données EXPERT pour CRM restauration.",
    typeNormalizer: (raw: string): string | null => {
        const lower = raw.toLowerCase();
        if (lower.includes("réservation") || lower.includes("table")) return "Réservation";
        if (lower.includes("traiteur") || lower.includes("événement")) return "Traiteur/Événement";
        if (lower.includes("livraison")) return "Livraison";
        if (lower.includes("emporter") || lower.includes("à emporter")) return "À emporter";
        if (raw.trim().length > 2) return raw.trim();
        return null;
    },
    typeEnum: "Réservation|Traiteur/Événement|Livraison|À emporter",
    besoinLabel: "description de la demande (nombre de couverts, type de cuisine, occasion)",
    adresseLabel: "ville ou quartier",
    extractionExamples: `...exemples pertinents...`,
    questionHints: {
        prenom: "demander le prénom",
        nom: "demander le nom de famille",
        type: "demander le type de demande (réservation, traiteur, livraison)",
        besoin: "demander les détails (nombre de personnes, occasion, préférences)",
        adresse: "demander la localisation",
        numero_telephone: "demander le numéro de téléphone",
        date_rdv: "proposer une date de réservation",
    },
},
```
- Ajouter le mapping dans `getDomain()` :
```typescript
if (raw === "restaurant" || raw === "resto") return "restaurant";
```

**Étape 3 : `server/src/core/prompts.ts`**
- Ajouter le type dans `DomainType` : `"restaurant"`
- Créer `RESTAURANT_SYSTEM_PROMPT` (copier un prompt existant et adapter)
- Ajouter le case dans `getSystemPrompt()` :
```typescript
case "restaurant":
    profile = { domainId: "restaurant", domainName: "Restaurant", systemPrompt: RESTAURANT_SYSTEM_PROMPT };
    break;
```
- Ajouter le mapping dans `getDomainFromEnv()` :
```typescript
if (raw === "restaurant" || raw === "resto") return "restaurant";
```

**Étape 4 : Optionnel — `profiles/restaurant.json`**
- Créer le fichier de profil (non utilisé en runtime actuellement, mais prêt pour le futur)

#### Fichiers à NE PAS MODIFIER
- ❌ `server/src/services/chat.service.ts` — JAMAIS
- ❌ `server/src/services/crm/twenty-connector.ts` — JAMAIS
- ❌ `server/src/services/crm/crm-factory.ts` — JAMAIS
- ❌ `server/src/services/crm/config.ts` — JAMAIS
- ❌ `server/src/services/crm/types.ts` — JAMAIS (sauf ajout de champ custom CDM)

#### Fichiers à VÉRIFIER après modification
- ✅ `server/.env` → `BOT_DOMAIN=restaurant`, `CRM_PROVIDER=twenty` (inchangé !)
- ✅ Logs au démarrage → `[Prompts] Domain prompt selected: restaurant`
- ✅ Conversation test → le bot pose des questions restaurant, pas garage/immo
- ✅ Push CRM → `✅ CRM push SUCCESS (twenty)`
- ✅ Note Twenty → contient "Domaine: Restaurant"

### 17.2. Validation : questions que l'IA doit se poser

Avant de déclarer "mission accomplie", l'IA DOIT vérifier :

```
[ ] Le DomainType est-il ajouté dans qualification.service.ts ET prompts.ts ?
[ ] Le getDomain() reconnaît-il la nouvelle valeur de BOT_DOMAIN ?
[ ] Le getDomainFromEnv() reconnaît-il la même valeur ?
[ ] Le DOMAIN_CONTRACTS contient-il un bloc complet pour le nouveau domaine ?
[ ] Le switch dans getSystemPrompt() contient-il un case pour le nouveau domaine ?
[ ] Le .env a-t-il BOT_DOMAIN=<nouveau> ET CRM_PROVIDER=twenty (inchangé) ?
[ ] Ai-je vérifié que CRM_PROVIDER n'a PAS été changé en "none" ?
```

> ⚠️ Si l'IA ne peut pas prouver chacun de ces points par du code existant ou modifié,
> elle DOIT le signaler explicitement au lieu de déclarer succès.

---

## 18. Glossaire

| Terme | Définition |
|-------|-----------|
| **CDM** | Canonical Data Model — structure de données indépendante du CRM (`CdmLead`, `CdmPerson`) |
| **Domain Contract** | Configuration métier (requiredFields, scoringRules, typeNormalizer) dans `qualification.service.ts` |
| **Gating** | Logique qui décide si un lead est poussé au CRM (isComplete + score >= seuil) |
| **Factory** | Interface d'administration web pour configurer le bot (UI à `/factory`) |
| **externalId** | Identifiant unique pour l'upsert CRM (basé sur téléphone > email > sessionId) |
| **Qualification Level** | Classification du lead : COLD (< 40), WARM (40-69), HOT (≥ 70) |
| **No-op connector** | Connecteur CRM factice créé quand `CRM_PROVIDER=none` — ne fait rien |
| **Smoke test** | Test rapide automatisé vérifiant la configuration sans conversation complète |
| **Upsert** | Opération "Update if exists, Insert if not" — évite les doublons |
| **P0** | Priorité maximale — bug bloquant à corriger immédiatement |

---

## Appendice A : Conversations de test (fixtures)

### A.1. Garage — Lead complet (doit pousser)

```
User: "Bonjour, problème de FAP sur Audi RS6"
Bot:  (questions techniques sur le véhicule)
User: "Je veux un entretien"
Bot:  (demande coordonnées)
User: "Dayton Raytonne"
Bot:  (demande téléphone)
User: "0780803631"
Bot:  (demande localisation)
User: "Je suis à Chartres"
Bot:  (propose RDV)
User: "Disponibilité samedi prochain 16h"
```

**Attendu** :
- `type` = Entretien (ou Diagnostic)
- `besoin` = Problème FAP Audi RS6
- `adresse` = Chartres
- `score` ≥ 80
- `isComplete` = true
- Push CRM = oui

### A.2. Immobilier — Lead complet (doit pousser)

```
User: "Bonjour je cherche un T3"
Bot:  (demande type de projet)
User: "C'est pour achat"
Bot:  (demande précisions)
User: "Budget 250k, centre ville"
Bot:  (demande localisation)
User: "Je suis à Chartres"
Bot:  (demande coordonnées)
User: "Dayton Raytonne 0780803631"
```

**Attendu** :
- `type` = Achat immobilier
- `besoin` = T3, budget 250k, centre-ville
- `adresse` = Chartres
- `score` ≥ 80
- `isComplete` = true
- Push CRM = oui

### A.3. Lead incomplet (ne doit PAS pousser)

```
User: "Bonjour"
Bot:  (salutation)
User: "J'ai un problème avec ma voiture"
Bot:  (questions techniques)
```

**Attendu** :
- `score` < 60
- `isComplete` = false
- `missingFields` = [prenom, nom, numero_telephone, ...]
- Push CRM = non
- Log: `⏸️ CRM push SKIPPED — incomplete (...) + score too low (...)`

---

### A.4. Restaurant — Lead complet (doit pousser, si domaine configuré)

```
User: "Bonjour, je voudrais réserver une table"
Bot:  (questions sur la réservation)
User: "Pour 6 personnes samedi soir"
Bot:  (demande coordonnées)
User: "Marie Martin 0698765432"
Bot:  (demande localisation)
User: "Restaurant du centre-ville, Nantes"
Bot:  (propose créneau)
User: "20h ce serait parfait"
```

**Attendu** :
- `type` = Réservation
- `besoin` = Table 6 personnes samedi soir
- `adresse` = Nantes
- `score` ≥ 80
- `isComplete` = true
- Push CRM = oui (si CRM_PROVIDER=twenty)
- Note Twenty contient "Domaine: Restaurant"

---

## Appendice B : Arbre de diagnostic "Twenty ne push plus" (NOUVEAU)

```
Le push Twenty ne fonctionne plus ?
│
├─ Q1: Le log "[CRM] Provider: ..." au démarrage dit quoi ?
│   ├─ "DISABLED (CRM_PROVIDER=none)" → FIX: CRM_PROVIDER=twenty dans .env
│   ├─ "Twenty CRM" → Continuer Q2
│   └─ "Airtable" → FIX: CRM_PROVIDER=twenty dans .env
│
├─ Q2: Le log "🚀 Pushing qualified lead to CRM (twenty)..." apparaît ?
│   ├─ Non → Le gating bloque. Vérifier :
│   │   ├─ Le log "⏸️ CRM push SKIPPED" avec la raison
│   │   ├─ score < minScore ? → Vérifier CRM_MIN_PUSH_SCORE
│   │   └─ isComplete=false ? → Vérifier extraction LLM (logs Qualification Score)
│   └─ Oui → Continuer Q3
│
├─ Q3: Le log "✅ CRM push SUCCESS" ou "⚠️ CRM push FAILED" ?
│   ├─ SUCCESS mais rien dans Twenty UI :
│   │   ├─ Provider = "none" ? → Bug P0 #2 (no-op connector)
│   │   └─ Vérifier TWENTY_API_URL pointe vers la bonne instance
│   ├─ FAILED avec raison :
│   │   ├─ "Twenty not configured" → TWENTY_API_KEY ou TWENTY_API_URL manquant
│   │   ├─ "HTTP 401" → Clé API invalide ou expirée
│   │   ├─ "HTTP 404" → URL incorrecte (self-hosted vs cloud ?)
│   │   ├─ "HTTP 422" → Payload invalide (champ custom inexistant ?)
│   │   ├─ "duplicate" → Chercher par phone/email, puis PATCH
│   │   └─ "STRICT_REQUIRE_ID" → CRM_STRICT_REQUIRE_ID=false pour débloquer
│   └─ Ni l'un ni l'autre → Exception non gérée, vérifier "❌ CRM/DB Update Failed"
│
└─ Q4: La note apparaît dans Twenty ?
    ├─ Non → Vérifier log "[Twenty] Note creation FAILED: HTTP XXX"
    │   ├─ HTTP 404 → Endpoint /rest/notes non disponible (version Twenty ?)
    │   └─ HTTP 400 → Payload note invalide
    └─ Oui → Pipeline complet ✅
```

---

*Fin du document. Ce fichier est la référence unique. Toute modification doit être tracée et datée.*
*Dernière mise à jour : ajout sections 14-17, Appendice A.4, Appendice B — guide Twenty/Airtable/Notes/IA.*