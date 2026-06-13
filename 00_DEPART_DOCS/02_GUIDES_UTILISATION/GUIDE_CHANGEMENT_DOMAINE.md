# 📘 GUIDE : Changer de domaine métier (Garage → Plombier → Médecin → etc.)

## 🎯 Objectif

Ce guide vous explique **EXACTEMENT** comment changer le domaine métier de votre chatbot IA (immobilier → garage → autre) **sans toucher au code**.

**Domaines supportés :**
- `immobilier` : Agence immobilière (achat/vente/location)
- `garage` : Atelier automobile (entretien/réparation/diagnostic)
- `generic` : Domaine générique (tout autre secteur)

---

## ⚡ PROCÉDURE RAPIDE (3 ÉTAPES)

### 1️⃣ Modifier le fichier `.env`

**Fichier** : `server/.env`

**Ligne à modifier** :
```bash
BOT_DOMAIN=garage  # Changez cette valeur selon votre domaine
```

**Valeurs possibles** :
- `immobilier` (ou `immo`)
- `garage` (ou `automobile`, `auto`)
- `generic` (pour tout autre domaine)

---

### 2️⃣ Adapter le System Prompt

**Fichier** : `server/src/core/prompts.ts`

**Sections à modifier** :

#### A) Ligne 3 : Rôle et expertise
```typescript
// AVANT (garage)
Tu es un assistant MÉCANICIEN AUTOMOBILE EXPERT et PROFESSIONNEL pour le réseau Motrio.

// APRÈS (plombier exemple)
Tu es un assistant PLOMBIER EXPERT et PROFESSIONNEL pour [NOM ENTREPRISE].
```

#### B) Ligne 39 : Mission clé
```typescript
// AVANT (garage)
COMPRENDRE LE BESOIN : symptôme, type d'intervention (entretien/panne), véhicule

// APRÈS (plombier exemple)
COMPRENDRE LE BESOIN : symptôme, type d'intervention (fuite/dépannage/installation), localisation
```

#### C) Lignes 101-106 : Checklist de collecte de leads
```typescript
// AVANT (garage)
✓ Type d'intervention (entretien, panne, diagnostic, etc.)
✓ Besoin précis (symptôme, véhicule marque + modèle)
✓ Prénom
✓ Nom
✓ Téléphone
✓ Ville / secteur du client

// APRÈS (plombier exemple)
✓ Type d'intervention (fuite, dépannage, installation, etc.)
✓ Besoin précis (symptôme, localisation du problème)
✓ Prénom
✓ Nom
✓ Téléphone
✓ Ville / secteur du client
```

---

### 3️⃣ Créer un Domain Contract (si domaine custom)

⚠️ **Si vous utilisez `BOT_DOMAIN=immobilier` ou `BOT_DOMAIN=garage`** → Passez cette étape (déjà configurés)

**Si vous créez un nouveau domaine** (plombier, médecin, etc.) → Utilisez `BOT_DOMAIN=generic` et modifiez les variables d'environnement :

**Fichier** : `server/.env`
```bash
COMPANY_NAME="Plomberie Express"
COMPANY_DESCRIPTION="Plomberie d'urgence et installation sanitaire 24/7"
COMPANY_SERVICES="Dépannage fuite,Installation sanitaire,Débouchage,Rénovation salle de bain"
```

---

## 🔍 COMMENT VÉRIFIER QUE ÇA FONCTIONNE

### Test 1 : Vérifier le domaine chargé

**Fichier** : `server/src/services/qualification.service.ts:439`

Cherchez cette ligne dans les logs :
```bash
Domain: Garage Automobile  # ✅ Doit correspondre à votre domaine
```

### Test 2 : Vérifier les questions posées

Le bot doit demander :
- ✅ **Garage** : "type d'intervention (entretien, réparation, diagnostic)"
- ❌ **Immobilier** : "type de projet (achat/vente/location)"

### Test 3 : Vérifier le score de qualification

```bash
📊 Qualification Score: XX/100
📋 Missing fields: [ type, besoin, adresse ]
```

Le champ `type` doit correspondre au domaine métier.

---

## 🛠️ TROUBLESHOOTING

### Problème 1 : Le bot pose encore les mauvaises questions

**Cause** : `BOT_DOMAIN` n'est pas défini ou mal configuré

