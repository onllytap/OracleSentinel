# INITIAL_ANALYSIS — Sentinel Chatbot (D:\Chatbot - Copy)

> Document d'audit — Phase 0. Lecture seule, aucune modification de code.
> Date : 2026-06-19. Périmètre : `D:\Chatbot - Copy` uniquement.
> Méthode : lecture du code source (backend, frontend, DB, Docker), de la documentation
> existante (`bibliotheque/depart_docs`, `bibliotheque/handoff`), et vérifications non destructives (`npm audit`, `git status`).

---

## 1. Résumé exécutif

Sentinel est un **chatbot widget de qualification de leads immobiliers**, accompagné d'un backend Express/PostgreSQL et de trois surfaces d'administration (le « QG »). Le système est **déjà en production** et a permis de déployer plusieurs chatbots via `/factory`.

Verdict : **socle technique solide et mature** (auth multi-niveaux, multi-tenant, rate-limiting persistant, garde SSRF, redaction de secrets, observabilité Sentry, CI, tests). Un audit senior antérieur le notait **7.8/10**. L'inspection confirme cette appréciation.

Les axes d'amélioration sont **incrémentaux** : durcissement ciblé, couverture de tests des services métier, unification/évolution du QG, et formalisation d'une gestion distante contrôlée des chatbots. Aucune refonte n'est nécessaire ni souhaitable.

---

## 2. Architecture comprise

### 2.1 Vue macro

```
Navigateur (site agence)
   │  widget React (iframe /embed ou montage direct)
   ▼
GET /api/widget-auth  ──►  JWT widget (origin + scopes + tenant)
   │
POST /api/chat (Bearer JWT)  ──►  ChatController ──► ChatService
   │                                   │
   │                                   ├─ PostgreSQL (conversations/messages/leads, par tenant_id)
   │                                   ├─ KnowledgeService (RAG sur catalog_properties)
   │                                   ├─ QualificationService (scoring lead)
   │                                   ├─ LLMService → Groq / OpenRouter
   │                                   └─ CRM (Airtable webhook / Twenty API) si lead complet
   ▼
Réponse + suggestions + qualification
```

### 2.2 Backend (`server/src`)

- **Point d'entrée** : `index.ts` — wiring Express, headers de sécurité, CORS, rate-limit, montage des routes, page `/embed`, healthcheck `/health` + `/api/health`, handler d'erreur global, capture Sentry, hooks `unhandledRejection` / `uncaughtException`.
- **Routes** (`routes/`) :
  - `chat.routes.ts` — API widget (`/api/chat`, `/api/leads`, historique conditionnel).
  - `admin.routes.ts` — session admin, import catalogue, **visualisation DB** (`/db/overview`, `/db/tenants`, `/db/properties`, `/db/imports`, `/db/conversations`), CRUD (suppression propriété, purge tenant).
  - `factory.routes.ts` — config agent (GET/PUT, diff), build pipeline, readiness, observability, logs, tests LLM/CRM/DB/webhook, import knowledge, gestion tenants, rollback `.env`, historique builds.
  - `command-center.routes.ts` — page `/priv` + `/api/priv/infra` (snapshot infra).
  - `catalog.routes.ts`, `knowledge.routes.ts`, `crm-webhook.routes.ts`, `factory-ui.routes.ts`.
- **Middleware** (`middleware/`) :
  - `widget-auth.ts` — émission/validation JWT widget (jose, HS256), contrôle d'origine, scopes, mapping `WIDGET_TENANT_MAP`.
  - `admin-api-key.ts` — vérif `ADMIN_API_KEY` en comparaison à temps constant.
  - `admin-session.ts` — session JWT HttpOnly + protection CSRF double-submit.
  - `rate-limit-store.ts` — store `express-rate-limit` backé PostgreSQL (résistant au redémarrage, multi-instance).
- **Services** (`services/`) : `chat`, `llm`, `groq`, `openrouter`, `knowledge`, `qualification`, `catalog`, `catalog-import`, `airtable`, `crm/`, `domain`, `variables`, `profile-loader`, `property-scraper`, `infra-monitor`, `factory-build-history`.
- **DB** (`db/`) : `pool.ts` (pool `pg`, TLS auto pour Neon), `ensure-db.ts` (schéma idempotent non destructif appliqué au démarrage), `migrations/`, `schema.sql` (legacy — voir risques).
- **Transverse** : `monitoring/sentry`, `utils/logger` (pino), `utils/ssrf-guard`, `factory/` (moteur de config/build + validation Zod), `validators/`, `core/prompts`.

### 2.3 Frontend (`src`)

