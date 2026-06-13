# 🔧 FACTORY TROUBLESHOOTING GUIDE

## 🎯 Objectif

Ce guide vous aide à **diagnostiquer et résoudre** les problèmes courants de la Factory OracleSentinel,
y compris les problèmes de **push CRM** (Twenty / Airtable).

> **Voir aussi** : `PROMPT_CHANGEMENT_ULTIME.md` pour le guide maître complet (domaine + CRM).

---

## 🚨 PROBLÈME LE PLUS FRÉQUENT : Le push CRM ne se fait plus

### Symptôme
- Le bot converse normalement
- La qualification s'affiche dans les logs (`📊 Qualification Score: XX/100`)
- Mais **aucun lead n'apparaît dans le CRM** (Twenty ou Airtable)

### Cause racine #1 (P0) : `CRM_PROVIDER=none`

C'est le bug le plus courant après un changement de domaine ou un passage par la Factory UI.

**Diagnostic** :
```bash
grep CRM_PROVIDER server/.env
# Si le résultat est : CRM_PROVIDER=none → C'est la cause !
```

**Fix** :
```bash
# Dans server/.env, changer :
CRM_PROVIDER=twenty    # (ou "airtable" selon votre CRM)
# Puis redémarrer le serveur
```

**Pourquoi c'est insidieux** : Le connecteur no-op retourne `{ success: true }` silencieusement.
Le système croit que le push a réussi, mais rien n'est envoyé.

### Cause racine #2 : Lead incomplet (gating normal)

**Diagnostic** — Chercher ce log :
```
⏸️ CRM push SKIPPED — incomplete (missing: type, besoin, adresse) + score too low (35/60) [provider=twenty, minScore=60]
```

**Ce n'est PAS un bug** si le lead est vraiment incomplet. Le bot n'a pas encore collecté assez d'infos.

**Mais c'est un bug SI** le bot a toutes les infos et que l'extraction LLM ne les capture pas.
Dans ce cas, vérifier :
- `BOT_DOMAIN` dans `server/.env` correspond au bon domaine
- Le prompt dans `prompts.ts` guide vers les bons champs
- Le contrat dans `qualification.service.ts` a les bons `requiredFields`

### Cause racine #3 : Clé API Twenty invalide

**Diagnostic** :
```bash
# Test direct de connectivité
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $(grep TWENTY_API_KEY server/.env | cut -d= -f2)" \
  "$(grep TWENTY_API_URL server/.env | cut -d= -f2 | tr -d '\"' | sed 's:/*$::')/rest/people?limit=1"
```

| Résultat | Signification | Fix |
|----------|--------------|-----|
| HTTP 200 | Connexion OK | Le problème est ailleurs |
| HTTP 401 | Clé invalide/expirée | Régénérer dans Twenty > Settings > API Keys |
| HTTP 403 | Permissions insuffisantes | Vérifier le workspace |
| HTTP 404 | URL incorrecte | Vérifier `TWENTY_API_URL` |
| Timeout | Serveur injoignable | Vérifier le réseau / URL |

### Cause racine #4 : Secret écrasé par la Factory

**Diagnostic** :
```bash
# Vérifier que la clé API n'a pas été remplacée par un placeholder
grep TWENTY_API_KEY server/.env
# Si la valeur contient "...", "•••", ou "***" → C'est un placeholder !
```

**Fix** : Restaurer depuis le backup :
```bash
ls -la server/.env.backup.*
cp server/.env.backup.<PLUS_RECENT> server/.env
```

### Script de diagnostic automatique

```bash
# Exécuter le smoke test CRM complet
cd server
npx ts-node scripts/crm-smoke-test.ts

# Avec un push de test réel
npx ts-node scripts/crm-smoke-test.ts --push
```

```powershell
# PowerShell
.\scripts\factory-smoke.ps1
.\scripts\factory-smoke.ps1 -LivePush
```

### Arbre de décision complet

```
Le push CRM ne fonctionne pas
│
├─ 1. CRM_PROVIDER=none ?
│     └─ FIX: CRM_PROVIDER=twenty dans server/.env
│
├─ 2. Lead incomplet (isComplete=false) ?
│     └─ Vérifier BOT_DOMAIN + contrat + prompt
│
├─ 3. Score trop bas (score < minScore) ?
│     └─ Vérifier CRM_MIN_PUSH_SCORE (défaut: 60)
│
├─ 4. Push tenté mais échec HTTP ?
│     └─ Vérifier TWENTY_API_KEY + TWENTY_API_URL
│
├─ 5. Push "réussi" mais pas de record dans Twenty ?
│     └─ Vérifier workspaceId (JWT) et instance URL
│
└─ 6. Secret écrasé par Factory ?
      └─ Restaurer depuis server/.env.backup.*
```

