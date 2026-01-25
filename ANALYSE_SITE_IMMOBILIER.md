# 🏠 Prompt Universel : Analyse de Site Immobilier pour Configuration Scraping

> **Objectif** : Ce prompt permet à une IA avec accès navigateur d'analyser n'importe quel site d'agence immobilière et de générer automatiquement la configuration nécessaire pour le scraper.

---

## 📋 INSTRUCTIONS POUR L'IA

Tu es un expert en analyse de sites web. Ta mission est d'analyser un site immobilier et d'extraire tous les sélecteurs CSS nécessaires pour automatiser la collecte de données.

---

## 🎯 ÉTAPE 1 : NAVIGATION INITIALE

### Actions à effectuer :

1. **Ouvre l'URL fournie** (page catalogue/liste des biens)
2. **Attends 5 secondes** pour le chargement JavaScript
3. **Gère les popups** :
   - Si bannière cookies → clique "Accepter" / "Tout accepter" / "Accept"
   - Si overlay/modal → clique le bouton de fermeture ou "Voir les biens"
4. **Scroll légèrement** pour déclencher le lazy-loading
5. **Capture un screenshot** de la page

### Informations à noter :

| Question | Ta réponse |
|----------|------------|
| URL analysée | |
| Nom de l'agence | |
| Texte du bouton cookies cliqué | |
| Texte du bouton overlay cliqué (si présent) | |
| La page utilise-t-elle du JavaScript pour charger les biens ? | Oui / Non |

---

## 🔍 ÉTAPE 2 : ANALYSE DES CARTES PRODUIT

### Instructions :

Ouvre les DevTools (F12) ou inspecte le DOM pour identifier les sélecteurs CSS.

Pour chaque carte de bien immobilier visible, trouve :

| Donnée | Comment la trouver | Sélecteur CSS |
|--------|-------------------|---------------|
| **Container de la carte** | L'élément parent qui contient toutes les infos d'un bien | |
| **Prix** | Généralement en gros, avec € | |
| **Surface** | Nombre suivi de m² ou m2 | |
| **Nombre de pièces** | "3 pièces", "T3", "3P" | |
| **Nombre de chambres** | "2 chambres", "2 ch" | |
| **Localisation** | Ville, quartier, code postal | |
| **Type de bien** | Appartement, Maison, Studio | |
| **Lien vers détail** | Le lien cliquable vers la fiche complète | |
| **Image** | L'image principale du bien | |

### Conseils pour trouver les sélecteurs :

```
✅ BON : .property-card, .listing-item, .bien-container
✅ BON : [data-listing], article.annonce
❌ MAUVAIS : div > div > div (trop fragile)
❌ MAUVAIS : .css-1abc23 (classe générée, instable)
```

---

## 📄 ÉTAPE 3 : ANALYSE DE LA PAGINATION

### Questions à répondre :

| Question | Ta réponse |
|----------|------------|
| Type de pagination | Numérotée / Bouton "Suivant" / Scroll infini |
| URL page 1 | |
| URL page 2 | |
| Pattern détecté | Ex: `?page=2` ou `/biens/2` ou `&offset=20` |

### Exemple de patterns courants :

```
https://site.com/biens?page={PAGE}
https://site.com/biens/{PAGE}
https://site.com/biens?offset={OFFSET}  (offset = (page-1) * items_per_page)
```

---

## 🏢 ÉTAPE 4 : ANALYSE PAGE DÉTAIL

### Instructions :

1. **Clique sur le premier bien** pour ouvrir sa page détail
2. **Attends le chargement complet**
3. **Capture un screenshot**
4. **Analyse le contenu** pour trouver :

| Donnée | Où la chercher | Sélecteur CSS ou Regex |
|--------|----------------|----------------------|
| **Étage** | "Rez-de-chaussée", "3ème étage", "Étage: 2" | |
| **Nombre d'étages immeuble** | "Dans immeuble de 5 étages" | |
| **Description complète** | Texte long décrivant le bien | |
| **Référence du bien** | "Réf: 12345", "ID: ABC123" | |
| **Caractéristiques** | Liste: ascenseur, parking, cave, etc. | |
| **DPE / Classe énergie** | A, B, C, D, E, F, G | |

### Regex utiles pour extraction texte :

```regex
# Étage
(?:situé au|niveau|étage)\s*:?\s*(rez-de-chaussée|rdc|\d+(?:er|ème|e)?\s*étage)

# Surface
(\d+)\s*m[²2]

# Pièces
(\d+)\s*pièces?

# Référence
(?:réf|ref|référence|id)\s*:?\s*(\w+)
```

---

## 📦 ÉTAPE 5 : GÉNÉRATION DE LA CONFIGURATION

### Remplis ce template avec tes trouvailles :

