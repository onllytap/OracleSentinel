# 📚 Bibliothèque Sentinel — Point d'entrée unique de la documentation

> Toute la documentation du projet est ici. Si tu cherches un document, commence par ce fichier.
> Mise à jour : 2026-06-19.

---

## 1. Qu'est-ce que Sentinel ? (en une phrase)

Un **chatbot widget multi-tenant** qui qualifie des leads immobiliers, discute avec eux, et pousse les leads vers le CRM de l'agence cliente. Backend Express + PostgreSQL, frontend React. Trois consoles d'administration : `/admin`, `/factory`, `/priv`.

---

## 2. Comment est rangée cette bibliothèque

```
bibliotheque/
├── README.md            ← CE FICHIER (index maître)
│
├── audit/               ← Compréhension & sécurité (commence par ici)
│   ├── SYSTEM_MAP.md         Cartographie des 3 systèmes de l'écosystème
│   ├── INITIAL_ANALYSIS.md   Analyse complète + plan d'action par phases
│   ├── SECURITY_REVIEW.md    Audit sécurité, findings F1–F14 priorisés
│   └── REMEDIATION_LOG.md    Journal des corrections appliquées (Phase 1…)
│
├── architecture/        ← Comment le système est construit
│   └── ARCHITECTURE.md       Architecture réelle, modèle de données, flux
│
├── decisions/           ← Décisions d'évolution (ADR)
│   ├── README.md             Index des ADR + conventions
│   ├── ADR_0001_*.md         QG unifié (supervision)
│   ├── ADR_0002_*.md         Gestion distante des chatbots
│   └── ADR_0003_*.md         Défense en profondeur multi-tenant (RLS)
│
├── depart_docs/         ← Documentation historique du projet (ex 00_DEPART_DOCS)
│   ├── 00_COMMENCER_ICI/     Prise en main rapide
│   ├── 01_AUDIT_ET_ETAT_PROJET/  Audits & diagnostics antérieurs
│   ├── 02_GUIDES_UTILISATION/    Guides (domaine, profil, tests, sécurité)
│   ├── 03_DEPLOIEMENT_ET_PROD/   Déploiement / VPS / prod
│   ├── 04_PROMPTS_ET_ARCHIVES/   Prompts & historiques
│   ├── 05_DOCS_TECHNIQUES/       Docs techniques avancées
│   └── 99_ARCHIVES_LOURDES/      Archives volumineuses
│
├── handoff/             ← Passation (ex _handoff)
│   └── CHATGPT_LIS_ABSOLUMENT.md  Contraintes & contexte — À LIRE EN PREMIER
│
└── notes/               ← Notes de travail en vrac
```

### Par où commencer selon ton besoin

| Ton besoin | Lis en priorité |
|---|---|
| Comprendre les contraintes / ne rien casser | `handoff/CHATGPT_LIS_ABSOLUMENT.md` |
| Comprendre vite le projet | `audit/INITIAL_ANALYSIS.md` puis `architecture/ARCHITECTURE.md` |
| Voir les risques de sécurité | `audit/SECURITY_REVIEW.md` |
| Comprendre l'écosystème (3 systèmes) | `audit/SYSTEM_MAP.md` |
| Faire évoluer le QG / la gestion des bots | `decisions/` (ADR) |
| Déployer en production | `depart_docs/03_DEPLOIEMENT_ET_PROD/` |

---

## 3. Carte du code source (où trouver quoi)

> Le **code source n'a pas été déplacé** (le déplacer casserait les imports et les builds). Cette carte rend sa structure limpide.

### Racine du projet
```
D:\Chatbot - Copy
├── src/                 Frontend React (widget + QG Command Center)
├── server/              Backend Express + PostgreSQL
├── public/              Assets statiques frontend
├── build/               Sortie de build frontend
├── bibliotheque/        ← TOUTE la documentation (ce dossier)
├── Dockerfile.production / docker-compose.production.yml   Déploiement
├── package.json         Dépendances + scripts frontend (dev, build, verify)
├── vite.config.ts / tailwind.config.ts / tsconfig.json     Config frontend
└── ORACLESENTINEL_CONFIG.txt   ⚠️ Dump de secrets local (gitignoré) — NON déplacé
```

### Frontend — `src/`
| Dossier/fichier | Rôle |
|---|---|
| `main.tsx`, `App.tsx` | Point d'entrée du widget chatbot |
| `components/` | Composants UI du widget |
| `contexts/`, `hooks/` | État & logique React partagée |
| `services/` | Appels API côté client |
| `dashboard/` | **QG Command Center** (`CommandCenter.tsx`, `api.ts`, `components/`) |
| `monitoring/` | Intégration Sentry frontend |
| `styles/`, `index.css` | Styles |

