# 🔍 Diagnostic du Chatbot - Rapport de Tests

## 📋 Problèmes Identifiés

### 1. **Bug Principal : Perte d'informations avec pavés de texte**
- **Symptôme** : Quand l'utilisateur envoie toutes les infos d'un coup (nom, prénom, téléphone, besoin), le bot oublie de demander certains champs
- **Impact** : Lead incomplet → Pas d'envoi vers Airtable
- **Cause probable** : Prompt système pas assez explicite sur la gestion des pavés

### 2. **Bug Secondaire : Clôture prématurée**
- **Symptôme** : Le bot dit "au revoir" avant d'avoir collecté toutes les infos
- **Impact** : Conversation interrompue, lead perdu
- **Cause probable** : Pas de checklist stricte dans le prompt

### 3. **Bug Tertiaire : Crash avec trop de texte**
- **Symptôme** : Le bot ne répond plus ou donne une réponse incohérente
- **Impact** : Mauvaise expérience utilisateur
- **Cause probable** : Extraction LLM qui échoue sur les longs textes

---

## ✅ Solutions Implémentées

### 1. **Prompt Système Renforcé** (`server/src/core/prompts.ts`)
- ✅ Ajout d'une section "GESTION DES PAVÉS D'INFORMATIONS"
- ✅ Checklist obligatoire avant clôture
- ✅ Instructions explicites : "NE REDEMANDE JAMAIS ce qui a déjà été donné"
- ✅ Exemples concrets de bonne gestion

### 2. **Extraction LLM Améliorée** (`server/src/services/qualification.service.ts`)
- ✅ Prompt d'extraction plus détaillé avec exemples
- ✅ Normalisation automatique des données (téléphone, type de projet)
- ✅ Logs détaillés pour debugging
- ✅ Meilleure gestion des erreurs

### 3. **Validation Stricte Avant Push CRM** (`server/src/services/chat.service.ts`)
- ✅ Vérification explicite de TOUS les champs requis
- ✅ Logs détaillés de qualification à chaque message
- ✅ Pas d'envoi Airtable si un seul champ manque

### 4. **Suite de Tests Automatisés** (`server/test/automated-bot-testing.ts`)
- ✅ 6 profils utilisateurs différents
- ✅ Tests de tous les comportements (coopératif, impatient, verbeux, minimal, confus, énervé)
- ✅ Rapport détaillé avec taux de succès
- ✅ Validation automatique des champs collectés

---

## 🧪 Comment Lancer les Tests

### Test Complet (tous les profils)
```bash
cd server
npx ts-node test/automated-bot-testing.ts
```

Ou double-cliquez sur : `server/test-bot.bat`

### Test Rapide (un seul scénario)
```bash
cd server
npx ts-node test/quick-test.ts
```

---

## 📊 Profils de Test

| Profil | Comportement | Objectif du Test |
|--------|--------------|------------------|
| **Cooperative User** | Répond clairement à chaque question | Vérifier le flux normal |
| **Impatient User** | Donne tout d'un coup | **Tester le bug principal** |
| **Verbose User** | Long pavé avec beaucoup de détails | Tester l'extraction sur texte long |
| **Minimal User** | Réponses très courtes | Tester la patience du bot |
| **Confused User** | Hésite, change d'avis | Tester la gestion des contradictions |
| **Angry User** | Frustré, exigeant | Tester la gestion émotionnelle |

---

## 🎯 Critères de Succès

Pour qu'un test soit considéré comme réussi :

1. ✅ **Tous les champs requis collectés** :
   - Prénom
   - Nom
   - Numéro de téléphone
   - Type de projet (Achat/Vente/Location)
   - Besoin (T2, T3, maison, etc.)
   - Adresse/Secteur

2. ✅ **Score de qualification ≥ 70/100**

3. ✅ **Lead envoyé vers Airtable**

4. ✅ **Pas d'erreurs pendant la conversation**

5. ✅ **Conversation fluide** (pas de questions répétées)

---

## 📈 Résultats Attendus

### Avant les corrections :
- ❌ Impatient User : ÉCHEC (oublie des champs)
- ❌ Verbose User : ÉCHEC (crash ou extraction partielle)
- ⚠️ Autres profils : Succès partiel

### Après les corrections :
- ✅ Tous les profils : SUCCÈS
- ✅ Taux de réussite : 100%
- ✅ Tous les leads envoyés vers Airtable

---

## 🔧 Prochaines Étapes

1. **Lancer les tests automatisés**
   ```bash
   cd server
   npx ts-node test/automated-bot-testing.ts
   ```

2. **Analyser les résultats**
   - Vérifier le taux de succès
   - Identifier les profils qui échouent encore
   - Lire les logs détaillés

3. **Ajuster si nécessaire**
   - Si un profil échoue, ajuster le prompt système
   - Si l'extraction échoue, améliorer le prompt d'extraction
   - Si la validation échoue, renforcer les checks

4. **Tests manuels complémentaires**
   - Tester avec le vrai frontend
   - Vérifier l'envoi Airtable
   - Valider l'expérience utilisateur

---

## 📝 Notes Importantes

### Limites Groq
- **Rate Limit** : ~30 requêtes/minute (gratuit)
- **Tokens** : 6000 tokens/minute
- **Solution** : Les tests incluent des délais (1-2s entre messages)

### Variables d'Environnement Critiques
```env
GROQ_API_KEY=votre_clé
GROQ_MODEL=llama-3.3-70b-versatile
AIRTABLE_WEBHOOK_URL=votre_webhook
AIRTABLE_ENABLED=true
AIRTABLE_MIN_SCORE=30
```

### Logs à Surveiller
- `📊 QUALIFICATION REPORT` : Détails de chaque qualification
- `🚀 Pushing qualified lead to Airtable` : Tentative d'envoi CRM
- `✅ Lead pushed to Airtable successfully` : Succès
- `❌ Error` : Échec (à investiguer)

---

## 🆘 Troubleshooting

### Le bot ne répond pas
- ✅ Vérifier que le serveur tourne (`npm run dev` dans `server/`)
- ✅ Vérifier `GROQ_API_KEY` dans `.env`
- ✅ Vérifier les logs serveur

### Les tests échouent tous
- ✅ Vérifier la connexion API (`http://localhost:3001/health`)
- ✅ Vérifier la base de données PostgreSQL
- ✅ Vérifier les credentials Groq

### Le bot oublie encore des infos
- ✅ Lire les logs `📊 QUALIFICATION REPORT`
- ✅ Vérifier que l'extraction LLM fonctionne
- ✅ Ajuster le prompt d'extraction si nécessaire

### Pas d'envoi Airtable
- ✅ Vérifier `AIRTABLE_ENABLED=true`
- ✅ Vérifier le webhook URL
- ✅ Vérifier que le score ≥ `AIRTABLE_MIN_SCORE`
- ✅ Vérifier que TOUS les champs requis sont présents

---

## 📞 Contact

Pour toute question ou problème :
1. Lire les logs détaillés
2. Vérifier ce document
3. Lancer les tests automatisés
4. Analyser les résultats

**Bonne chance ! 🚀**