**Solution** :
1. Vérifiez `server/.env` → ligne `BOT_DOMAIN=garage`
2. Redémarrez le serveur : `npm run dev` (dans `server/`)
3. Vérifiez les logs au démarrage

---

### Problème 2 : Le bot ne collecte pas les bonnes infos

**Cause** : Le System Prompt n'est pas aligné avec le Domain Contract

**Solution** :
1. Vérifiez que la **checklist** dans `prompts.ts` (lignes 101-106) correspond aux `requiredFields` du Domain Contract
2. Exemple pour garage :
   ```typescript
   // prompts.ts ligne 101-106
   ✓ Type d'intervention  // → correspond à "type" dans requiredFields
   ✓ Besoin précis        // → correspond à "besoin"
   ✓ Ville / secteur      // → correspond à "adresse"
   ```

---

### Problème 3 : Les données ne sont pas envoyées au CRM

**Cause** : Le mapping CRM n'est pas configuré

**Solution** :
1. Vérifiez `server/.env` → section `AIRTABLE` ou `TWENTY`
2. Vérifiez que les champs CRM correspondent aux champs du Domain Contract :
   ```bash
   AIRTABLE_FIELD_TYPE=type
   AIRTABLE_FIELD_NEED=besoin
   AIRTABLE_FIELD_ADDRESS=adresse
   ```

---

## 📊 TABLEAU DE CORRESPONDANCE

| Domaine      | BOT_DOMAIN    | Champ "type"                                   | Champ "besoin"                          |
|--------------|---------------|------------------------------------------------|-----------------------------------------|
| Immobilier   | `immobilier`  | Achat immobilier / Vente / Location            | T3, maison, appartement                 |
| Garage Auto  | `garage`      | Entretien / Réparation / Diagnostic            | Voyant moteur, freins, vidange          |
| Plombier     | `generic`     | Fuite / Dépannage / Installation               | Fuite sous évier, chauffe-eau           |
| Médecin      | `generic`     | Consultation / Urgence / Suivi                 | Symptômes, antécédents                  |

---

## 🚀 DÉPLOIEMENT EN PRODUCTION

1. **Modifiez `server/.env`** (pas `.env.example`)
2. **Committez les changements** :
   ```bash
   git add server/.env server/src/core/prompts.ts
   git commit -m "chore: configure domain for [DOMAIN]"
   ```
3. **Redéployez** :
   ```bash
   cd server
   npm run build
   pm2 restart chatbot-server  # ou votre méthode de déploiement
   ```

---

## ⚠️ RÈGLES CRITIQUES

1. **JAMAIS** modifier `qualification.service.ts` pour un changement de domaine
2. **TOUJOURS** vérifier que `prompts.ts` est aligné avec le Domain Contract
3. **TOUJOURS** tester en développement avant de déployer
4. **JAMAIS** créer de logique métier dans `chat.service.ts`

---

## 📚 FICHIERS IMPLIQUÉS

| Fichier | Rôle | Modifié pour changement de domaine ? |
|---------|------|--------------------------------------|
| `server/.env` | Configuration du domaine | ✅ **OUI** (BOT_DOMAIN) |
| `server/src/core/prompts.ts` | Personnalité du bot | ✅ **OUI** (roleplay, checklist) |
| `server/src/services/qualification.service.ts` | Contrats métier | ❌ NON (sauf nouveau domaine) |
| `server/src/services/chat.service.ts` | Orchestration | ❌ **JAMAIS** |

---

## ✅ CHECKLIST FINALE

Avant de déployer, vérifiez :

- [ ] `BOT_DOMAIN` est défini dans `server/.env`
- [ ] Le rôle dans `prompts.ts` ligne 3 correspond au domaine
- [ ] La checklist (lignes 101-106) correspond aux `requiredFields` du Domain Contract
- [ ] Les variables `COMPANY_NAME`, `COMPANY_DESCRIPTION` sont à jour
- [ ] Le mapping CRM est configuré (si applicable)
- [ ] Testé en local avec une conversation complète
- [ ] Le bot ne demande JAMAIS de questions de l'ancien domaine

---

**🎓 En cas de doute, référez-vous à ce guide.**
**📞 Support technique : [contact@oraclesentinel.com](mailto:contact@oraclesentinel.com)**
