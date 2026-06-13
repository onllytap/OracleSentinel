# 📘 GUIDE : Système de Profils Agent

## 🎯 Objectif

Les **profils** sont des templates JSON qui permettent de configurer un agent IA pour un domaine métier spécifique (immobilier, garage, restaurant, etc.) **sans toucher au code**.

Un profil contient :
- Branding (nom, slogan, services)
- Variables dynamiques (horaires, adresse, contact)
- Personnalité (ton, style, expertise)
- Qualification (champs requis, scoring, checklist)
- Knowledge base (URLs à indexer)

---

## ⚡ UTILISATION RAPIDE

### 1️⃣ Charger un profil existant

**Fichier** : `server/.env`

```bash
# Option recommandée : charger un profil complet
BOT_PROFILE=garage_motrio
```

**Profils disponibles** :
- `immobilier` : Agence immobilière
- `garage_motrio` : Garage automobile Motrio
- `restaurant` : Restaurant (exemple)

### 2️⃣ Les variables du profil sont automatiquement chargées

Quand vous définissez `BOT_PROFILE=garage_motrio`, le système charge automatiquement :
- `COMPANY_NAME` → "Motrio"
- `BOT_DOMAIN` → "garage"
- `VAR_AGENCE_NOM` → "Motrio"
- Tous les autres champs du profil

### 3️⃣ Override avec .env (optionnel)

Les valeurs du `.env` **prennent le dessus** sur le profil :

```bash
BOT_PROFILE=garage_motrio
COMPANY_NAME="Mon Garage Perso"  # Override le nom du profil
```

---

## 📁 STRUCTURE D'UN PROFIL

**Fichier** : `profiles/garage_motrio.json`

```json
{
  "id": "garage_motrio",
  "name": "Garage Motrio",
  "version": "1.0.0",
  "domain": "garage",

  "branding": {
    "companyName": "Motrio",
    "companyTagline": "votre voiture, notre moteur",
    "companyWebsite": "https://www.motrio.fr/",
    "companyDescription": "Réseau de garages automobile",
    "companyServices": "Entretien,Vidange,Freinage,...",
    "targetAudience": "Conducteurs particuliers,Professionnels"
  },

  "variables": {
    "VAR_AGENCE_NOM": "Motrio",
    "VAR_AGENCE_ADRESSE": "45 Promenade Georges Godet",
    "VAR_TELEPHONE": "02 51 21 03 03"
  },

  "personality": {
    "role": "assistant MÉCANICIEN AUTOMOBILE EXPERT",
    "expertise": "mécanicien professionnel",
    "mission": "COMPRENDRE LE BESOIN : symptôme, type d'intervention",
    "tone": "warm",
    "writingStyle": "professional",
    "maxResponseWords": 40
  },

  "qualification": {
    "requiredFields": ["prenom", "nom", "numero_telephone", "type", "besoin", "adresse"],
    "checklist": [
      "Type d'intervention (entretien, panne, diagnostic)",
      "Besoin précis (symptôme, véhicule)",
      "Prénom / Nom / Téléphone / Ville"
    ],
    "scoringRules": { "prenom+nom": 15, "numero_telephone": 20, "type": 15, "besoin": 15, "adresse": 15 },
    "minPushScore": 60
  }
}
```

---

## 🛠️ CRÉER UN NOUVEAU PROFIL

### Étape 1 : Copier un profil existant

```bash
cp profiles/garage_motrio.json profiles/mon_nouveau.json
```

### Étape 2 : Éditer le JSON

- Modifier `id`, `name`, `domain`
- Adapter `branding` (nom, services, audience)
- Adapter `variables` (adresse, horaires, téléphone)
- Adapter `personality.role` et `mission`
- Adapter `qualification.checklist` (questions métier)

### Étape 3 : Activer le profil

```bash
# server/.env
BOT_PROFILE=mon_nouveau
```

### Étape 4 : Redémarrer le serveur

```bash
cd server
npm run dev
```

### Étape 5 : Vérifier les logs au démarrage

```
[ProfileLoader] Loaded profile: Mon Nouveau (mon_nouveau) v1.0.0
[ProfileLoader] Active profile: Mon Nouveau (source: BOT_PROFILE)
```

---

## 🔍 PRIORITÉ DE RÉSOLUTION

Le système charge la configuration dans cet ordre :

1. **BOT_PROFILE** (priorité maximale) → charge `profiles/{id}.json`
2. **BOT_DOMAIN** (fallback legacy) → utilise domain contract direct
3. **Fallback** → "immobilier" avec warning

**Exemple** :
```bash
# Si les 2 sont définis, BOT_PROFILE prend le dessus
BOT_PROFILE=restaurant
BOT_DOMAIN=garage  # IGNORÉ car BOT_PROFILE est défini
```

---

## ✅ CHECKLIST DE VALIDATION

Après avoir créé/chargé un profil, vérifiez :

- [ ] `BOT_PROFILE` défini dans `server/.env`
- [ ] Le fichier `profiles/{id}.json` existe et est valide JSON
- [ ] Le serveur démarre sans erreur
- [ ] Les logs montrent : `[ProfileLoader] Active profile: ...`
- [ ] Le bot pose les bonnes questions métier (checklist du profil)
- [ ] Le bot ne mélange PAS les domaines (ex: pas de "achat/vente" dans un garage)

---

## 🚫 ERREURS COURANTES

### Erreur : "Profile not found"

**Cause** : Le fichier `profiles/{id}.json` n'existe pas

**Solution** :
```bash
# Vérifier que le fichier existe
ls profiles/
# Corriger BOT_PROFILE ou créer le fichier manquant
```

### Erreur : "Invalid profile structure"

**Cause** : JSON malformé ou champs manquants

**Solution** :
```bash
# Valider le JSON
npx jsonlint profiles/mon_profil.json
# Comparer avec profiles/garage_motrio.json (référence)
```

### Warning : "BOT_DOMAIN=X → using profile 'Y'"

**Info** : C'est normal si vous utilisez `BOT_DOMAIN` au lieu de `BOT_PROFILE`

**Action** : Pour plus de clarté, passez à `BOT_PROFILE` explicite

---

## 📚 AVANTAGES DU SYSTÈME DE PROFILS

| Avant (manuel) | Après (profils) |
|----------------|-----------------|
| Modifier 10+ fichiers | Modifier 1 ligne .env |
| Risque d'incohérence | Template garanti cohérent |
| Difficile à versionner | JSON versionné (git) |
| Pas de réutilisation | Profils réutilisables |
| Erreurs fréquentes | Validation automatique |

---

**🎓 Questions ?** Consultez `GUIDE_CHANGEMENT_DOMAINE.md` et `FACTORY_TROUBLESHOOTING.md`