- **Widget** : `main.tsx` + `App.tsx`, `components/`, `contexts/`, `hooks/`, `services/`, `monitoring/`.
- **QG Command Center** : `dashboard/CommandCenter.tsx`, `dashboard/api.ts` (client API : session cookie `admin_session` HttpOnly + CSRF double-submit via header `X-CSRF-Token`), `dashboard/components/`.
- **Pages serveur-rendues** : `server/src/views/admin.html`, `factory.html`, `priv.html` (chargées et mises en cache par le backend).
- Remarque : `src/pages/` est **vide** ; le routage produit passe par `App.tsx` et les pages HTML serveur.

### 2.4 Modèle multi-tenant

- Un `widget_id` (public) est mappé vers un `tenant_id` via `WIDGET_TENANT_MAP` (ex. `default:default`).
- Le JWT widget porte `tenant_id` ; toutes les requêtes de `chat.service.ts` filtrent par `tenant_id` (`conversations`, `messages`, `leads`).
- `catalog_properties` a une **clé primaire composite `(tenant_id, id_unique)`**.
- `ensure-db.ts` ajoute `tenant_id` aux tables héritées et backfill les anciennes lignes vers `default`.
- **Isolation des données effective au niveau requête.** (Voir SECURITY_REVIEW pour la nuance RLS.)

---

## 3. Fonctionnement actuel (ce qui marche)

1. **Conversation** : le widget s'authentifie (`/api/widget-auth`), puis poste les messages (`/api/chat`). Le backend persiste la conversation, charge l'historique borné, décide d'un lookup RAG, construit le prompt système (profil de domaine + variables + indices de qualification), appelle le LLM (Groq), persiste la réponse.
2. **RAG** : `KnowledgeService` recherche dans `catalog_properties` (tsvector + filtres) par tenant. Gestion fine des références d'annonces (`REF…`).
3. **Qualification & CRM** : `QualificationService` score le lead ; si complet et score ≥ seuil (`CRM_MIN_PUSH_SCORE`, défaut 60), push CRM (Airtable/Twenty) avec `externalId` stable (téléphone > email > session) pour idempotence.
4. **Factory** (`/factory`) : configurer un agent, calculer un diff, lancer un build, vérifier la readiness, tester les connexions (LLM/CRM/DB/webhook), importer un catalogue XML, faire un rollback `.env`. C'est l'outil de **création/déploiement** de chatbots déjà utilisé.
5. **Admin DB** (`/admin`) : explorer les données par tenant, paginer le catalogue, voir conversations/leads, supprimer une propriété, purger un tenant (transactionnel).
6. **Command Center** (`/priv`) : voir l'état de santé temps réel de l'infra (score global, latences, statut par service), secrets masqués.

---

## 4. Points forts

