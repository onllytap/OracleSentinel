# 🔧 Guide : Créer un Scraper Immobilier pour Nouveau Client

## Prompt à Utiliser

```
Je veux configurer un scraper Puppeteer pour le site immobilier [URL_CLIENT].

1. Navigue vers [URL_CLIENT]/vente/appartements/ (ou page similaire)
2. Attends 5s le chargement JS
3. Accepte les cookies si présent
4. Identifie les sélecteurs CSS pour :
   - Container de chaque annonce (card)
   - Prix
   - Ville/Localisation
   - Type/Titre (contient pièces, m², chambres)
   - Lien vers l'annonce

5. Retourne les sélecteurs exacts au format :
   CARD: .xxx
   PRICE: .xxx
   LOCATION: .xxx
   TITLE: .xxx
   LINK: a.xxx
```

---

## Workflow Rapide

### 1. Analyse (5 min)
```bash
# Ouvrir le site dans le browser subagent
# Exécuter le prompt ci-dessus
```

### 2. Update scraper.service.ts
```typescript
// Remplacer les sélecteurs dans page.evaluate()
const cards = document.querySelectorAll('[CARD_SELECTOR]');
const priceEl = card.querySelector('[PRICE_SELECTOR]');
const locationEl = card.querySelector('[LOCATION_SELECTOR]');
const titleEl = card.querySelector('[TITLE_SELECTOR]');
```

### 3. Update .env
```env
COMPANY_NAME=Nom Agence
KNOWLEDGE_URLS=https://site-client.com/vente/appartements/,https://site-client.com/vente/maisons/
```

### 4. Test
```bash
POST /api/knowledge/refresh
POST /api/chat {"message": "appartement à [PRIX_EXISTANT]€"}
```

---

## Alternative : API Flux Immobilier

Si le client utilise un logiciel standard (La Boite Immo, Hektor, Apimo, etc.), demander :

1. **Flux XML/JSON** - Beaucoup d'agences ont un flux de données
2. **API Se Loger / Bien Ici** - Syndication standardisée
3. **Export CSV** - Import périodique

→ Plus fiable que le scraping (pas de changement de CSS qui casse tout)

---

## Sélecteurs Courants par Plateforme

| Plateforme | Card | Prix | Titre |
|------------|------|------|-------|
| La Boite Immo | `.item__block` | `.item__price` | `.item__block--title` |
| Apimo | `.property-card` | `.price` | `.property-title` |
| Hektor | `.bien-item` | `.prix` | `.titre` |
| WordPress Flavor | `article.listing` | `.listing-price` | `.listing-title` |