### Backend — `server/src/`
| Dossier/fichier | Rôle |
|---|---|
| `index.ts` | **Point d'entrée** : middleware, sécurité, CORS, rate-limit, montage routes |
| `env.ts` | Chargement en couches des variables d'environnement |
| `routes/` | Endpoints API (voir détail ci-dessous) |
| `controllers/` | Logique d'entrée des routes (ex. `chat.controller`) |
| `services/` | Logique métier (chat, LLM, RAG, qualification, CRM, catalogue, infra-monitor…) |
| `middleware/` | `widget-auth`, `admin-api-key`, `admin-session` (+CSRF), `rate-limit-store` |
| `db/` | `pool.ts` (connexion), `ensure-db.ts` (**schéma réel**), `migrations/`, `schema.sql` (⚠️ legacy, ne pas exécuter) |
| `factory/` | Moteur de configuration & build des agents + validation Zod |
| `auth/` | `auth.ts` — better-auth (multi-utilisateur / 2FA, optionnel) |
| `monitoring/` | Sentry backend |
| `utils/` | `logger` (pino), `ssrf-guard`, helpers |
| `views/` | Pages HTML serveur : `admin.html`, `factory.html`, `priv.html` |
| `validators/` | Schémas de validation d'entrée |
| `core/` | `prompts` (prompt système par domaine) |

### Les routes API (`server/src/routes/`)
| Route | Fichier | Auth | Rôle |
|---|---|---|---|
| `/api/widget-auth`, `/api/chat`, `/api/leads` | `chat.routes.ts` | JWT widget | Conversation + capture lead |
| `/api/admin/*`, `/admin` | `admin.routes.ts` | session + CSRF | Vue DB, CRUD catalogue, purge tenant |
| `/api/factory/*`, `/factory` | `factory.routes.ts`, `factory-ui.routes.ts` | session + CSRF | Config agent, build, tests, knowledge, rollback |
| `/api/priv/*`, `/priv` | `command-center.routes.ts` | session | Supervision infra + **flotte** (`/api/priv/overview` : santé des 350 agences) |
| `/qg` | `index.ts` + `src/dashboard/` | session | **QG React complet** (Command Center) servi en prod depuis `build/` |
| `/api/catalog/*` | `catalog.routes.ts` | — | Catalogue |
| `/api/knowledge/*` | `knowledge.routes.ts` | — | Base de connaissances |
| `/api/crm/webhook` | `crm-webhook.routes.ts` | — | Webhook CRM entrant |
| `/api/auth/*` | (better-auth) | — | Auth multi-utilisateur (si activée) |
| `/health`, `/api/health`, `/embed` | `index.ts` | — | Santé + page widget hébergée |

---

## 4. Commandes utiles (vérifiées)

```powershell
# Frontend (racine)
npm run dev          # serveur de dev Vite
npm run build        # build de production
npm run verify       # typecheck + tests + build + e2e + audit

# Backend
cd server
npm run dev
npm run build
npm run verify
npm audit
```

> Pour les serveurs de dev (`npm run dev`), lance-les toi-même dans ton terminal : ce sont des processus longue durée.

---

## 5. Règles d'or (résumé du handoff)

- ❌ Ne pas reconstruire le projet, ne pas changer l'architecture globale.
- ❌ Ne pas toucher la logique LLM/Groq, le modèle, le design du widget, les payloads CRM.
- ❌ Ne rien supprimer sans inventaire + validation.
- ✅ Optimisation, durcissement sécurité, documentation, tests, robustesse : OK.
- ✅ Toute évolution : incrémentale, réversible, testée.

Détail complet : `handoff/CHATGPT_LIS_ABSOLUMENT.md`.

---

## 6. Éléments laissés volontairement hors bibliothèque

| Élément | Pourquoi |
|---|---|
| `ORACLESENTINEL_CONFIG.txt` (racine) | Dump de secrets local (gitignoré). On ne range pas de secrets dans la doc. |
| `src/**`, `server/**` | Code source : déplacé = builds/imports cassés. Cartographié ci-dessus à la place. |
| `Chatbot/`, `ai-chat-agent-main/` | Copies/variantes de travail — non documentaires, laissées intactes. |

---

## 7. Liens vers la racine du dépôt

- [`README.md`](../README.md) (racine) — onboarding : pitch, stack, démarrage, variables d'environnement, surfaces du QG, et section « Contribuer / multi-agents ».
- [`docs/README.md`](../docs/README.md) — pointeur qui renvoie ici (cette bibliothèque reste la source de vérité unique).

> Ces deux fichiers ne dupliquent pas la bibliothèque : ils y renvoient. Toute doc de fond reste ici.
