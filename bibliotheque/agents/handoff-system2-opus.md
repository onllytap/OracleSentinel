# 🛰️ HANDOFF — Sauvetage sécurité & stabilité de SYSTEM 2 (AAE)
### De : l'agent « Sentinel » → À : **Claude 4.8 Opus**, développeur en charge de System 2

> Ce document est un **prompt de mission zéro-contexte** à coller dans une session de l'agent
> qui travaillera sur `SYSTEM 2 VRAI`. Il est volontairement exhaustif.

---

## 0. Qui je suis (l'agent qui te passe le relais)

Je suis l'agent IA d'ingénierie qui a **audité, sécurisé et fait évoluer le chatbot Sentinel**
(le « Système 1 », `D:\Chatbot - Copy`). Concrètement, sur Sentinel j'ai :
- réalisé un audit complet (sécurité, archi, données) et corrigé une série de findings
  (mots de passe par défaut, dépendances vulnérables, masquage de secrets, CSRF/SameSite,
  isolation multi-tenant, etc.) ;
- construit le **QG / Command Center** de supervision de flotte ;
- mis en place tests, CI, et **branché Sentry** pour la surveillance des erreurs.

**Mon rôle** : ingénieur senior SaaS / sécurité applicative / backend & frontend / production.
Je raisonne « cause racine », je ne masque pas les symptômes, et je commit à chaque fin de mission.

**Comment je t'ai trouvé** : en branchant Sentry sur Sentinel, j'ai récupéré les issues via l'API
Sentry. Surprise : **les 11 erreurs ne viennent pas de Sentinel** (Express + `pg`) mais de **TON
système** (Fastify + Drizzle + `postgres` + BetterAuth, routes `/v1/*`, tables MLS/connectors/
events). D'où ce relais. **Toi, tu es le développeur qui va sauver System 2.** J'attends beaucoup
de toi : sa **sécurité** et sa **stabilité** en dépendent.

---

## 1. Ta mission

**Restaurer la stabilité et la sécurité de SYSTEM 2 (la plateforme AAE — Auto-Action Engine).**
Aujourd'hui il **crashe en production** (erreur fatale récurrente) et sa **couche base de données
échoue** massivement (vu dans Sentry). C'est l'épine dorsale de l'écosystème : il doit devenir
**solide comme de la roche**.

---

## 2. Comment se présente System 2 (le projet)

- **Chemin** : `C:\Users\LDO2026\Desktop\01_Mes_Projets\PROJET\PROJET\SYSTEM 2 VRAI`
- **Monorepo** Turborepo + pnpm (`turbo.json`, `pnpm-workspace.yaml`).
- **`apps/api`** — le backend où sont TOUTES les erreurs :
  - **Fastify** (Node 20, TypeScript) + **Drizzle ORM** + driver **`postgres`** (porsager) + **BetterAuth**, **PostgreSQL**.
  - `src/index.ts` (entrée Fastify), `src/routes/` (les routes `/v1/mls`, `/v1/connectors`,
    `/v1/actions`, `/v1/webhooks/event`…), `src/db/` (schéma + connexion Drizzle), `src/lib/`,
    `src/plugins/` (hooks Fastify), `src/services/`, `src/workers/` (cron-jobs), `src/__tests__/`.
  - **Migrations** : dossier `drizzle/` + `drizzle.config.ts`.
  - ⚠️ Présence de `apps/api/compile_errors.txt` et `tsc.log` → **il y a (eu) des erreurs de
    compilation TypeScript** : à traiter (un build sain est la base de la stabilité).
  - Tests : `vitest.config.ts` + `vitest.integration.config.ts`.
- **`apps/web`** — cockpit Next.js (human-in-the-loop).
- **Infra** : Docker (`docker-compose.prod.yml` / `docker-compose.vps.yml`), Caddy, n8n,
  Documenso, OpenTelemetry, Prometheus, PM2 (`ecosystem.config.cjs`), déploiement VPS.
- **Domaine** : automatisation immobilière — connexions **MLS**, **connectors**, ingestion
  d'**events**, **action_drafts** (actions suggérées par IA, validées par un humain).

> Commence par lire les docs internes : `SYSTEM 2 VRAI/AUDIT.md`, `docs/`, `00_AUDIT_ENTREPRISE_DOCS/`.

---

## 3. Les erreurs réelles (Sentry)

- **Org** : `oraclesentinel` · **Projet** : `javascript-nextjs` · **Région** : EU (`de.sentry.io`).
- 11 issues non résolues (sur ~90 j). Triées :

**A) Couche base de données qui échoue (le gros du problème)**
- `BetterAuthError: Failed to initialize database adapter` (x5)
- `Failed query: insert into "events" (...)` — culprit `POST /v1/webhooks/event` (x13)
- `Failed query: select ... from "mls_connections" ...` — `GET /v1/mls` (x12)
- `Failed query: select "id","tenant_id" from "mls_connections" ...` — `cron-jobs.ts` (x1)
- `Failed query: insert/select ... "connectors" ...` — `POST/GET /v1/connectors` (x3, x1, x1)
- `Failed query: select ... from "action_drafts" ...` — `POST /v1/actions/execute-batch`, `GET /v1/actions` (x1, x9)

**B) Bug code — driver `postgres`**
- `Error: NOT_TAGGED_CALL: Query not called as a tagged template literal` — `postgres.src:types` (x10)

