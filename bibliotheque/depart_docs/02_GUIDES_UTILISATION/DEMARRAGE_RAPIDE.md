# ⚡ Démarrage Rapide - Tests Automatisés

## 🎯 Objectif
Diagnostiquer et corriger automatiquement les bugs du chatbot en 5 minutes.

---

## 🚀 Étapes (5 minutes)

### 1️⃣ Vérifier Groq (30 secondes)
```bash
cd server
npx ts-node test/test-groq-connection.ts
```

**Résultat attendu** :
```
✅ ALL TESTS PASSED
🎯 Groq is ready for automated testing!
```

**Si échec** : Vérifier `GROQ_API_KEY` dans `server/.env`

---

### 2️⃣ Démarrer le serveur (Terminal 1)
```bash
cd server
npm run dev
```

**Résultat attendu** :
```
Server running on port 3001
```

**Laisser tourner** (ne pas fermer ce terminal)

---

### 3️⃣ Lancer les tests (Terminal 2)
```bash
# Option A : Script automatique (recommandé)
test-complet.bat

# Option B : Manuel
cd server
npx ts-node test/automated-bot-testing.ts
```

**Durée** : 2-3 minutes

---

### 4️⃣ Analyser les résultats

#### ✅ Succès (100%)
```
Total Tests: 6
Successful: 6/6 (100.0%)
Pushed to CRM: 6/6 (100.0%)
Average Score: 85.5/100

✅ All tests passed!
```

**Action** : Bot corrigé ! Passer aux tests manuels avec le frontend.

---

#### ❌ Échecs
```
Total Tests: 6
Successful: 4/6 (66.7%)
Pushed to CRM: 3/6 (50.0%)

❌ Impatient User
   Score: 45/100
   Missing: numero_telephone, adresse
```

**Action** : Lire les logs détaillés et consulter `DIAGNOSTIC_BOT.md`

---

## 🆘 Problèmes Fréquents

### ❌ "Cannot connect to server"
```bash
# Solution : Démarrer le serveur
cd server
npm run dev
```

### ❌ "GROQ_API_KEY not set"
```bash
# Solution : Ajouter dans server/.env
GROQ_API_KEY=votre_clé_ici
```

### ❌ "Rate limit exceeded"
```bash
# Solution : Attendre 1 minute
# Groq gratuit : 30 requêtes/minute
```

---

## 📚 Documentation Complète

| Fichier | Description |
|---------|-------------|
| **DEMARRAGE_RAPIDE.md** | Ce fichier (démarrage en 5 min) |
| **SOLUTION_COMPLETE.md** | Vue d'ensemble complète |
| **DIAGNOSTIC_BOT.md** | Analyse détaillée des bugs |
| **GUIDE_TESTS.md** | Guide complet des tests |
| **README_TESTS.md** | Documentation technique |
| **SECURITE_CHATBOT.md** | Best practices sécurité |

---

## 🎯 Checklist Rapide

- [ ] Groq fonctionne (`test-groq-connection.ts`)
- [ ] Serveur démarré (`npm run dev`)
- [ ] Tests lancés (`test-complet.bat`)
- [ ] Résultats analysés
- [ ] 100% de succès obtenu
- [ ] Tests manuels effectués
- [ ] Airtable vérifié

---

## 💡 Commandes Utiles

```bash
# Vérifier Groq
cd server && npx ts-node test/test-groq-connection.ts

# Vérifier système
cd server && npx ts-node test/pre-flight-check.ts

# Test rapide (1 scénario)
cd server && npx ts-node test/quick-test.ts

# Test complet (6 profils)
cd server && npx ts-node test/automated-bot-testing.ts

# Ou simplement
test-complet.bat
```

---

## 🚀 Prochaines Étapes

1. ✅ Tests automatisés passent (100%)
2. 🧪 Tests manuels avec le frontend
3. 📊 Vérifier Airtable (données reçues)
4. 🚀 Déployer en production
5. 📈 Monitorer les logs

---

**Temps total : 5 minutes**  
**Résultat : Bot corrigé et validé**

**Bonne chance ! 🎉**
