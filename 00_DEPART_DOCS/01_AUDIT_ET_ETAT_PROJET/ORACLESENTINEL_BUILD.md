# 🚀 ORACLESENTINEL BUILD - GUIDE COMPLET

## 📋 RÉSUMÉ

Ce build configure le chatbot OracleSentinel/TS Industry avec les prompts stratégiques basés sur le dossier de présentation TS Industry.

---

## ✅ CONFIGURATION TERMINÉE

### 1. Domain Contract OracleSentinel ✅
**Fichier** : `server/src/services/qualification.service.ts`
- Ajout du domaine `oraclesentinel` avec tous les champs requis
- Scoring adapté B2B (email obligatoire, besoin pondéré 20 pts)
- TypeNormalizer pour les types de projets TS Industry

### 2. System Prompt TS Industry ✅
**Fichier** : `server/src/core/prompts.ts`
- Prompt complet avec pitch TS Industry
- Persona : Assistant Stratégique Expert
- Checklist adaptée : type, besoin, email, téléphone, localisation
- ROI et méthodologie intégrés dans le prompt

### 3. Configuration .env ✅
**Fichier** : `ORACLESENTINEL_CONFIG.txt`
- Toutes les variables nécessaires configurées
- Variables dynamiques VAR_* pour injection automatique
- Configuration CRM et Widget

---

## 🔧 ÉTAPES DE DÉPLOIEMENT

### ÉTAPE 1 : Appliquer la configuration .env

1. Ouvrir `server/.env`
2. Copier le contenu de `ORACLESENTINEL_CONFIG.txt`
3. Remplacer les lignes correspondantes dans `.env`
4. **IMPORTANT** : Conserver vos clés API existantes (GROQ_API_KEY, AIRTABLE_WEBHOOK_URL, DATABASE_URL)

**Lignes clés à modifier** :
```bash
BOT_DOMAIN=oraclesentinel
COMPANY_NAME="TS Industry"
FACTORY_AGENT_NAME="OracleSentinel Assistant"
# ... (voir ORACLESENTINEL_CONFIG.txt pour tout)
```

### ÉTAPE 2 : Redémarrer le serveur

```bash
cd server
npm run dev
```

Vérifier les logs :
```
[Prompts] Domain prompt selected: oraclesentinel (OracleSentinel / TS Industry)
[QualificationService] Domain: OracleSentinel / TS Industry
```

### ÉTAPE 3 : Tester le bot

```bash
# Terminal 1 : Serveur
cd server
npm run dev

# Terminal 2 : Test
npm run dev  # Frontend
```

Ouvrir : http://localhost:5173

Test conversation :
```
Vous : "Bonjour"
Bot : "Bonjour, quel est le principal défi opérationnel de votre entreprise ?"

Vous : "Nous avons 50 employés et perdons trop de temps en prospection"
Bot : "Compris. Quels processus consomment le plus de temps ? Prospection, reporting, ou suivi client ?"
```

### ÉTAPE 4 : Build de production

```bash
# Frontend
npm run build

# Backend
cd server
npm run build
```

---

## 🎯 BALISE IFRAME FINALE

### Version simple (recommandée)

```html
<iframe 
  src="https://oraclesentinel.com/embed?widget_id=oraclesentinel"
  width="100%" 
  height="600" 
  frameborder="0"
  allow="clipboard-write"
  style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
</iframe>
```

### Version avec personnalisation

```html
<iframe 
  src="https://oraclesentinel.com/embed?widget_id=oraclesentinel&theme=dark"
  width="100%" 
  height="600" 
  frameborder="0"
  allow="clipboard-write"
  style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
</iframe>
```

### Version responsive

```html
<div style="width: 100%; max-width: 800px; margin: 0 auto;">
  <iframe 
    src="https://oraclesentinel.com/embed?widget_id=oraclesentinel"
    width="100%" 
    height="600" 
    frameborder="0"
    allow="clipboard-write"
    style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
  </iframe>
</div>
```

---

## 📊 COMPARAISON AVANT / APRÈS

### Avant (Garage Motrio)
- Persona : Mécanicien expert
- Questions : type d'intervention, véhicule, symptôme
- Domain : Garage automobile

### Après (OracleSentinel)
- Persona : Assistant Stratégique Expert
- Questions : taille entreprise, défis opérationnels, ambitions
- Domain : Cabinet conseil IA/Automatisation
- Pitch TS Industry intégré
- ROI et méthodologie dans le prompt

---

## 🧪 TESTS AUTOMATISÉS

```bash
cd server
npx ts-node test/automated-bot-testing.ts
```

Résultats attendus :
```
Total Tests: 6
Successful: 6/6 (100.0%)
Pushed to CRM: 6/6 (100.0%)
Average Score: 85.5/100
```

---

## 🔐 SÉCURITÉ

- ✅ Validation Zod sur tous les inputs
- ✅ Anti-prompt injection
- ✅ Rate limiting (100 req/15min)
- ✅ CORS strict
- ✅ JWT auth pour widget

---

## 📞 SUPPORT

En cas de problème :
1. Vérifier les logs du serveur
2. Vérifier que `BOT_DOMAIN=oraclesentinel` dans `.env`
3. Vérifier que les variables `VAR_*` sont configurées
4. Redémarrer le serveur

---

## 🎉 RÉSUMÉ FINAL

**Pour utiliser OracleSentinel :**

1. Copier `ORACLESENTINEL_CONFIG.txt` → `server/.env`
2. Redémarrer le serveur : `cd server && npm run dev`
3. Copier la balise iframe ci-dessus
4. Coller dans votre projet

**C'est tout !** 🚀

Le bot OracleSentinel est maintenant configuré avec :
- ✅ Domain Contract complet
- ✅ System Prompt TS Industry
- ✅ Variables dynamiques injectées
- ✅ Widget mapping configuré
- ✅ Balise iframe prête à l'emploi
