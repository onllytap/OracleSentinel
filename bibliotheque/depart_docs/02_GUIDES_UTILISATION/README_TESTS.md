# 🧪 Système de Tests Automatisés du Chatbot

## 🎯 Objectif

Ce système permet de **diagnostiquer et corriger automatiquement** les bugs du chatbot, notamment :
- ❌ Perte d'informations quand l'utilisateur donne tout d'un coup
- ❌ Clôture prématurée de la conversation
- ❌ Crash avec trop de texte
- ❌ Oubli de demander certains champs

## 🚀 Démarrage Ultra-Rapide

### Option 1 : Script Automatique (Recommandé)
1. **Démarrer le serveur** (terminal 1) :
   ```bash
   cd server
   npm run dev
   ```

2. **Lancer les tests** (terminal 2) :
   - Double-cliquez sur `test-complet.bat`
   - OU exécutez :
   ```bash
   test-complet.bat
   ```

### Option 2 : Manuel
```bash
# Terminal 1 : Serveur
cd server
npm run dev

# Terminal 2 : Tests
cd server
npx ts-node test/pre-flight-check.ts
npx ts-node test/automated-bot-testing.ts
```

---

## 📁 Structure des Fichiers de Test

```
├── server/
│   ├── test/
│   │   ├── automated-bot-testing.ts    # Suite complète de tests
│   │   ├── quick-test.ts               # Test rapide (1 scénario)
│   │   └── pre-flight-check.ts         # Vérification système
│   └── test-bot.bat                    # Lanceur rapide
├── test-complet.bat                    # Script automatique complet
├── DIAGNOSTIC_BOT.md                   # Rapport de diagnostic
├── GUIDE_TESTS.md                      # Guide détaillé
└── README_TESTS.md                     # Ce fichier
```

---

## 🧪 Types de Tests

### 1. Pre-Flight Check ✈️
**Durée** : 5 secondes  
**Objectif** : Vérifier que tout est configuré correctement

```bash
cd server
npx ts-node test/pre-flight-check.ts
```

**Vérifie** :
- ✅ Serveur accessible
- ✅ Variables d'environnement
- ✅ Clés API

---

### 2. Quick Test ⚡
**Durée** : 10 secondes  
**Objectif** : Tester rapidement le scénario problématique

```bash
cd server
npx ts-node test/quick-test.ts
```

**Teste** :
- Utilisateur qui donne toutes les infos d'un coup
- Extraction des données
- Push vers Airtable

---

### 3. Full Test Suite 🎯
**Durée** : 2-3 minutes  
**Objectif** : Tester tous les comportements utilisateurs

```bash
cd server
npx ts-node test/automated-bot-testing.ts
```

**Teste 6 profils** :
1. **Cooperative** : Répond clairement
2. **Impatient** : Donne tout d'un coup ⚠️ (bug principal)
3. **Verbose** : Long pavé de texte ⚠️
4. **Minimal** : Réponses très courtes
5. **Confused** : Hésite, change d'avis
6. **Angry** : Frustré, exigeant

---

## 📊 Comprendre les Résultats

### ✅ Test Réussi
```
✅ 📤 Impatient User
   Score: 85/100
   Missing: None
   Pushed to CRM: ✓
```

**Signification** :
- ✅ Tous les champs collectés
- 📤 Lead envoyé vers Airtable
- Score ≥ 70

---

### ❌ Test Échoué
```
❌ ⏸️ Impatient User
   Score: 45/100
   Missing: numero_telephone, adresse
   Pushed to CRM: ✗
```

**Signification** :
- ❌ Champs manquants
- ⏸️ Pas envoyé vers Airtable
- Score < 70

**Action** : Lire les logs détaillés et corriger le prompt

---

### ⚠️ Test Partiel
```
✅ ⏸️ Verbose User
   Score: 65/100
   Missing: None
   Pushed to CRM: ✗
```

**Signification** :
- ✅ Tous les champs collectés
- ⏸️ Mais score trop bas (< 70)
- Pas envoyé vers Airtable

**Action** : Ajuster `AIRTABLE_MIN_SCORE` ou améliorer la qualification

---

## 🔧 Corrections Implémentées

### 1. Prompt Système Renforcé
**Fichier** : `server/src/core/prompts.ts`

**Améliorations** :
- ✅ Section "GESTION DES PAVÉS D'INFORMATIONS"
- ✅ Checklist obligatoire avant clôture
- ✅ Instructions : "NE REDEMANDE JAMAIS ce qui a déjà été donné"
- ✅ Exemples concrets

