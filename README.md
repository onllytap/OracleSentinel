# Sentinel — Chatbot de qualification de leads immobiliers

Sentinel est un SaaS multi-tenant de chatbots immobiliers. Chaque agence cliente
(un *tenant*) intègre un widget conversationnel sur son site : le bot discute avec
le visiteur, recherche dans le catalogue de l'agence (RAG), qualifie le prospect,
puis pousse le lead vers le CRM de l'agence. Le produit est déjà en production et
supervise une flotte d'environ 350 agences.

Trois plans fonctionnels :

- **Widget** (public, par tenant) — conversation et capture de lead.
- **Administration** (opérateur) — gestion des données et des bots.
- **Supervision** (super-admin) — santé de l'infrastructure et de la flotte.

> Ce dépôt (`D:\Chatbot - Copy`) est le **seul** système modifiable de l'écosystème.
> La documentation détaillée vit dans [`bibliotheque/`](bibliotheque/README.md), qui
> reste la **source de vérité unique**. Ce README est un point d'entrée d'onboarding.

---

## Écosystème (3 systèmes)

Sentinel fait partie d'un écosystème de trois systèmes physiquement séparés. Seul
Sentinel est la cible de travail ; les deux autres sont des références à ne pas modifier.

| Système | Rôle | Statut |
|---|---|---|
| **Sentinel** (ce dépôt) | Widget chatbot + backend API + QG d'administration | Cible (modifiable) |
| **SYSTEM 2 VRAI** | Infrastructure / orchestration / Auto-Action Engine | Référence (lecture) |
| **projet - 3 VRAI** | Site vitrine B2B (landing Next.js) | Référence (lecture) |

Cartographie complète : [`bibliotheque/audit/SYSTEM_MAP.md`](bibliotheque/audit/SYSTEM_MAP.md).

---

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, Vite 6, TailwindCSS, Radix UI, React Router 7, better-auth, Sentry |
| Backend | Node.js 20, Express, TypeScript, PostgreSQL (`pg`, Neon en prod, TLS) |
| Sécurité | JWT widget (`jose`), session admin + CSRF, `express-rate-limit` (store PostgreSQL), garde SSRF |
| LLM | Groq (principal), OpenRouter ; SDK Anthropic présent |
| CRM | Airtable (webhook), Twenty (API) |
| Observabilité | Sentry, logs structurés `pino`, healthchecks |
| Tests | Vitest (unitaire), Playwright (E2E) |
| Déploiement | Docker (`Dockerfile.production`, `docker-compose.production.yml`) |

Architecture détaillée : [`bibliotheque/architecture/ARCHITECTURE.md`](bibliotheque/architecture/ARCHITECTURE.md).

---

## Structure du dépôt

Vue d'ensemble. La **carte complète du code** (routes, services, middleware…) est
maintenue dans [`bibliotheque/README.md`](bibliotheque/README.md) — section
« Carte du code source ». Elle n'est pas dupliquée ici.

```
D:\Chatbot - Copy
├── src/            Frontend React (widget + QG Command Center dans src/dashboard/)
├── server/         Backend Express + PostgreSQL (code dans server/src/)
├── public/         Assets statiques frontend
├── build/          Sortie de build frontend (sert le QG /qg en production)
├── docs/           Pointeur vers la documentation (voir docs/README.md)
├── bibliotheque/   Documentation complète — source de vérité
├── Dockerfile.production, docker-compose.production.yml   Déploiement
└── package.json, vite.config.ts, tailwind.config.ts, tsconfig.json   Config frontend
```

---

## Démarrage

### Prérequis

- Node.js 20+ et npm
- PostgreSQL (local) ou une base managée (Neon)
- Une clé API Groq

### Installation

```
npm install
cd server
npm install
```

### Configuration