---

## ⚡ DIAGNOSTIC RAPIDE (Factory UI)

### Symptôme 1 : Factory UI ne se charge pas (404/500)

**URL testée** : `http://localhost:3001/factory`

**Causes possibles** :
1. Serveur non démarré
2. Port 3001 occupé
3. Routes factory non montées

**Solutions** :
```bash
# 1. Vérifier que le serveur tourne
curl http://localhost:3001/health

# 2. Vérifier les logs au démarrage
cd server
npm run dev
# Chercher : "✓ Factory routes mounted at /factory"

# 3. Vérifier le port
netstat -ano | findstr :3001  # Windows
lsof -i :3001                  # Linux/Mac
```

---

### Symptôme 2 : Erreur "No profile configured"

**Logs** :
```
[ProfileLoader] No profile configured. Set BOT_PROFILE or BOT_DOMAIN in .env
```

**Cause** : `.env` ne contient ni `BOT_PROFILE` ni `BOT_DOMAIN`

**Solution** :
```bash
# Ajouter dans server/.env
BOT_PROFILE=garage_motrio  # Recommandé
# OU
BOT_DOMAIN=garage           # Legacy
```

---

### Symptôme 3 : Build échoue avec "Config schema validation failed"

**Logs** :
```
❌ Step 1: Config Schema Validation → FAILURE
Schema validation failed: COMPANY_NAME is required
```

**Cause** : Champs obligatoires manquants dans la config

**Solution** :
```bash
# Vérifier server/.env contient au minimum :
COMPANY_NAME="..."
COMPANY_WEBSITE="..."
BOT_DOMAIN="..." (ou BOT_PROFILE)
```

---

### Symptôme 4 : "CRM connection test failed"

**Logs** :
```
❌ Step 3: CRM Connection Test → FAILURE
CRM_PROVIDER=twenty but TWENTY_API_KEY is missing
```

**Cause** : CRM activé mais non configuré

**Solution** :
```bash
# Option 1 : Désactiver le CRM pour tester
CRM_PROVIDER=none

# Option 2 : Configurer le CRM
CRM_PROVIDER=twenty
TWENTY_API_KEY=your_api_key
TWENTY_API_URL=https://app.oraclesentinel.com/
```

---

### Symptôme 5 : XML Upload échoue "Size exceeds max"

**Logs** :
```
XML size 25.3MB exceeds max 20MB (KNOWLEDGE_XML_MAX_SIZE_MB)
```

**Cause** : Fichier XML trop volumineux

**Solution** :
```bash
# Augmenter la limite dans server/.env
KNOWLEDGE_XML_MAX_SIZE_MB=50

# Ou compresser le XML avant upload
```

---

### Symptôme 6 : Le bot demande les mauvaises questions (mélange de domaines)

**Exemple** : Bot garage demande "achat/vente/location"

**Cause** : Domain contract incorrect ou confusion profile/domain

**Diagnostic** :
```bash
# 1. Vérifier le profil actif
grep "BOT_PROFILE\|BOT_DOMAIN" server/.env

# 2. Chercher dans les logs au démarrage :
[ProfileLoader] Active profile: ...
[QualificationService] Domain: Garage Automobile

# 3. Si Domain = "Immobilier" mais profil = "garage" → BUG
```

**Solution** :
```bash
# S'assurer que BOT_PROFILE ou BOT_DOMAIN est correct
BOT_PROFILE=garage_motrio  # Doit pointer vers profiles/garage_motrio.json
```

---

### Symptôme 7 : Build réussit mais iframe ne fonctionne pas

**Logs** :
```
✅ Build SUCCESS → Production Ready: true
```
**Mais** : Iframe ne charge rien ou erreur CORS

**Diagnostic** :
```bash
# 1. Vérifier le mode embed
grep "FACTORY_EMBED_MODE" server/.env
# Doit être : hosted | bundle

# 2. Vérifier les origins autorisés
grep "WIDGET_ALLOWED_ORIGINS" server/.env

# 3. Tester l'iframe manuellement
curl http://localhost:3001/widget/embed?tenant=default
```

**Solution** :
```bash
# Ajouter votre origin
WIDGET_ALLOWED_ORIGINS="http://localhost:5173,http://localhost:3001"
```

---

### Symptôme 8 : Logs Factory vides ou manquants