**C) Crash FATAL (stabilité)**
- `TypeError: Cannot read properties of undefined (reading 'length')` — hook **Fastify** (`next(fastify.lib:hooks)`) (x21)

---

## 4. Comment JE les aurais corrigées (approche générale — à toi de confirmer par l'investigation)

**A) DB + BetterAuth adapter (probable cause commune)**
Le faisceau « toutes les requêtes échouent » + « adapter DB qui ne s'initialise pas » sent la
**connexion/migrations**, pas 10 bugs indépendants. Hypothèses, par ordre :
1. **Migrations Drizzle non appliquées** dans l'environnement qui crashe → tables absentes/désync
   (`mls_connections`, `connectors`, `action_drafts`, `events`). → Vérifier `drizzle/`, lancer
   `drizzle-kit migrate` (ou le script de migration) au **déploiement**, et ajouter un
   **healthcheck DB au démarrage** qui échoue proprement avec un message clair.
2. **`DATABASE_URL` erronée / DB injoignable** (mauvais host/credentials/SSL en prod). → Valider la
   variable d'env de prod, le SSL, le pooling.
3. **BetterAuth** partage la même DB → si la DB est KO, l'adapter ne s'init pas. Corriger la DB
   résout probablement aussi le `BetterAuthError`.
→ Méthode : reproduire en local avec la vraie config, confirmer si c'est migrations vs connexion,
corriger à la racine, **ne pas avaler l'erreur** (logger la cause), ajouter un test d'intégration DB.

**B) `NOT_TAGGED_CALL`**
Le driver `postgres` exige `` sql`SELECT ...` `` (tagged template). Cette erreur = quelque part on
appelle `sql( ... )` comme une fonction normale (souvent une interpolation dynamique mal faite, ou
un helper qui passe une string). → `grep` les usages de `sql(` dans `apps/api/src`, corriger en
tagged template ou via le query builder Drizzle, et bannir l'anti-pattern (règle lint si possible).

**C) Crash fatal `Cannot read '...length' of undefined` (hook Fastify)**
Un hook (`onRequest`/`preHandler`/`preValidation`…) lit `.length` sur quelque chose d'`undefined`
(headers, body, un tableau attendu, un résultat de requête vide…). C'est ce qui **fait tomber des
requêtes entières** (fatal x21). → Localiser le hook dans `src/plugins/`, reproduire via la route
incriminée, **guarder** l'accès (optional chaining / validation d'entrée / valeur par défaut),
ajouter un test de régression sur le cas `undefined`.

**Transverse (stabilité) :** régler les **erreurs TS** (`compile_errors.txt`/`tsc.log`) pour avoir
un **build vert**, puis `vitest` vert. Un service qui ne compile pas proprement n'est pas stable.

---

## 5. Ce que j'attends de toi (méthode + exigences)

1. **Observer → comprendre → reproduire → corriger la cause racine → tester → documenter → commit.**
2. **Priorités** : (1) le **crash fatal x21** (stabilité immédiate) ; (2) la **couche DB**
   (migrations/connexion — débloque la majorité) ; (3) le bug **`NOT_TAGGED_CALL`** ; (4) BetterAuth.
3. **Sécurité** : valider les entrées (les routes `/v1/*` et `webhooks/event` ingèrent de l'externe),
   ne jamais committer de secret (`.env`, tokens), vérifier l'auth/permissions des routes.
4. **Stabilité** : build TypeScript **vert** (traite `compile_errors.txt`), tests **verts**,
   healthchecks, gestion d'erreurs explicite (pas de `catch` silencieux).
5. **Ne casse pas la prod** : changements réversibles, vérifie build+tests AVANT tout déploiement,
   migrations idempotentes avec rollback.
6. **Commit en fin de mission** dans le **repo de System 2** (vérifie son remote/branche ; **ne touche
   PAS** au repo de Sentinel `D:\Chatbot - Copy`).

---

## 6. Garde-fous (impératifs)

- **Travaille UNIQUEMENT dans `SYSTEM 2 VRAI`.** Ne modifie pas `D:\Chatbot - Copy` (Sentinel — c'est
  mon système, il est sain).
- **Aucun secret** dans le code/commits ; référence par nom de clé.
- Reproduis avant de corriger ; **cause racine, pas symptôme** ; ajoute des **tests de régression**.
- Documente tes décisions (un `AUDIT.md`/journal dans System 2).

---

## 7. Vérifier dans Sentry (après correction)

- Accès : org `oraclesentinel`, projet `javascript-nextjs`, **API région EU `https://de.sentry.io`**
  (un **User Auth Token** Sentry suffit ; ne l'écris jamais en clair dans un fichier versionné).
- Après fix : marque les issues **résolues** et surveille la **non-récurrence**.
- 💡 Reco : crée un **projet Sentry distinct par application** (un pour System 2, un pour Sentinel) —
  aujourd'hui ils risquent de se mélanger dans `javascript-nextjs`.

---

## 8. Définition de réussite

✅ Plus de crash fatal (`length` of undefined) · ✅ couche DB OK (migrations + connexion, plus de
`Failed query`) · ✅ `NOT_TAGGED_CALL` éliminé · ✅ `BetterAuthError` résolu · ✅ **build TS + tests
verts** · ✅ entrées validées / pas de secret commité · ✅ changements commités dans le repo de
System 2 · ✅ issues Sentry résolues et non récurrentes.

> Bonne chance. La stabilité de tout l'écosystème repose sur ce sauvetage. — *l'agent Sentinel*