Copier les fichiers d'exemple puis renseigner les valeurs localement (voir
[Variables d'environnement](#variables-denvironnement)) :

```
copy .env.example .env
copy server\.env.example server\.env
```

### Développement

Les serveurs de dev sont des processus longue durée : lancez-les vous-même dans
des terminaux séparés.

```
# Frontend (Vite) — à la racine
npm run dev

# Backend (nodemon) — dans server/
cd server
npm run dev
```

### Build et vérification

```
# Frontend (racine)
npm run build       # build de production (vite build)
npm run verify      # typecheck + tests unitaires + build + E2E + audit prod

# Backend (server/)
cd server
npm run build       # tsc + copie des assets
npm run verify      # typecheck + tests + build + audit prod
```

> Pour l'état connu du build et les correctifs en cours, voir
> [`bibliotheque/audit/INITIAL_ANALYSIS.md`](bibliotheque/audit/INITIAL_ANALYSIS.md)
> et [`bibliotheque/audit/REMEDIATION_LOG.md`](bibliotheque/audit/REMEDIATION_LOG.md).

### Production (Docker)

La stack de production cohabite avec Twenty/n8n : le serveur écoute sur le port
`3001`, PostgreSQL sur `5433`. Un mot de passe Postgres (`POSTGRES_PASSWORD`) et un
fichier `server/.env` sont requis (aucune valeur par défaut non sécurisée).

```
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml logs -f oraclesentinel
docker compose -f docker-compose.production.yml down
```

Le script `deploy.sh` automatise ce déroulé sur le VPS (exécuté depuis
`/opt/oraclesentinel`). Détails déploiement :
[`bibliotheque/depart_docs/03_DEPLOIEMENT_ET_PROD/`](bibliotheque/depart_docs/03_DEPLOIEMENT_ET_PROD).

---

## Variables d'environnement

Listées **par nom uniquement**. Les valeurs (secrets inclus) ne figurent jamais
dans la documentation : la référence canonique reste les fichiers d'exemple.

Frontend — [`.env.example`](.env.example) :

`NODE_ENV` · `VITE_API_URL` · `VITE_WIDGET_ID` · `VITE_COMPANY_PHONE` ·
`VITE_SENTRY_DSN` · `VITE_APP_RELEASE`

Backend — [`server/.env.example`](server/.env.example) :

- Serveur / DB : `NODE_ENV`, `PORT`, `DATABASE_URL`, `DB_POOL_MAX`,
  `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`
- Auth / sécurité : `ADMIN_API_KEY`, `ADMIN_SESSION_SECRET`, `JWT_SECRET`,
  `JWT_TTL_SECONDS`, `JWT_ALG`, `WIDGET_ALLOWED_ORIGINS`, `WIDGET_TENANT_MAP`
- LLM : `LLM_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY`
- CRM : `CRM_PROVIDER`, `CRM_MIN_PUSH_SCORE`, `AIRTABLE_WEBHOOK_URL`,
  `TWENTY_API_URL`, `TWENTY_API_KEY`
- Bot / RAG : `BOT_PROFILE`, `RAG_ENABLED`, `KNOWLEDGE_URLS`, `KNOWLEDGE_CACHE_TTL`
- Observabilité : `SENTRY_DSN`, `APP_RELEASE`

Ne jamais committer de valeurs réelles. Les fichiers `.env`, `.env.backup.*` et
`ORACLESENTINEL_CONFIG.txt` sont ignorés par Git et doivent le rester.

---

## Flux principal (du visiteur au lead)

1. Le site de l'agence charge le widget, qui obtient un jeton via
   `GET /api/widget-auth?widget_id=…` (JWT widget, isolé par tenant).
2. Les messages transitent par `POST /api/chat` (Bearer JWT). Le bot répond via
   le LLM (Groq) et, si `RAG_ENABLED`, s'appuie sur le catalogue et la base de
   connaissances de l'agence.
3. La conversation qualifie le prospect (score). Au-delà de `CRM_MIN_PUSH_SCORE`,
   le lead part vers le CRM selon `CRM_PROVIDER` (webhook Airtable ou API Twenty).
4. Les opérateurs supervisent la flotte et configurent les bots via le QG
   (voir ci-dessous).

Flux détaillé et modèle de données :
[`bibliotheque/architecture/ARCHITECTURE.md`](bibliotheque/architecture/ARCHITECTURE.md).

---

## Surfaces d'administration (le « QG »)

Toutes les surfaces partagent la même authentification : une **session admin**
(cookie `admin_session` HttpOnly, ouverte via `ADMIN_API_KEY`). Les mutations sur
`/admin` et `/factory` exigent en plus une protection **CSRF**.

| Surface | Rôle | Auth |
|---|---|---|
| `/qg` | QG React complet (Command Center), servi en prod depuis `build/` | session admin |
| `/priv` | Supervision infra temps réel + santé de la flotte (~350 agences) | session admin |
| `/admin` | Visualisation DB par tenant, CRUD catalogue, purge tenant | session admin + CSRF |
| `/factory` | Config agent, build, tests connexions (LLM/CRM/DB), import knowledge, rollback | session admin + CSRF |

Détail des routes et flux : [`bibliotheque/architecture/ARCHITECTURE.md`](bibliotheque/architecture/ARCHITECTURE.md).

---

## Documentation complète

Toute la documentation est centralisée dans [`bibliotheque/`](bibliotheque/README.md).
Points d'entrée recommandés :

| Besoin | Document |
|---|---|
| Index maître + carte du code | [`bibliotheque/README.md`](bibliotheque/README.md) |
| Contraintes (à lire avant de modifier) | [`bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md`](bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md) |
| Écosystème (3 systèmes) | [`bibliotheque/audit/SYSTEM_MAP.md`](bibliotheque/audit/SYSTEM_MAP.md) |
| Analyse initiale + plan par phases | [`bibliotheque/audit/INITIAL_ANALYSIS.md`](bibliotheque/audit/INITIAL_ANALYSIS.md) |
| Audit de sécurité (findings) | [`bibliotheque/audit/SECURITY_REVIEW.md`](bibliotheque/audit/SECURITY_REVIEW.md) |
| Journal des corrections | [`bibliotheque/audit/REMEDIATION_LOG.md`](bibliotheque/audit/REMEDIATION_LOG.md) |
| Architecture réelle + modèle de données | [`bibliotheque/architecture/ARCHITECTURE.md`](bibliotheque/architecture/ARCHITECTURE.md) |
| Décisions d'évolution (ADR) | [`bibliotheque/decisions/README.md`](bibliotheque/decisions/README.md) |

---

## Contribuer / multi-agents

Plusieurs agents peuvent travailler en parallèle sur ce dépôt. Pour éviter les
conflits et préserver ce qui fonctionne :

**Modèle de branches**

- Une branche par agent / tâche, préfixée par type : `docs/…`, `feat/…`, `fix/…`, `chore/…`.
- Ne **jamais** pousser directement sur `main` / `master`.
- Commits ciblés : ajouter les fichiers par leur nom, jamais `git add -A`.

**Vérification avant de proposer un changement**

```
# Racine
npm run verify

# Backend
cd server
npm run verify
```

Variantes plus rapides si besoin : `npm run typecheck`, `npm run test:unit`
(racine) ou `npm run test` (server).

**Règles de sécurité**

- Aucun secret dans le code, les commits ou la documentation. Variables par nom uniquement.
- Ne pas toucher, sans validation explicite : la logique LLM/Groq et le modèle, le
  design du widget, les payloads CRM Airtable/Twenty.
- Aucune suppression de dossier, backup ou doc sans inventaire et validation.
- Toute évolution : incrémentale, réversible, testée.

Contexte complet des contraintes :
[`bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md`](bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md).