**Problème** : `GET /api/factory/logs` retourne `[]`

**Cause** : Aucune action Factory n'a été loggée

**Solution** :
```bash
# 1. Déclencher un build pour générer des logs
curl -X POST http://localhost:3001/api/factory/build \
  -H "Content-Type: application/json"

# 2. Vérifier les logs
curl http://localhost:3001/api/factory/logs?limit=50

# 3. Filtrer par niveau
curl http://localhost:3001/api/factory/logs?level=error
```

---

### Symptôme 9 : Smoke test échoue "Server not accessible"

**Script** : `.\scripts\factory-smoke.ps1` ou `npx tsx server/scripts/factory-smoke.ts`

**Erreur** :
```
❌ Server not accessible at http://localhost:3001
```

**Cause** : Serveur non démarré

**Solution** :
```bash
# Terminal 1 : Démarrer le serveur
cd server
npm run dev

# Terminal 2 : Lancer le smoke test
.\scripts\factory-smoke.ps1  # Windows
# OU
npx tsx server/scripts/factory-smoke.ts  # Cross-platform
```

---

### Symptôme 10 : "Database connection failed"

**Logs** :
```
❌ Step X: Database Check → FAILURE
Database health check failed: connect ECONNREFUSED
```

**Cause** : PostgreSQL non démarré ou DATABASE_URL incorrect

**Solution** :
```bash
# 1. Vérifier PostgreSQL tourne
# Windows : Services → PostgreSQL
# Linux : sudo systemctl status postgresql

# 2. Vérifier DATABASE_URL
grep "DATABASE_URL" server/.env
# Format attendu : postgres://user:password@localhost:5432/chatbot

# 3. Tester la connexion
psql -U postgres -d chatbot -c "SELECT 1"
```

---

## 🔍 COMMANDES UTILES DE DIAGNOSTIC

```bash
# Vérifier la config actuelle
curl http://localhost:3001/api/factory/config | jq .

# Vérifier la readiness
curl http://localhost:3001/api/factory/readiness | jq .

# Vérifier l'observabilité (CRM, DB, LLM)
curl http://localhost:3001/api/factory/observability | jq .

# Récupérer les derniers logs
curl http://localhost:3001/api/factory/logs?limit=20 | jq .

# Tester le LLM
curl -X POST http://localhost:3001/api/factory/test/llm

# Vérifier le profil actif
cd server && npm run dev 2>&1 | grep "ProfileLoader\|QualificationService"
```

---

## 📋 CHECKLIST PRÉ-BUILD

Avant de lancer un build, vérifiez :

- [ ] `server/.env` existe et est complet
- [ ] `BOT_PROFILE` ou `BOT_DOMAIN` est défini
- [ ] `COMPANY_NAME`, `COMPANY_WEBSITE` sont renseignés
- [ ] PostgreSQL est démarré et accessible
- [ ] LLM provider est configuré (GROQ_API_KEY ou autre)
- [ ] CRM est soit désactivé (`CRM_PROVIDER=none`) soit correctement configuré
- [ ] Le serveur démarre sans erreur : `npm run dev`
- [ ] `/factory` est accessible : `curl http://localhost:3001/factory`

---

## 🚨 RESET COMPLET (EN CAS DE BLOCAGE)

Si rien ne fonctionne, reset complet :

```bash
# 1. Arrêter le serveur
pkill -f "node.*server" # Linux/Mac
taskkill /F /IM node.exe # Windows

# 2. Nettoyer les builds précédents
rm -rf server/.env.backup.*
rm -rf server/dist

# 3. Réinstaller les dépendances
cd server
rm -rf node_modules package-lock.json
npm install

# 4. Copier .env.example vers .env
cp .env.example .env

# 5. Configurer BOT_PROFILE
echo "BOT_PROFILE=garage_motrio" >> .env

# 6. Redémarrer proprement
npm run dev
```

---

## 📞 SUPPORT

Si le problème persiste :

1. **Collecter les logs** :
   ```bash
   curl http://localhost:3001/api/factory/logs?limit=200 > factory-logs.json
   ```

2. **Vérifier les issues GitHub** :
   https://github.com/anthropics/oraclesentinel/issues

3. **Créer une issue** avec :
   - Logs complets
   - Fichier `.env` (masquer les secrets)
   - Version Node.js : `node --version`
   - OS : Windows/Linux/Mac

---

**🎓 Autres guides** : `GUIDE_PROFILS.md` | `GUIDE_CHANGEMENT_DOMAINE.md`