**Avant** :
```
Le bot redemandait le nom même si déjà donné
```

**Après** :
```
Le bot accuse réception et demande uniquement ce qui manque
```

---

### 2. Extraction LLM Améliorée
**Fichier** : `server/src/services/qualification.service.ts`

**Améliorations** :
- ✅ Prompt d'extraction plus détaillé
- ✅ Normalisation automatique (téléphone, type)
- ✅ Logs détaillés pour debugging
- ✅ Meilleure gestion des erreurs

**Avant** :
```
Extraction partielle sur les pavés de texte
```

**Après** :
```
Extraction complète même avec beaucoup de texte
```

---

### 3. Validation Stricte
**Fichier** : `server/src/services/chat.service.ts`

**Améliorations** :
- ✅ Vérification explicite de TOUS les champs
- ✅ Logs détaillés à chaque message
- ✅ Pas d'envoi Airtable si incomplet

**Avant** :
```
Envoi Airtable même si champs manquants
```

**Après** :
```
Envoi UNIQUEMENT si 100% complet
```

---

## 📈 Résultats Attendus

### Avant Corrections
```
Total Tests: 6
Successful: 2/6 (33.3%)
Pushed to CRM: 1/6 (16.7%)
Average Score: 45.2/100
```

### Après Corrections
```
Total Tests: 6
Successful: 6/6 (100.0%)
Pushed to CRM: 6/6 (100.0%)
Average Score: 85.5/100
```

---

## 🎯 Checklist de Validation

Avant de considérer le bot comme "corrigé" :

- [ ] Pre-flight check passe sans erreurs
- [ ] Quick test réussit (score ≥ 70)
- [ ] Full test suite : 100% de succès
- [ ] Tous les profils poussent vers Airtable
- [ ] Aucune erreur dans les logs
- [ ] Test manuel avec le frontend
- [ ] Vérification Airtable (données correctes)

---

## 🆘 Problèmes Fréquents

### "Cannot connect to server"
```bash
# Solution : Démarrer le serveur
cd server
npm run dev
```

### "GROQ_API_KEY not set"
```bash
# Solution : Vérifier server/.env
GROQ_API_KEY=votre_clé_ici
```

### "Rate limit exceeded"
```bash
# Solution : Attendre 1 minute
# Groq gratuit : 30 req/min
```

### "Tests failed"
```bash
# Solution : Lire les logs détaillés
# Identifier quel champ manque
# Ajuster le prompt si nécessaire
```

---

## 📚 Documentation Complète

- **DIAGNOSTIC_BOT.md** : Analyse détaillée des bugs
- **GUIDE_TESTS.md** : Guide complet des tests
- **README_TESTS.md** : Ce fichier (vue d'ensemble)

---

## 🚀 Workflow Recommandé

1. **Lire** `DIAGNOSTIC_BOT.md` pour comprendre les bugs
2. **Lire** `GUIDE_TESTS.md` pour les détails techniques
3. **Lancer** `test-complet.bat` pour tester
4. **Analyser** les résultats
5. **Corriger** si nécessaire
6. **Relancer** jusqu'à 100% de succès
7. **Tester** manuellement avec le frontend
8. **Déployer** en production

---

## 💡 Conseils

### Pour Déboguer
1. Lire les logs `📊 QUALIFICATION REPORT`
2. Vérifier quel champ manque
3. Ajuster le prompt système ou d'extraction
4. Relancer les tests

### Pour Optimiser
1. Ajuster `AIRTABLE_MIN_SCORE` (défaut: 30)
2. Améliorer le prompt système
3. Ajouter des exemples d'extraction
4. Tester avec de vrais utilisateurs

### Pour Monitorer
1. Surveiller les logs serveur
2. Vérifier les envois Airtable
3. Analyser les scores de qualification
4. Identifier les patterns d'échec

---

## 📞 Support

### Logs Importants
- `📊 QUALIFICATION REPORT` : Détails de qualification
- `🚀 Pushing qualified lead` : Tentative d'envoi CRM
- `✅ Lead pushed successfully` : Succès
- `❌ Error` : Échec (à investiguer)

### Fichiers Clés
- `server/src/core/prompts.ts` : Prompt système
- `server/src/services/qualification.service.ts` : Extraction
- `server/src/services/chat.service.ts` : Logique
- `server/.env` : Configuration

---

## ✅ Prêt à Tester ?

```bash
# 1. Démarrer le serveur (terminal 1)
cd server
npm run dev

# 2. Lancer les tests (terminal 2)
test-complet.bat
```

**Bonne chance ! 🚀**
