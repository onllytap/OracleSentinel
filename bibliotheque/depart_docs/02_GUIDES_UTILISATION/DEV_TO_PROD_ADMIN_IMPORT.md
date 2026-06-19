# Dev → Prod (one-shot) — Admin Import XML + Multi-Chatbots (Tenant)

Ce document liste **toutes les URLs**, **les variables d’environnement**, et la procédure complète pour que le système reste utilisable **en local** puis **en production**.

---

## 1) URLs (Localhost)

### Backend (Express)
- `http://localhost:3001/health`
- `http://localhost:3001/api/widget-auth?widget_id=default`
- `http://localhost:3001/api/chat` (protégé widget token)
- `http://localhost:3001/api/conversations` (protégé widget token)
- `http://localhost:3001/api/conversations/:sessionId/messages` (protégé widget token)
- `http://localhost:3001/api/leads` (protégé widget token)

### Knowledge
- `POST http://localhost:3001/api/knowledge/refresh` (**admin key** header `x-admin-api-key`)
- `GET  http://localhost:3001/api/knowledge/status` (protégé widget token)

### Catalogue (Import direct via admin key)
- `POST http://localhost:3001/api/catalog/import/dry-run?tenant_id=...` (**admin key** + XML body)
- `POST http://localhost:3001/api/catalog/import/commit?tenant_id=...` (**admin key** + XML body)

### Admin “tout-en-un” (Option A)
- `GET  http://localhost:3001/admin` (page HTML)
- `POST http://localhost:3001/api/admin/session` (login — body `{ "key": "..." }`)
- `POST http://localhost:3001/api/admin/logout`
- `GET  http://localhost:3001/api/admin/status`
- `POST http://localhost:3001/api/admin/catalog/import/dry-run?tenant_id=...` (session cookie)
- `POST http://localhost:3001/api/admin/catalog/import/commit?tenant_id=...` (session cookie)

---

## 2) URLs (Production)

### Recommandation (simple + cookies fiables)
- **Frontend public** (site + widget) : `https://www.ton-domaine.com`
- **Backend API** : `https://api.ton-domaine.com`
- **Admin caché** : `https://api.ton-domaine.com/admin`

Pourquoi : la page admin est servie par le backend, donc **même domaine** → cookies OK.

> Important : en production, il faut **HTTPS**.

---

## 3) Variables d’environnement (Backend `server/.env`)

### Obligatoires
- `DATABASE_URL=postgres://...` (Postgres)
- `ADMIN_API_KEY=...` (clé admin)
- `JWT_SECRET=...` (sert aussi à signer le token widget / session)

### Recommandées
- `NODE_ENV=production` (en prod)
- `PORT=3001`
- `WIDGET_ALLOWED_ORIGINS=https://www.ton-domaine.com,https://ton-domaine.com` (en prod)
- `WIDGET_TENANT_MAP=widgetA:tenantA,widgetB:tenantB,default:default`

### LLM (si tu utilises OpenRouter)
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_HISTORY_MAX_MESSAGES=10`
- `OPENROUTER_MAX_TOKENS_NORMAL=600`
- `OPENROUTER_MAX_TOKENS_SHORT=300`

### Knowledge routing (site)
- `KNOWLEDGE_URLS=https://www.ton-domaine.com/page1,https://www.ton-domaine.com/page2`
- `KNOWLEDGE_MAX_URLS=3`
- `CATALOG_FALLBACK_SCRAPER=0` (recommandé)

### Optionnel (si tu veux dissocier le secret de session admin)
- `ADMIN_SESSION_SECRET=...`

Notes :
- Si `ADMIN_SESSION_SECRET` n’est pas défini, le système réutilise `JWT_SECRET`, sinon `ADMIN_API_KEY`.

---

## 4) Variables Frontend (Vite)

Dans ton `.env` frontend (ou variables de build) :
- `VITE_API_URL=https://api.ton-domaine.com` (prod)
- `VITE_WIDGET_ID=default` (ou un widget id spécifique)

---

## 5) Multi-chatbots (séparation stricte)

Le principe : **1 chatbot = 1 tenant**.

### Mode simplifié (recommandé) : **1 seul groupe par projet**

Dans ton usage, tu peux considérer que :
- **`tenant_id` = le groupe du projet** (unique)
- Tous les chatbots rebuildés pour ce projet pointent vers **ce même tenant**

Concrètement :
- Tu configures le tenant “groupe projet” côté backend via `WIDGET_TENANT_MAP` (au minimum l’entrée `default`).
- La page `/admin` pré-remplit automatiquement le champ `tenant_id` avec **`WIDGET_TENANT_MAP` (default → tenant)**.

- Le navigateur récupère un token via :
  - `GET /api/widget-auth?widget_id=...`
- Le serveur mappe `widget_id` → `tenant_id` via `WIDGET_TENANT_MAP`.
- Toutes les recherches catalogue sont filtrées par `tenant_id`.

Conséquence :
- **Aucun mélange** de données entre chatbots, tant que chaque widget a son `widget_id`.

---

## 6) Procédure Localhost (import XML de test)

### Démarrer
1) Lancer Postgres en local.
2) Mettre `DATABASE_URL` dans `server/.env`.
3) Initialiser la DB (non destructif) :
   - `npm --prefix .\server run ensure-db`
4) Lancer le backend :
   - `npm --prefix .\server run dev`

### Import via l’admin page (recommandé)
1) Ouvrir : `http://localhost:3001/admin`
2) Entrer `ADMIN_API_KEY` → session créée (cookie HttpOnly)
3) Choisir `tenant_id` (ex: `demo1`)
4) Upload XML :
   - d’abord **Dry-run**
   - puis **Commit**

---

## 7) Procédure Production (checklist)

### A) Base + réseau
- **Postgres managé** (ou VM) + `DATABASE_URL`.
- Backend exposé en **HTTPS** (reverse proxy type Nginx/Traefik ou plateforme).

### B) Sécurité minimum
- `ADMIN_API_KEY` : longue, aléatoire.
- `/admin` : ne pas linker publiquement.
- Recommandé : restreindre par IP (allowlist) au niveau reverse-proxy.

### C) CORS
- Mettre `WIDGET_ALLOWED_ORIGINS` sur tes domaines prod.
- Le backend est configuré avec `credentials: true` (cookies OK).

### D) Validation
- Vérifier `GET /health`.
- Vérifier widget auth : `GET /api/widget-auth?widget_id=...`.
- Vérifier chat.
- Vérifier `/admin` + upload.

---

## 8) Notes importantes cookies (prod)

- La session admin est un cookie **HttpOnly** (`admin_session`) en `SameSite=Lax`.
- **Recommandation** : servir `/admin` sur le **même domaine** que l’API (ex: `api.ton-domaine.com/admin`).
- Si tu veux servir l’admin sur un autre domaine, il faudra passer le cookie en `SameSite=None; Secure` (nécessite un petit ajustement).

---

## 9) Rappels d’exploitation

- Import catalogue : toujours tester en **dry-run** avant **commit**.
- `tenant_id` = identité du chatbot pour l’import.
- En cas d’erreurs d’import : consulter la réponse JSON et vérifier le XML.