- **Sécurité défensive en profondeur** : headers, CORS allowlist en prod, rate-limit persistant, JWT widget (origin+scope+tenant), session admin + CSRF, comparaisons à temps constant, garde SSRF, redaction de secrets côté factory et infra-monitor, échappement XSS sur `/embed`.
- **Multi-tenant cohérent** : `tenant_id` propagé et filtré ; clé composite catalogue.
- **Résilience au démarrage** : `ensure-db` idempotent, mode dégradé si DB indisponible, better-auth monté en best-effort (n'empêche pas le boot).
- **Observabilité** : Sentry (release tracking), logs structurés pino + `X-Request-Id`, healthchecks.
- **Robustesse données** : requêtes paramétrées partout, allowlist de tables pour les `COUNT`, transactions pour les purges.
- **Industrialisation** : Docker multi-stage non-root, healthcheck conteneur, CI GitHub Actions, tests (59 serveur / 5 front / 8 Playwright), script `verify`.
- **Discipline secrets** : `.gitignore` exclut `.env*` et `ORACLESENTINEL_CONFIG.txt`.

---

## 5. Risques identifiés (synthèse — détail dans SECURITY_REVIEW.md)

| # | Risque | Sévérité | Nature |
|---|---|---|---|
| R1 | `form-data@4.0.5` vuln HAUTE (CRLF, transitive via `@anthropic-ai/sdk`) | Moyenne (pratique) | Dépendance |
| R2 | Mot de passe Postgres par défaut en fallback dans `docker-compose.production.yml` | Élevée si non surchargé | Config/secret |
| R3 | `server/Dockerfile` masque les erreurs TS (`tsc … 2>&1 || true`) | Moyenne | Build/prod |
| R4 | `schema.sql` legacy destructif (`DROP TABLE`) coexiste avec `ensure-db` | Moyenne | Data |
| R5 | 10 fichiers `.env.backup.*` contenant des secrets sur le disque | Moyenne | Secret au repos |
| R6 | `/api/admin/db/overview` expose les variables `VAR_*` (tronquées 80c) | Faible-Moyenne | Fuite partielle |
| R7 | Isolation tenant applicative uniquement (pas de RLS PostgreSQL) | Faible (défense en profondeur) | Data |
| R8 | Couverture de tests faible sur services métier critiques | Moyenne | Qualité |
| R9 | Hygiène repo : entrées `.agent/skills/*` référencées mais absentes | Faible | Hygiène |
| R10 | QG fragmenté en 3 surfaces (`/admin`, `/factory`, `/priv`) sans vue unifiée | Faible (UX/maintenance) | Architecture |

---

## 6. Améliorations possibles (non destructives, alignées handoff)

1. **Dépendances** : `npm audit fix` côté serveur (R1) ; vérifier non-régression build/tests.
2. **Secrets/config** : retirer les valeurs par défaut sensibles des compose/Docker (R2) ; documenter une politique de rotation ; ranger/chiffrer ou purger après validation les `.env.backup.*` (R5).
3. **Build prod** : aligner sur `Dockerfile.production` (esbuild) et retirer le `|| true` masquant de `server/Dockerfile` (R3).
4. **Data** : neutraliser/renommer `schema.sql` en `schema.legacy.sql` documenté comme non exécutable ; étudier l'ajout de **Row-Level Security** PostgreSQL comme défense en profondeur tenant (R4, R7).
5. **Admin** : ne plus exposer les `VAR_*` brutes ; lister uniquement des clés sur allowlist (R6).
6. **Tests** : prioriser `chat.service`, `admin.routes`, `factory`, `catalog`, connecteurs CRM (R8).
7. **QG** : converger vers une vue de supervision unifiée et formaliser une **gestion distante contrôlée** des bots (CRUD config versionnée + historique + rollback déjà partiellement présents). Voir ADRs.
8. **Observabilité** : enrichir `/priv` (état des bots, activité, erreurs récentes par tenant) au-delà de l'infra.

---

## 7. Plan d'action proposé (par phases, validation requise avant modif comportementale)

**Phase 0 — Découverte** ✅ (ce document, SYSTEM_MAP, SECURITY_REVIEW, ARCHITECTURE).

**Phase 1 — Durcissement sans risque** (réversible, pas de changement de flux) :
- `npm audit fix` serveur + revérifier `verify`.
- Nettoyage config secrets par défaut (compose) + doc rotation.
- Correctif Dockerfile (suppression masquage TS).
- Marquage `schema.sql` legacy non exécutable.

**Phase 2 — Sécurité données** (validation requise) :
- Restreindre l'exposition `VAR_*` admin.
- Étude RLS PostgreSQL (POC sur table `leads`).
- Politique de gestion des `.env.backup.*`.

**Phase 3 — Qualité production** :
- Tests ciblés services métier.
- Enrichissement logs/diagnostics par tenant.

**Phase 4 — Évolution QG & gestion distante** (validation requise, ADRs) :
- Vue de supervision unifiée (santé bots + infra + activité).
- CRUD distant contrôlé des bots avec versioning, historique, rollback, permissions.

Chaque phase : observer → comprendre → proposer → modifier → tester → documenter. Aucun changement de la logique LLM/Groq, du design widget ou des payloads CRM sans demande explicite.

---

## 8. Ce qui n'a PAS été modifié

Conformément à la Phase 0 et au handoff : **aucun fichier de code n'a été modifié**. Seuls des fichiers de documentation d'audit ont été créés sous `bibliotheque/`. Les commandes exécutées sont non destructives (`npm audit`, `npm ls`, `git status`).


---

## 9. Mise à jour 2026-06-19 (soir) — État réel vs plan

> Le plan §7 a **largement progressé**. Synchronisation avec `main@9346634` (vérifié dans le code).

- **Phase 1 (durcissement)** : ✅ faite (F1-F4, F7, F9, F10 — voir `REMEDIATION_LOG.md`). `npm audit` = **0 vuln** (racine + serveur).
- **Phase 2 (sécurité données)** : partiellement faite — **chiffrement AES-256-GCM au repos** livré (`utils/crypto.ts`) pour les secrets CRM par tenant et le secret TOTP ; RLS (F8) toujours différée (ADR_0003) ; backups `.env.*` (F5) = décision opérateur.
- **Phase 3 (qualité)** : tests métier ajoutés (Phase 2 du log, 63 tests) ; métriques réelles + surveillance livrées.
- **Phase 4 (évolution QG & gestion distante)** : **largement livrée** — Command Center React à `/qg`, config par tenant **versionnée + rollback**, **redéploiement contrôlé** (confirmation + single-flight), provisioning d'agences, registre clients, CRM par agence, facturation Stripe, **2FA TOTP**, vue Cloudflare Workers (lecture seule). Cadrage : `.kiro/specs/command-center-remote-control/` (R1-R19).

**Détail architectural à jour** : voir `architecture/ARCHITECTURE.md` §10. **Re-audit sécurité du périmètre élargi** : `SECURITY_REVIEW.md` §7 (findings F15-F18).

**Chantier ouvert (non commité)** : module « machine à mandats » (estimation DVF/DPE → capture de mandat) dans le working tree — à finaliser dans sa propre branche, puis auditer et documenter.
