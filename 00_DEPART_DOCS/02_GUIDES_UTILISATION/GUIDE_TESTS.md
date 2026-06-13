# 🧪 Guide de Tests Automatisés du Chatbot

## 🚀 Démarrage Rapide

### 1. Vérifier que tout est prêt
```bash
cd server
npx ts-node test/pre-flight-check.ts
```

✅ Si tout est OK, passez à l'étape 2
❌ Si des erreurs, corrigez-les avant de continuer

### 2. Lancer le serveur (dans un terminal séparé)
```bash
cd server
npm run dev
```

Attendez de voir : `Server running on port 3001`

### 3. Lancer les tests automatisés
```bash
cd server
npx ts-node test/automated-bot-testing.ts
```

Ou double-cliquez sur : `server/test-bot.bat`

---

## 📋 Types de Tests Disponibles

### 🔍 Pre-Flight Check (Vérification système)
**Quand l'utiliser** : Avant de lancer les tests
**Durée** : ~5 secondes
**Commande** :
```bash
cd server
npx ts-node test/pre-flight-check.ts
```

**Ce qu'il vérifie** :
- ✅ Serveur accessible
- ✅ Variables d'environnement configurées
- ✅ Clés API présentes

---

### ⚡ Quick Test (Test rapide)
**Quand l'utiliser** : Pour tester rapidement un scénario spécifique
**Durée** : ~10 secondes
**Commande** :
```bash
cd server
npx ts-node test/quick-test.ts
```

**Ce qu'il teste** :
- Scénario "Impatient User" (toutes les infos d'un coup)
- Vérification de l'extraction
- Vérification du push Airtable

---

### 🧪 Full Test Suite (Suite complète)
**Quand l'utiliser** : Pour valider tous les comportements
**Durée** : ~2-3 minutes
**Commande** :
```bash
cd server
npx ts-node test/automated-bot-testing.ts
```

**Ce qu'il teste** :
- 6 profils utilisateurs différents
- Tous les comportements émotionnels
- Extraction de données
- Push Airtable
- Rapport détaillé

---

## 📊 Interpréter les Résultats

### Exemple de Sortie Réussie
```
═══════════════════════════════════════════════════════════════════════
📊 SUMMARY REPORT
═══════════════════════════════════════════════════════════════════════

Total Tests: 6
Successful: 6/6 (100.0%)
Pushed to CRM: 6/6 (100.0%)
Average Score: 85.5/100
Total Duration: 45.23s

─────────────────────────────────────────────────────────────────────
DETAILED RESULTS:

✅ 📤 Cooperative User
   Score: 90/100
   Missing: None

✅ 📤 Impatient User
   Score: 85/100
   Missing: None

✅ 📤 Verbose User
   Score: 88/100
   Missing: None

✅ 📤 Minimal User
   Score: 75/100
   Missing: None

✅ 📤 Confused User
   Score: 80/100
   Missing: None

✅ 📤 Angry User
   Score: 95/100
   Missing: None

═══════════════════════════════════════════════════════════════════════

✅ All tests passed!
```

### Exemple de Sortie avec Échecs
```
❌ ⏸️ Impatient User
   Score: 45/100
   Missing: numero_telephone, adresse
   
❌ ⏸️ Verbose User
   Score: 30/100
   Missing: prenom, nom, numero_telephone
```

**Que faire ?**
1. Lire les logs détaillés dans la console
2. Identifier quel champ n'a pas été extrait
3. Vérifier le prompt système ou le prompt d'extraction
4. Relancer les tests

---

## 🔧 Résolution de Problèmes

### ❌ "Cannot connect to http://localhost:3001"
**Cause** : Le serveur n'est pas démarré
**Solution** :
```bash
cd server
npm run dev
```

### ❌ "GROQ_API_KEY is not set"
**Cause** : Variable d'environnement manquante
**Solution** : Vérifier `server/.env` et ajouter :
```env
GROQ_API_KEY=votre_clé_ici
```

### ❌ "Rate limit exceeded"
**Cause** : Trop de requêtes Groq
**Solution** : Attendre 1 minute et relancer

### ⚠️ "Test passed but not pushed to CRM"
**Cause** : Score trop bas ou champs manquants
**Solution** : Vérifier les logs de qualification

### ❌ "All tests failed"
**Cause** : Problème système (DB, API, etc.)
**Solution** : Lancer le pre-flight check
```bash
cd server
npx ts-node test/pre-flight-check.ts
```

---

## 📈 Améliorer les Résultats

### Si le score est trop bas (<70)
1. Vérifier que le prompt système guide bien la conversation
2. Vérifier que toutes les questions sont posées
3. Ajuster `AIRTABLE_MIN_SCORE` dans `.env` si nécessaire

### Si des champs sont manquants
1. Lire les logs `📊 QUALIFICATION REPORT`
2. Vérifier le prompt d'extraction dans `qualification.service.ts`
3. Ajouter des exemples d'extraction si nécessaire

### Si le bot redemande des infos déjà données
1. Vérifier le prompt système dans `prompts.ts`
2. S'assurer que la section "GESTION DES PAVÉS" est claire
3. Ajouter des exemples concrets

---

## 🎯 Checklist Avant Production

- [ ] Pre-flight check passe sans erreurs
- [ ] Quick test réussit (score ≥ 70, tous les champs)
- [ ] Full test suite réussit (100% de succès)
- [ ] Tous les profils poussent vers Airtable
- [ ] Aucune erreur dans les logs serveur
- [ ] Test manuel avec le frontend
- [ ] Vérification Airtable (données reçues correctement)

---

## 📞 Support

### Logs à Consulter
1. **Console des tests** : Résultats détaillés
2. **Logs serveur** : `📊 QUALIFICATION REPORT`
3. **Logs Airtable** : `🚀 Pushing qualified lead`

### Fichiers Importants
- `server/src/core/prompts.ts` : Prompt système
- `server/src/services/qualification.service.ts` : Extraction LLM
- `server/src/services/chat.service.ts` : Logique de qualification
- `server/.env` : Configuration

### Documentation
- `DIAGNOSTIC_BOT.md` : Rapport de diagnostic complet
- `GUIDE_TESTS.md` : Ce guide
- `README.md` : Documentation générale

---

## 🚀 Prochaines Étapes

1. **Lancer le pre-flight check**
2. **Démarrer le serveur**
3. **Lancer les tests automatisés**
4. **Analyser les résultats**
5. **Corriger si nécessaire**
6. **Relancer jusqu'à 100% de succès**
7. **Tester manuellement avec le frontend**
8. **Déployer en production**

**Bon courage ! 💪**
