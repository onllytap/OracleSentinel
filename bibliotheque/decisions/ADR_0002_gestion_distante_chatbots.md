# ADR_0002 — Gestion distante contrôlée des chatbots

- **Statut** : Proposé (en attente de validation)
- **Date** : 2026-06-19
- **Décideurs** : propriétaire produit + ingénierie
- **Références** : `factory.routes.ts`, `server/src/factory/`, `bibliotheque/architecture/ARCHITECTURE.md` §6

---

## Contexte

La mission demande de pouvoir gérer un chatbot **à distance** : consulter sa configuration, modifier ce qui est prévu par le système, appliquer des changements contrôlés, vérifier le résultat, garder un historique.

**Bonne nouvelle** : une grande partie existe déjà dans `/factory` :
- `GET /api/factory/config` (config redactée), `PUT /api/factory/config` (validation Zod + diff + backup `.env`) ;
- `POST /api/factory/build` (pipeline), `GET /api/factory/readiness`, `GET /api/factory/observability`, `GET /api/factory/logs` ;
- tests de connexion (LLM/CRM/DB/webhook avec garde SSRF) ;
- `POST /api/factory/rollback/latest` (restaure le dernier backup `.env`) ;
- historique de builds (`FactoryBuildHistoryService`, table `factory_builds`).

**Limites actuelles** :
1. La configuration d'un bot est portée par des **fichiers `.env`** (et `WIDGET_TENANT_MAP`), pas par un enregistrement versionné par tenant en base. Le « rollback » se fait au niveau `.env` global, pas par bot.
2. Pas d'**historique structuré des changements de config par tenant** (qui a changé quoi, quand, pourquoi), ni de diff persistant.
3. Auth super-admin **mono-utilisateur** (`ADMIN_API_KEY`) : pas de notion d'utilisateur/permission par action (l'upgrade better-auth est câblé mais non activé).

## Décision

Formaliser la gestion distante **par addition incrémentale**, en s'appuyant sur l'existant et **sans** modifier la logique LLM/Groq ni les payloads CRM :

1. **CRUD de configuration versionné par tenant** (nouveau, additif) :
   - Table `bot_config_versions(tenant_id, version, config_json, author, reason, created_at, status)` — append-only.
   - **Create/Update** = nouvelle version (jamais d'écrasement). **Read** = version courante + historique. **Delete** = *soft-delete* (statut `archived`), jamais de suppression physique.
   - La config validée par Zod (réutiliser les schémas `factory/validation`) ; les secrets restent hors de cette table (référencés par clé, valeurs en `.env`/coffre).
2. **Changements contrôlés** : tout changement passe par le pipeline existant — `diff` → `dry-run`/`readiness` → `apply` → **vérification** (tests connexion + health) → consignation d'une version. En cas d'échec, **rollback** vers la version précédente.
3. **Historique & audit** : journaliser chaque action (acteur, tenant, diff, résultat) — réutiliser `factoryLog`/`logBuffer` et persister un enregistrement d'audit.
4. **Permissions** (phase ultérieure) : activer better-auth (déjà présent) pour passer de mono-admin à multi-utilisateur + 2FA, et introduire des rôles (`viewer`, `operator`, `owner`). Les actions destructrices (purge tenant, delete) exigent le rôle le plus élevé + confirmation.

## Conséquences

**Positives**
- Gestion distante **traçable et réversible** par bot (et non plus seulement au niveau `.env` global).
- S'appuie sur les briques existantes (validation, build, rollback, history) → faible risque.
- La suppression définitive est évitée par défaut (soft-delete + historique), conforme au handoff.

**Négatives / coûts**
- Nouveau modèle de données (`bot_config_versions` + audit) → migration **additive** (via `ensure-db` idempotent, jamais destructive).
- Complexité accrue du chemin de configuration (versioning) → à couvrir par des tests.

**Risques & mitigations**
- *Divergence `.env` ↔ table de versions* : définir clairement la **source de vérité** (proposition : la table devient la source pour la config non-secrète ; les secrets restent en `.env`/coffre). À trancher avant implémentation.
- *Changement de comportement bot* : interdit sans validation. Le versioning **n'altère pas** la logique LLM ; il encapsule la config existante.

## Plan d'implémentation (après validation, par étapes)

1. **Étape A (lecture)** : exposer proprement la config courante + historique de builds par tenant (réutilise l'existant, zéro risque).
2. **Étape B (versioning additif)** : table `bot_config_versions` (ensure-db additif) + endpoints `GET/POST /api/factory/tenants/:tenantId/config` (create=version), `GET …/config/history`, `POST …/config/:version/rollback`.
3. **Étape C (audit)** : table/flux d'audit des actions.
4. **Étape D (permissions)** : activation better-auth + rôles (ADR dédié si retenu).

Chaque étape : tests + doc + validation avant la suivante.

## Alternatives écartées

- **Édition directe des `.env` à distance** : rejetée (pas d'historique par bot, risque de casse globale, secrets exposés).
- **Suppression physique des configs** : rejetée (handoff : pas de suppression sans validation ; préférer soft-delete).