```env
# ═══════════════════════════════════════════════════════════════════════
# CONFIGURATION SCRAPER - [NOM DE L'AGENCE]
# Généré automatiquement par analyse IA
# Date: [DATE]
# ═══════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────
# IDENTITÉ DU SITE
# ─────────────────────────────────────────────────────────────────────────
SITE_NAME=[Nom de l'agence]
SITE_BASE_URL=[URL de base, ex: https://www.agence.com]
SITE_LISTING_URL=[URL du catalogue, ex: https://www.agence.com/vente/appartements/]

# ─────────────────────────────────────────────────────────────────────────
# PAGINATION
# ─────────────────────────────────────────────────────────────────────────
# Utilise {PAGE} comme placeholder pour le numéro de page
SITE_PAGINATION_PATTERN=[URL avec {PAGE}, ex: https://www.agence.com/biens?page={PAGE}]
SITE_MAX_PAGES=5

# ─────────────────────────────────────────────────────────────────────────
# SÉLECTEURS CSS - PAGE LISTE
# ─────────────────────────────────────────────────────────────────────────
SITE_CARD_SELECTOR=[ex: .property-card]
SITE_PRICE_SELECTOR=[ex: .price, .item__price]
SITE_SURFACE_SELECTOR=[ex: .surface, .area]
SITE_ROOMS_SELECTOR=[ex: .rooms, .pieces]
SITE_BEDROOMS_SELECTOR=[ex: .bedrooms, .chambres]
SITE_LOCATION_SELECTOR=[ex: .city, .location]
SITE_TYPE_SELECTOR=[ex: .property-type, .type]
SITE_LINK_SELECTOR=[ex: a.details, a.cta-secondary]
SITE_IMAGE_SELECTOR=[ex: img.main-photo, .thumbnail img]

# ─────────────────────────────────────────────────────────────────────────
# SÉLECTEURS CSS - PAGE DÉTAIL
# ─────────────────────────────────────────────────────────────────────────
SITE_DETAIL_DESCRIPTION_SELECTOR=[ex: .description, .bien-description]
SITE_DETAIL_FEATURES_SELECTOR=[ex: .features li, .caracteristiques]
SITE_DETAIL_REF_SELECTOR=[ex: .reference, .ref-number]

# ─────────────────────────────────────────────────────────────────────────
# REGEX POUR EXTRACTION DEPUIS TEXTE
# (utilisé quand les données ne sont pas dans des éléments séparés)
# ─────────────────────────────────────────────────────────────────────────
SITE_FLOOR_REGEX=(?:situé au|niveau|étage)\s*:?\s*(rez-de-chaussée|rdc|\d+(?:er|ème|e)?\s*étage)
SITE_BUILDING_FLOORS_REGEX=immeuble\s*(?:de)?\s*(\d+)\s*étage
SITE_SURFACE_REGEX=(\d+)\s*m[²2]
SITE_ROOMS_REGEX=(\d+)\s*pièces?
SITE_REF_REGEX=(?:réf|ref|référence)\s*:?\s*(\d+)

# ─────────────────────────────────────────────────────────────────────────
# INTERACTIONS REQUISES
# ─────────────────────────────────────────────────────────────────────────
# Texte du bouton à cliquer pour accepter les cookies (laisser vide si aucun)
SITE_COOKIE_BUTTON_TEXT=[ex: Tout accepter]

# Texte du bouton overlay à cliquer pour voir les annonces (laisser vide si aucun)
SITE_OVERLAY_BUTTON_TEXT=[ex: Voir les annonces]

# Délai d'attente après chargement de page (en ms)
SITE_LOAD_DELAY=3000

# ─────────────────────────────────────────────────────────────────────────
# NOTES ET AVERTISSEMENTS
# ─────────────────────────────────────────────────────────────────────────
# [Ajoute ici toute note importante sur le site]
# Ex: "Lazy loading agressif", "Nécessite scroll", "Anti-bot détecté"
SITE_NOTES=
```

---

## ✅ ÉTAPE 6 : VALIDATION

### Checklist finale :

- [ ] J'ai trouvé au moins 5 sélecteurs CSS valides
- [ ] La pagination fonctionne (URL page 2 différente de page 1)
- [ ] J'ai pu accéder à une page détail
- [ ] J'ai capturé des screenshots pour preuve
- [ ] Le fichier .env est complet
- [ ] J'ai noté les difficultés potentielles

### Tests recommandés :

1. **Test sélecteur carte** : `document.querySelectorAll('[SELECTOR]').length` doit retourner > 0
2. **Test sélecteur prix** : doit retourner des valeurs numériques
3. **Test lien détail** : doit retourner des URLs valides

---

## 📤 OUTPUT FINAL ATTENDU

Fournis :

1. **Screenshot page liste** annotés avec les zones identifiées
2. **Screenshot page détail** avec les données clés visibles
3. **Fichier .env complet** prêt à copier-coller
4. **Notes** sur les difficultés rencontrées ou particularités du site
5. **Score de confiance** /100 pour la fiabilité de la configuration

---

## 🚀 EXEMPLE D'UTILISATION

```
UTILISATEUR: Analyse ce site : https://www.exemple-immobilier.fr/acheter

IA: 
1. J'ouvre le site...
2. Je clique sur "Accepter les cookies"...
3. J'identifie les sélecteurs...
4. Voici la configuration générée :

[FICHIER .ENV]

Score de confiance: 85/100
Note: Le site utilise du lazy-loading, j'ai ajouté un délai de 3000ms.
```

---

> **💡 Astuce** : Ce prompt fonctionne avec Claude, GPT-4, Gemini, ou toute IA avec capacité de navigation web. Adapte les instructions si l'IA n'a pas accès au DOM directement.
