# Sentinel — Backend (`server/`)

API Express + TypeScript du chatbot Sentinel : authentification du widget,
conversation/RAG, qualification des leads, push CRM, et surfaces
d'administration (`/admin`, `/factory`, `/priv`).

> Vue d'ensemble du produit et de l'écosystème : [`../README.md`](../README.md).
> Architecture détaillée et modèle de données :
> [`../bibliotheque/architecture/ARCHITECTURE.md`](../bibliotheque/architecture/ARCHITECTURE.md)
> (source de vérité — non dupliquée ici).

---

## Stack

Node.js 20 · Express · TypeScript · PostgreSQL (`pg`, Neon en prod, TLS) ·
Zod (validation) · `jose` (JWT widget) · `express-rate-limit` (store PostgreSQL) ·
`pino` (logs structurés) · Sentry · Vitest (tests) · Groq / OpenRouter (LLM) ·
Puppeteer + Cheerio (knowledge/RAG).

---

## Démarrage

### Prérequis

- Node.js 20+ et npm
- PostgreSQL local ou base managée (Neon)
- Une clé API Groq

### Installation et configuration

```
npm install
copy .env.example .env   # puis renseigner les valeurs localement
```

Les variables sont listées **par nom** dans [`.env.example`](.env.example)
(serveur/DB, auth/sécurité, LLM, CRM, bot/RAG, observabilité). Ne jamais
committer de valeurs réelles.

### Développement

Processus longue durée : à lancer dans un terminal dédié.

```
npm run dev        # nodemon src/index.ts
```

Initialisation de la base (si nécessaire) :

```
npm run ensure-db  # crée/complète le schéma sans détruire l'existant
npm run init-db    # initialisation complète
```

### Build et vérification

```
npm run typecheck     # tsc --noEmit
npm run test          # vitest run
npm run test:coverage # couverture v8
npm run build         # tsc + copie des assets (scripts/copy-assets.js)
npm run verify        # typecheck + test + build + audit:prod (gate CI)
```

Smoke tests de la « factory » (config agent, connexions LLM/CRM/DB) :

```
npm run factory:smoke         # phase 1
npm run factory:smoke:full    # + phase 2
```

---

## Structure (`server/src/`)

| Dossier | Rôle |
|---|---|
| `auth/` | Authentification (Better Auth, 2FA, session) |
| `controllers/` | Logique applicative par surface (chat, admin, factory…) |
| `core/` | Prompts et briques métier transverses |
| `db/` | Pool PostgreSQL (`pool.ts`), mode dégradé sans DB |
| `factory/` | Construction/validation de configuration d'agent |
| `middleware/` | `widget-auth`, `admin-session`, `admin-api-key`, rate-limit, CSRF |
| `monitoring/` | Intégration Sentry, healthchecks |
| `routes/` | Définition des routes Express (scopes par endpoint) |
| `services/` | Métier : LLM, domaine, qualification, flotte, `crm/`, infra-monitor |
| `utils/` | Utilitaires dont `ssrf-guard` (sécurise les fetch RAG) |
| `validators/` | Schémas Zod (validation + sanitisation des entrées) |
| `views/` | Pages servies (`priv.html`, `embed`…) |
| `scripts/` | Outillage : init/ensure DB, smoke tests, copie d'assets |

Point d'entrée : [`src/index.ts`](src/index.ts) (durcissement HTTP, CORS,
rate limiting, montage des routes, arrêt gracieux).

---

## Sécurité (rappels)

- Widget authentifié par JWT (`jose`) avec binding d'origine + scopes.
- Surfaces admin : session `admin_session` (HttpOnly), CSRF sur les mutations.
- Comparaisons de secrets en temps constant ; rate limiting persistant.
- Garde SSRF sur les URLs de knowledge ; validation Zod systématique au bord.

Findings et journal : [`../bibliotheque/audit/SECURITY_REVIEW.md`](../bibliotheque/audit/SECURITY_REVIEW.md),
[`../bibliotheque/audit/REMEDIATION_LOG.md`](../bibliotheque/audit/REMEDIATION_LOG.md).

---

## Production (Docker)

Construite depuis la racine du dépôt (voir [`../README.md`](../README.md) §
Production). Le serveur écoute sur `3001`, PostgreSQL sur `5433`. Aucun secret
n'est embarqué dans l'image : `server/.env` est monté au runtime.
