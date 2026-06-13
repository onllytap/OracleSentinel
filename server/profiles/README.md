# 📋 Agent Profiles — Guide de création et utilisation

> **Version**: 1.0.0
> **Dernière mise à jour**: Juillet 2025
> **Audience**: Opérateurs, développeurs, IAs chargées de configurer un nouveau client

---

## 🎯 Qu'est-ce qu'un profil ?

Un **profil agent** est un fichier JSON déclaratif qui décrit le **métier** du chatbot :
- Quels champs collecter (prénom, téléphone, type d'intervention…)
- Dans quel ordre poser les questions
- Comment scorer la qualification
- Comment formater les notes CRM

Le profil **ne touche PAS** au schéma CRM canonique. Toutes les données métier spécifiques vont dans le champ `notes` (catch-all).

---

## 📁 Structure du dossier

```
server/profiles/
├── README.md                      ← Ce fichier
├── garage.profile.json            ← Profil garage / atelier mécanique
├── real_estate.profile.json       ← Profil agence immobilière
└── (votre_profil.profile.json)    ← Ajoutez les vôtres ici
```

---

## ⚡ Activation d'un profil

### Méthode 1 : Via `AGENT_PROFILE` (recommandé)

Dans `server/.env` :

```env
AGENT_PROFILE=garage
```

Le système charge `server/profiles/garage.profile.json`.

**Valeurs possibles** : le `id` du fichier JSON (sans l'extension `.profile.json`).

### Méthode 2 : Via `BOT_DOMAIN` (legacy, toujours supporté)

```env
BOT_DOMAIN=garage
```

Si `AGENT_PROFILE` n'est pas défini, le système utilise `BOT_DOMAIN` pour sélectionner le contrat de domaine dans `qualification.service.ts`. Les profils JSON ne sont alors PAS utilisés — c'est le système hardcodé qui s'applique.

### Priorité de résolution

```
1. AGENT_PROFILE défini ? → Charger server/profiles/{AGENT_PROFILE}.profile.json
2. Sinon BOT_DOMAIN défini ? → Utiliser le contrat hardcodé (qualification.service.ts)
3. Sinon → Fallback "immobilier" avec warning dans les logs
```

---

## 🔧 Créer un nouveau profil (pas à pas)

### Étape 1 : Copier un profil existant

```bash
cp server/profiles/garage.profile.json server/profiles/restaurant.profile.json
```

### Étape 2 : Modifier le fichier JSON

Ouvrez `restaurant.profile.json` et modifiez chaque section :

```json
{
  "id": "restaurant",
  "name": "Restaurant / Traiteur",
  "description": "Profil pour restaurants, traiteurs, brasseries, etc.",
  "version": "1.0.0",
  "domain": "restaurant",
  ...
}
```

### Étape 3 : Adapter les champs obligatoires

```json
{
  "requiredFields": [
    "prenom",
    "nom",
    "numero_telephone",
    "type",
    "besoin",
    "adresse"
  ]
}
```

> **⚠️ IMPORTANT** : Les champs DOIVENT être des clés de `ExtractedLeadData` :
> `prenom`, `nom`, `numero_telephone`, `email`, `type`, `besoin`, `adresse`, `date_rdv`
>
> Vous ne pouvez PAS ajouter de nouveaux champs ici. Toute donnée métier supplémentaire
> doit aller dans `notes` via le `notesTemplate`.

### Étape 4 : Définir le plan de questions

Le `questionPlan` détermine l'ordre dans lequel le bot pose ses questions :

```json
{
  "questionPlan": [
    {
      "field": "type",
      "priority": 1,
      "question": "Souhaitez-vous réserver une table, organiser un événement, ou commander un traiteur ?",
      "hint": "demander le type de service (réservation, événement, traiteur)"
    },
    {
      "field": "besoin",
      "priority": 2,
      "question": "Pour combien de personnes et à quelle date ?",
      "hint": "demander le nombre de couverts, la date, et les préférences"
    }
  ]
}
```

- **`field`** : le champ `ExtractedLeadData` que cette question vise à remplir
- **`priority`** : ordre de priorité (1 = posée en premier)
- **`question`** : la question exacte que le bot peut poser
- **`hint`** : instruction courte injectée dans le prompt LLM

### Étape 5 : Configurer le scoring

```json
{
  "scoringRules": {
    "prenom+nom": 15,
    "numero_telephone": 20,
    "email": 10,
    "type": 15,
    "besoin": 15,
    "adresse": 15,
    "date_rdv": 10
  }
}
```

Le total maximum est **100**. Le seuil de push CRM est défini par `CRM_MIN_PUSH_SCORE` (défaut: 60).

### Étape 6 : Définir les slot hints (mots-clés de détection)

Les `slotHints` aident le système à détecter automatiquement les valeurs dans les messages :

```json
{
  "slotHints": {
    "type": ["réservation", "réserver", "table", "événement", "traiteur", "commande"],
    "besoin": ["couverts", "personnes", "menu", "végétarien", "allergies", "salle privée"],
    "adresse": ["ville", "quartier", "adresse"]
  }
}
```

### Étape 7 : Configurer les exemples d'extraction

Les `extractionExamples` sont injectés dans le prompt d'extraction LLM pour améliorer la précision :

```json
{
  "extractionExamples": [
    {
      "input": "Bonjour, je suis Jean Dupont, je voudrais réserver pour 8 personnes samedi soir, 0612345678",
      "output": {
        "prenom": "Jean",
        "nom": "Dupont",
        "numero_telephone": "0612345678",
        "type": "Réservation",
        "besoin": "8 personnes, samedi soir",
        "adresse": null
      }
    }
  ]
}
```

### Étape 8 : Définir le template de notes CRM

Le `notesTemplate` formate les données métier dans le champ `notes` du CRM :

```json
{
  "notesTemplate": "Service: {type}\nDétails: {besoin}\nLocalisation: {adresse}\nDate: {date_rdv}\n---\n{notes}"
}
```

Les variables `{field}` sont remplacées par les valeurs extraites. Le champ `{notes}` contient les notes libres du LLM.

### Étape 9 : Activer le profil

```env
# server/.env
AGENT_PROFILE=restaurant
```

### Étape 10 : Redémarrer et tester

```bash
cd server
npm run dev
# Vérifier dans les logs : "Profile loaded: restaurant (Restaurant / Traiteur)"

# Smoke test
npx ts-node scripts/crm-smoke-test.ts
```

---

## 📐 Schéma complet d'un profil

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `id` | string | ✅ | Identifiant unique (utilisé dans `AGENT_PROFILE`) |
| `name` | string | ✅ | Nom humain du profil |
| `description` | string | ❌ | Description longue |
| `version` | string | ❌ | Version sémantique |
| `domain` | string | ✅ | Domaine métier (`garage`, `immobilier`, `generic`, ou nouveau) |
| `requiredFields` | string[] | ✅ | Champs obligatoires pour considérer le lead comme complet |
| `scoringRules` | object | ✅ | Poids de chaque champ pour le score (total = 100) |
| `typeEnum` | string[] | ✅ | Valeurs possibles pour le champ `type` |
| `slotHints` | object | ❌ | Mots-clés par champ pour la détection automatique |
| `questionPlan` | array | ✅ | Ordre et formulation des questions |
| `notesTemplate` | string | ❌ | Template pour formater les notes CRM |
| `crmTag` | string | ❌ | Tag ajouté au lead CRM (ex: `GARAGE`, `REAL_ESTATE`) |
| `extractionPromptIntro` | string | ✅ | Première ligne du prompt d'extraction LLM |
| `besoinLabel` | string | ✅ | Description du champ `besoin` pour le prompt |
| `adresseLabel` | string | ✅ | Description du champ `adresse` pour le prompt |
| `extractionExamples` | array | ❌ | Exemples input/output pour l'extraction LLM |

---

## 🔗 Relation avec le schéma CRM canonique

Le schéma CRM canonique est **fixe et ne change JAMAIS** selon le profil :

| Champ CRM | Source | Description |
|-----------|--------|-------------|
| `firstName` | `prenom` | Prénom du lead |
| `lastName` | `nom` | Nom du lead |
| `phone` | `numero_telephone` | Numéro de téléphone |
| `email` | `email` | Email (optionnel) |
| `externalId` | Calculé (phone > email > session) | Clé d'idempotence |
| `qualificationScore` | Calculé par `scoringRules` | Score 0-100 (normalisé 0-1 pour Twenty) |
| `qualificationLevel` | Calculé (COLD/WARM/HOT) | Niveau de qualification |
| `source` | Toujours `CHATBOT` | Canal d'acquisition |
| `notes` | Formaté par `notesTemplate` | **Catch-all métier** : tout le contexte spécifique |

> Le champ `notes` est le **seul endroit** où les données métier spécifiques (véhicule, type de bien, nombre de couverts, etc.) sont stockées. Cela permet de garder un schéma CRM unique pour tous les profils.

---

## ⚠️ Variables .env associées au profil

| Variable | Défaut | Description |
|----------|--------|-------------|
| `AGENT_PROFILE` | *(non défini)* | ID du profil à charger |
| `AGENT_PROFILE_STRICT` | `true` | Si `true` : pas de push CRM tant que `requiredFields` incomplets |
| `AGENT_PROFILE_REQUIRED_FIELDS` | *(du profil JSON)* | Override CSV des champs obligatoires |
| `AGENT_PROFILE_INTENT_HINTS` | *(du profil JSON)* | Override CSV des mots-clés d'intention |
| `AGENT_PROFILE_PROMPT_APPEND` | *(non défini)* | Chemin vers un fichier `.md` à ajouter au prompt |

### Override des champs via .env (avancé)

Vous pouvez surcharger les `requiredFields` et les `slotHints` sans modifier le JSON :

```env
AGENT_PROFILE=garage
AGENT_PROFILE_REQUIRED_FIELDS=prenom,nom,numero_telephone,besoin
AGENT_PROFILE_INTENT_HINTS=vidange,freins,pneu,diagnostic
```

Cela permet de tester des variantes sans toucher au fichier profil.

---

## 🧪 Tests

### Smoke test rapide

```bash
cd server
npx ts-node scripts/crm-smoke-test.ts
```

Vérifie que le profil est chargé, que le gating fonctionne, et que le CRM est accessible.

### Conversation de test manuelle

1. Démarrer le serveur : `cd server && npm run dev`
2. Ouvrir le chat
3. Simuler une conversation complète (tous les champs remplis)
4. Vérifier dans les logs :
   - `📊 Qualification Score: XX/100`
   - `📋 Missing fields: None`
   - `🚀 Pushing qualified lead to CRM (twenty)...`
   - `✅ CRM push SUCCESS (twenty) — recordId=...`

---

## 🚫 Erreurs courantes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Profile not found: xxx` | Fichier `server/profiles/xxx.profile.json` n'existe pas | Créer le fichier ou corriger `AGENT_PROFILE` |
| `Invalid profile: missing requiredFields` | Le JSON est malformé | Vérifier la structure du fichier |
| Score toujours bas | `scoringRules` ne totalisent pas 100 | Ajuster les poids |
| Bot pose les mauvaises questions | `questionPlan` ne correspond pas au domaine | Adapter les questions |
| Push CRM ne se fait pas | `CRM_PROVIDER=none` ou lead incomplet | Voir `FACTORY_TROUBLESHOOTING.md` |
| Custom fields vides dans Twenty | `TWENTY_CUSTOM_FIELDS=false` | Mettre `TWENTY_CUSTOM_FIELDS=true` |

---

## 📚 Références

- **Guide maître** : `PROMPT_CHANGEMENT_ULTIME.md` (architecture, CRM, diagnostic)
- **Troubleshooting** : `FACTORY_TROUBLESHOOTING.md` (problèmes Factory + CRM)
- **Qualification** : `server/src/services/qualification.service.ts` (contrats hardcodés)
- **Connecteur Twenty** : `server/src/services/crm/twenty-connector.ts`
- **Smoke test CRM** : `server/scripts/crm-smoke-test.ts`

---

*Ce document est la référence unique pour le système de profils. Toute modification doit être tracée et datée.*