# ARCHITECTURE — Sentinel Chatbot (D:\Chatbot - Copy)

> Description de l'architecture **réelle** du système, telle qu'observée dans le code.
> Date : 2026-06-19. Source de vérité : `server/src`, `src`, Docker. Mise à jour à chaque évolution structurante.

---

## 1. Vision système

Sentinel est un **SaaS multi-tenant** de chatbot de qualification de leads immobiliers. Chaque agence cliente (un *tenant*) intègre un widget conversationnel sur son site. Le bot discute, recherche dans le catalogue de l'agence (RAG), qualifie le prospect, puis pousse le lead vers le CRM de l'agence.

Trois plans :
1. **Plan widget** (public, par tenant) — conversation et capture de lead.
2. **Plan administration** (opérateur) — `/admin` (données), `/factory` (configuration & build des bots).
3. **Plan supervision** (super-admin) — `/priv` (santé de l'infrastructure).

---

## 2. Composants

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                        │
│  Widget React (site agence)   │   QG Admin (CommandCenter.tsx)              │
└───────────────┬───────────────┴──────────────────┬────────────────────────┘
                │ HTTPS (JWT widget)                │ HTTPS (cookie session + CSRF)
                ▼                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       BACKEND EXPRESS (server/src)                          │
│                                                                             │
│  index.ts ─ headers, CORS, rate-limit (PG store), pino, error handler       │
│                                                                             │
│  Middleware: widget-auth · admin-api-key · admin-session(+CSRF) · ratelimit │
│                                                                             │
│  Routes:                                                                    │
│   /api/widget-auth   → émission JWT widget                                  │
│   /api/chat,/leads   → ChatController → ChatService                         │
│   /api/admin/*       → session DB viz + CRUD + purge tenant                 │
│   /api/factory/*     → config CRUD, build, tests, knowledge, rollback       │
│   /api/priv/infra    → snapshot infra (collectInfraSnapshot)                │
│   /api/auth/*        → better-auth (optionnel, 2FA)                         │
│   /embed, /admin, /factory, /priv → pages HTML                              │
│   /health, /api/health                                                      │
│                                                                             │
│  Services: chat · llm(groq/openrouter) · knowledge(RAG) · qualification ·   │
│            catalog · catalog-import · crm(airtable/twenty) · variables ·    │
│            domain · profile-loader · infra-monitor · factory-build-history  │
│                                                                             │
│  Transverse: monitoring/sentry · utils/logger(pino) · utils/ssrf-guard ·    │
│              factory/ (config+build+validation Zod) · core/prompts          │
└───────────────┬───────────────────────────────┬───────────────────────────┘
                │                                 │
                ▼                                 ▼
        ┌───────────────┐                 ┌───────────────────────┐
        │ PostgreSQL    │                 │ INTÉGRATIONS EXTERNES  │
        │ (Neon / TLS)  │                 │ Groq · OpenRouter      │
        │ pool.ts       │                 │ Airtable · Twenty CRM  │
        │ ensure-db.ts  │                 │ Sentry                 │
        └───────────────┘                 │ (monitorées par /priv: │
                                          │ Redis,MinIO,n8n,SMTP,  │
                                          │ Documenso)             │
                                          └───────────────────────┘
```

---

## 3. Stack technique (vérifiée)

### Frontend (`package.json` racine)
- React 18.3, Vite 6, TypeScript, TailwindCSS, Radix UI (suite complète), `react-router-dom` 7, `better-auth`, `@sentry/react`, `recharts`, `lucide-react`, `sonner`, `motion`.
- Tests : Vitest (unit), Playwright (E2E desktop + mobile).

### Backend (`server/package.json`)
- Node 20, Express, TypeScript, `pg` (PostgreSQL), `jose` (JWT), `express-rate-limit`, `pino`/`pino-http`, `cors`, Zod (validation factory), `@anthropic-ai/sdk`, SDK Groq/OpenRouter, `cheerio`/`fast-xml-parser` (scraping/catalogue), `better-auth`.
- Build : `tsc` (server/Dockerfile) ou **esbuild** bundling (Dockerfile.production).

### Données
- PostgreSQL. Connexion : `NEXT_PRIVATE_DATABASE_URL` puis `DATABASE_URL`. TLS activé pour hôtes managés/non-locaux.
- Schéma appliqué au runtime par `ensure-db.ts` (idempotent). `migrations/002_factory_builds.sql` pour l'historique de builds.

### Déploiement
- `Dockerfile.production` (full-stack, esbuild) + `docker-compose.production.yml` (PG 16 sur 5433, serveur sur 3001, réseau dédié, healthchecks, logging rotaté).
- Cible annoncée (handoff) : VPS Ubuntu, cohabitation avec Twenty/n8n, Cloudflare Worker.

---

## 4. Modèle de données (réel — `ensure-db.ts`)

| Table | Clé | Tenant | Rôle |
|---|---|---|---|
| `conversations` | `id` UUID | `tenant_id` (+ index unique `(tenant_id, session_id)`) | Session de chat |
| `messages` | `id` UUID | `tenant_id` | Messages user/assistant (FK conversation, ON DELETE CASCADE) |
| `leads` | `id` UUID | `tenant_id` | Lead capturé (PII : email, phone, besoins) |
| `catalog_properties` | `(tenant_id, id_unique)` | composite | Catalogue immobilier (tsvector + JSONB flags) |
| `catalog_import_runs` | `id` UUID | `tenant_id` | Historique d'import (dry_run/commit) |
| `catalog_import_errors` | `id` BIGSERIAL | via run | Erreurs d'import |
| `airtable_leads` | `id` SERIAL | (phone unique) | Déduplication push Airtable |
| `rate_limits` | `key` | — | Store rate-limit persistant |
| `factory_builds` | (migration 002) | — | Historique des builds factory |

**Multi-tenant** : `tenant_id VARCHAR(100)` (défaut `'default'`), backfill automatique des anciennes lignes. Index orientés `(tenant_id, …)` pour performance et scoping.

> ⚠️ `server/src/db/schema.sql` est un **schéma legacy destructif** (`DROP TABLE`, sans `tenant_id`). Il ne reflète pas l'état réel et ne doit pas être exécuté. La source de vérité est `ensure-db.ts`.

---

## 5. Flux de données clés

### 5.1 Authentification widget
```
GET /api/widget-auth?widget_id=X
  → vérifie Origin/Referer ∈ WIDGET_ALLOWED_ORIGINS
  → résout tenant via WIDGET_TENANT_MAP[widget_id]
  → émet JWT (tenant_id, widget_id, scopes:['chat:write'], origin), TTL court
```

### 5.2 Conversation + RAG + qualification
```
POST /api/chat (Bearer JWT, scope chat:write)
  → ChatService.processMessage(sessionId, message, tenantId)
     1. upsert conversation (tenant_id, session_id)
     2. insert message user
     3. charge historique borné (CHAT_HISTORY_LIMIT)
     4. décide lookup RAG (KnowledgeService) → catalog_properties du tenant
     5. construit prompt (profil domaine + variables + hints qualification)
     6. LLMService.generateResponse (Groq)
     7. insert message assistant
     8. QualificationService.extractLeadData → score
     9. si complet & score ≥ CRM_MIN_PUSH_SCORE → push CRM (externalId stable)
```

### 5.3 Administration
```
POST /api/admin/session {key}  → compare ADMIN_API_KEY (temps constant)
  → set-cookie admin_session (JWT HS256, 30 min, HttpOnly) + csrf_token
Mutations (PUT/POST/DELETE) → requireAdminSession + requireCSRF
```

### 5.4 Supervision infra
```
GET /api/priv/infra (requireAdminSession)
  → collectInfraSnapshot(): sondes TCP/HTTP time-boxed sur
     Neon, Postgres local, Redis, MinIO, n8n, SMTP, Twenty, Sentry, Documenso
  → score de santé global, latences, statut par service, SECRETS MASQUÉS
```

---

## 6. Le « QG Admin » aujourd'hui (3 surfaces)

| Surface | URL | Auth | Capacités | Frontend |
|---|---|---|---|---|
| **Admin DB** | `/admin` | session + CSRF | Vue données par tenant, pagination catalogue, conversations/leads, suppression propriété, **purge tenant** (transactionnel) | `views/admin.html` |
| **Factory** | `/factory` | session + CSRF (global) | Config agent (GET/PUT/diff), build pipeline, readiness, observability, logs, tests LLM/CRM/DB/webhook, import knowledge XML, gestion tenants, **rollback .env**, historique builds | `views/factory.html` |
| **Command Center** | `/priv` | session | Santé infra temps réel (score, latences, statut), secrets masqués | `views/priv.html` + `src/dashboard/CommandCenter.tsx` |

**Constat d'architecture** : les trois surfaces partagent le **même mécanisme d'authentification** (`admin_session` + CSRF) mais sont **fragmentées** en pages distinctes. La « gestion distante des chatbots » existe déjà partiellement via `/factory` (config versionnée par backups `.env` + rollback + build history). C'est le socle naturel pour l'évolution du QG (voir `decisions/`).

---

## 7. Sécurité (résumé — détail dans audit/SECURITY_REVIEW.md)

Défense en profondeur : en-têtes, CORS allowlist, rate-limit persistant, JWT widget (origin+scope+tenant), session admin + CSRF, comparaisons temps constant, garde SSRF, redaction secrets, échappement XSS, conteneur non-root. Isolation tenant **applicative** (pas de RLS — candidat à défense en profondeur).

---

## 8. Observabilité & exploitation

- **Logs** : `pino` structuré + `X-Request-Id` propagé ; `autoLogging` ignore `/health`.
- **Erreurs** : handler global, capture Sentry (release tracking), hooks `unhandledRejection`/`uncaughtException`.
- **Santé** : `/health` + `/api/health` (statut DB inclus) ; healthchecks Docker + compose.
- **Mode dégradé** : si la DB est indisponible au boot, le serveur démarre quand même (log d'erreur), `/health` renvoie `503/degraded`.

---

## 9. Décisions structurantes existantes (implicites)

1. **Express monolithique** (pas de microservices) — simple, suffisant pour la charge cible.
2. **Schéma au runtime** (`ensure-db`) plutôt que migrations versionnées strictes — pragmatique, mais limite la traçabilité (une seule migration formelle).
3. **Auth super-admin mono-utilisateur** (`ADMIN_API_KEY` → session) avec **chemin d'upgrade** vers better-auth multi-utilisateur/2FA déjà câblé.
4. **Pages HTML serveur-rendues** pour le QG (admin/factory/priv) + une app React (CommandCenter) — coexistence à rationaliser à terme.
5. **CRM multi-provider** via une couche d'abstraction (`services/crm`) — Airtable + Twenty.

Les évolutions proposées (QG unifié, gestion distante contrôlée, RLS, migrations versionnées) sont documentées sous `bibliotheque/decisions/` (ADR).


---

## 10. Mise à jour 2026-06-19 (soir) — Synchronisation avec le code réel (QG v2.1 / « Waves 0-3 »)

> Les sections 1-9 décrivent le **socle** (toujours exact). Cette section met l'architecture
> à niveau avec ce qui a été livré depuis sur `main` (commit `9346634`) **et** signale le WIP
> local non commité. Tout ce qui suit est **vérifié dans le code** (`server/src/index.ts`,
> `routes/`, `services/`, `utils/crypto.ts`) le 2026-06-19. Source autoritative du cadrage :
> `.kiro/specs/command-center-remote-control/requirements.md` (exigences R1-R19, EARS).

### 10.1 Le QG est passé d'« observation » à « plan de contrôle » de la flotte
Le Command Center React (`src/dashboard/CommandCenter.tsx`) est désormais **servi en production à `/qg`**
(build racine `npm run build` → `build/dashboard.html`), derrière une **CSP stricte** (`script-src 'self'`)
et la session admin. La page légère **`/priv`** est conservée en repli. Tous les routeurs enrichis sont
montés sous **`/api/priv`**, chacun gardé par `requireAdminSession()` (et `requireCSRF()` sur les mutations),
derrière un middleware **`adminIpAllowlist()`** optionnel (désactivé par défaut ; activé via `ADMIN_IP_ALLOWLIST`).

### 10.2 Surface API réelle sous `/api/priv` (vérifiée dans `index.ts`)

| Routeur (fichier) | Rôle | Chemins notables | Auth |
|---|---|---|---|
| `command-center.routes.ts` | Supervision + config par tenant + registre clients | `/infra`, `/overview` (santé flotte), `/surveillance`, `/workers` & `/workers/:name` (Cloudflare, **lecture seule**), `/tenants/:id/config` (GET/PUT/`/versions`/`/rollback`), `/clients` CRUD + `/clients/:id/tenants` (assign/unassign), `/tenant-owners` | session (+CSRF sur écritures) |
| `tenant.routes.ts` | Provisioning d'agences (R19) | `/tenants` (liste), `/tenants/provision` (+ embed snippet), `/tenants/:id`, `/tenants/:id/status` (active/suspended/archived) | session (+CSRF) |
| `tenant-crm.routes.ts` | CRM **par agence** (R17) | config CRM par tenant (provider, mapping, secrets **chiffrés**), test de connexion | session (+CSRF) |
| `billing.routes.ts` | Facturation & quotas (R18) | plans, quota/usage, abonnement (vue publique non secrète) | session |
| `redeploy.routes.ts` | Redéploiement contrôlé par bot (R3/R4) | `/tenants/:id/redeploy` (GET état + `outOfDate`; POST avec `confirm:true`, **single-flight** → 409 si en cours) | session (+CSRF) |
| `metrics.routes.ts` | Métriques réelles par bot (R6/R7) | message_count, latence **mesurée** (ping actif), response rate, dernière activité | session |
| `rgpd.routes.ts` | Opérations RGPD (export/effacement) | endpoints conformité par tenant | session (+CSRF) |
| `mandates.routes.ts` | Mandats immobiliers (module estimation) — **WIP local** | gestion des mandats capturés | session |

> Détail précis vérifié pour `command-center`, `redeploy`, `tenant` (chemins lus). Pour
> `tenant-crm`, `billing`, `metrics`, `rgpd` : routeur + point de montage `/api/priv` confirmés
> dans `index.ts` ; les sous-chemins exacts sont à lire dans chaque fichier au besoin.

**Webhook public** : `POST /api/billing/webhook` est monté **avant `express.json()`** (corps brut requis
pour la vérification de signature Stripe), et dégrade proprement en `503` tant que la facturation n'est
pas configurée. **Endpoint public widget** : `POST /api/estimate` (estimation dans le chatbot — WIP).

### 10.3 Nouveaux services backend (`server/src/services/`)
`cloudflare` (API Workers, lecture seule + health-ping), `redeploy` (état + single-flight),
`tenant` (provisioning), `tenant-config` (override par tenant **versionné** + rollback + bloc de prompt effectif),
`tenant-crm` (CRM par agence, secrets chiffrés), `client` (registre clients + rattachement bots),
`billing` (Stripe, quotas — inerte si `BILLING_ENABLED!=true`), `metrics` (métriques réelles),
`surveillance` (mur temps réel), `fleet` (santé flotte), `audit` (journal append-only des actions),
`totp` + `passkey` (2FA), plus le module **estimation** (`estimation`, `estimation-capture`, `dpe`) — WIP.

### 10.4 Modèle de données — ajouts (créés au boot par `ensure-db.ts`, idempotent)
Au-delà des tables de la §4 : `tenant_crm_configs` (config CRM par tenant, secrets **chiffrés**),
`tenant_subscriptions` + `usage_events` (facturation/quotas), tables de **versions de config par tenant**
(historique + rollback), `clients` (+ table de rattachement client↔tenant), table **tenants** (provisioning),
**journal d'audit** append-only, stockage **chiffré** du secret TOTP. (WIP estimation : tables estimations/mandats/DPE.)

### 10.5 Sécurité — ajouts structurants (vérifiés)
- **Chiffrement au repos AES-256-GCM** (`utils/crypto.ts`) : clé `APP_ENCRYPTION_KEY` (64 hex / 32 octets),
  format `base64(iv 12o ‖ tag 16o ‖ ciphertext)`, **refus de démarrer en prod sans clé valide**, tag GCM
  vérifié au déchiffrement (détection d'altération). Protège les secrets CRM par tenant et le secret TOTP.
- **2FA TOTP obligatoire** (R11-R14) : `ADMIN_API_KEY` + code TOTP (RFC 6238) → session ; enrôlement via
  Settings, **codes de récupération** à usage unique, mécanisme **break-glass** configurable. Services `totp`/`passkey`.
- **Webhook Stripe** : signature vérifiée **manuellement** (HMAC-SHA256 `node:crypto`, comparaison à temps
  constant, fenêtre de tolérance 300 s) — aucune dépendance SDK, secret/raw-body jamais loggés.
- **`adminIpAllowlist()`** : allowlist d'IP optionnelle sur `/admin` et `/api/priv` (défense en profondeur).
- **`/qg`** servi avec CSP stricte ; `/priv` également durci (CSP, `no-store`, `X-Frame-Options: DENY`).

### 10.6 Module « machine à mandats » (estimation) — WIP **non commité**
Présent dans le working tree, **pas encore sur `main`** : routes `estimation.routes.ts` + `mandates.routes.ts`,
services `estimation` / `estimation-capture` / `dpe`, front `EstimationForm.tsx` + `dashboard/views/MandatesView.tsx`,
script `server/scripts/ingest-dvf.ts`. Objectif : estimation immobilière (DVF/DPE) dans le widget → capture de mandat.
**À traiter dans sa propre branche** (cf. règles multi-agents) ; non audité ici car non figé.

### 10.7 Statut de la roadmap de contrôle à distance (`ROADMAP_QG_REMOTE_CONTROL.md`)
| Phase roadmap | État réel constaté dans le code |
|---|---|
| Phase 1 — Vision Workers (lecture seule) | **Implémentée** (`/api/priv/workers`, `cloudflare.service`, dégrade si token absent) |
| Phase 2 — Config éditable + redéploiement | **Implémentée** (config par tenant versionnée + rollback ; `redeploy` avec confirmation + single-flight) |
| Phase 3 — Monitoring avancé | **Partielle** (`surveillance`, `metrics`, santé flotte ; historique/alertes à confirmer) |
| Phase 4 — Conversations (soft/hard delete) | À vérifier / probablement à faire |
| Phase 5 — Actions Worker destructives | À faire (dernier, le plus risqué) |
| Phase 6 — Permissions multi-utilisateur + rôles | Socle 2FA présent ; rôles `viewer/operator/owner` à formaliser (R15) |
