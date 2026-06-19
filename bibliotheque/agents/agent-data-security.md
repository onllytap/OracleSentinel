# Agent — Data Security Hardening

> Journal de l'agent "protection des données / défense en profondeur".
> Branche : `feat/data-security-hardening`. Date : 2026-06-19.
> Règle d'or respectée : **par défaut, rien ne change en production** — tout
> nouveau contrôle risqué est derrière un flag OFF ou une variable vide, et
> reste réversible.

---

## 1. Résumé exécutif

Durcissement de la protection des données en 3 paliers, **sans rien casser en
prod** :

| Palier | Objet | Effet par défaut | Activation |
|---|---|---|---|
| 1a | TLS DB env-driven (F12) | Inchangé (chaîne non validée + warning) | `DB_SSL_REJECT_UNAUTHORIZED=true` (+ `DB_SSL_CA`) |
| 1b | Redaction PII des logs (RGPD) | Masquage auto email/téléphone dans les logs `logger` | Toujours actif (sans rien supprimer) |
| 1c | `.dockerignore` racine durci | Secrets/backups/outils IA hors image | Toujours actif |
| 1d | Rétention `.env.backup.*` (F5/F14) | Aucune suppression (dry-run) | `-Force` (opérateur) |
| 1e | CI sécurité (F6) | `npm audit` bloquant HIGH + gitleaks visible | Toujours actif (CI) |
| 2 | RLS multi-tenant (F8) | **OFF** (`DB_RLS_ENABLED` non défini) | migration 003 + `DB_RLS_ENABLED=true` |
| 3a | Secret session admin distinct (F9) | Refus **en prod** si secret faible | Auto en prod (config requise) |
| 3b | IP allowlist admin | Aucun filtrage (variable vide) | `ADMIN_IP_ALLOWLIST=<csv>` |
| 3c | Effacement RGPD par lead | Endpoint dispo (session+CSRF+confirmation) | Sur demande opérateur |

2FA / TOTP : **non touché** (déféré au spec `command-center-remote-control`).

---

## 2. Nouvelles variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `DB_SSL_REJECT_UNAUTHORIZED` | (vide → `false`) | `true`/`1` : valide la chaîne TLS de la DB |
| `DB_SSL_CA` | (vide) | PEM inline (`-----BEGIN…`) ou chemin de fichier pour épingler la CA |
| `DB_RLS_ENABLED` | (vide → `false`) | `true`/`1` : route le chemin tenant via `withTenant` (RLS) |
| `ADMIN_IP_ALLOWLIST` | (vide → aucun filtrage) | CSV d'IP autorisées sur `/api/admin` & `/api/priv` |
| `ADMIN_SESSION_SECRET` | — | **Requis en prod**, distinct de `ADMIN_API_KEY` (F9) |

Aucune de ces variables n'est requise pour conserver le comportement actuel,
**sauf** `ADMIN_SESSION_SECRET` qui devient obligatoire en production (voir 3a).

---

## 3. Détail par palier

### Palier 1a — TLS DB (F12) — `server/src/db/pool.ts`
- `resolveDbSslConfig(databaseUrl, env)` exporté (testé).
- Défaut **strictement inchangé** : hôte distant / `sslmode=require` →
  `{ rejectUnauthorized: false }` (+ un warning unique au boot) ; hôte local →
  pas de TLS. Donc zéro risque de couper Neon.
- Durcissement opt-in : `DB_SSL_REJECT_UNAUTHORIZED=true` valide la chaîne ;
  `DB_SSL_CA` épingle une CA (PEM inline ou chemin). Lecture de CA en échec =
  log d'erreur + on continue sans pin (jamais de crash).
- **Runbook prod** : valider d'abord la connectivité Neon, puis poser
  `DB_SSL_REJECT_UNAUTHORIZED=true` (et éventuellement `DB_SSL_CA`).

### Palier 1b — Redaction PII (RGPD) — `server/src/utils/logger.ts`
- Ajout `redactEmail`, `redactPhone`, `redactPII`, `redactPIIDeep`.
- Pino : `redact.paths` étendu aux champs PII (`email`, `phone`, `telephone`,
  `tel`, `*.email`, …, `req.body.*`) + hook `logMethod` qui masque l'email/le
  téléphone **dans les chaînes de message** uniquement (les objets/nombres ne
  sont pas altérés → aucun log utile corrompu, aucun niveau de log changé).
- **Audit** : `server/src/services/chat.service.ts` n'écrit pas d'email/téléphone
  dans les logs (`submitLeadForm` insère en DB paramétré + push CRM). Seul point
  d'attention : un log **dev-only** `console.log("… for:", userMessage.substring(0,50))`
  dans `processMessage`. Ce fichier est **hors de ma zone** (équipe chatbot) ;
  recommandation : router ce log via `logger`/`redactPII`. Non modifié ici.

### Palier 1c — `.dockerignore` (racine, nouveau)
- Le contexte de build de `Dockerfile.production` est la racine et il n'y avait
  pas de `.dockerignore` racine. Ajout : exclusion de `.env*`, `*.env.backup*`,
  `ORACLESENTINEL_CONFIG.txt`, `*.pem`/`*.key`, dossiers d'outils IA
  (`.agent`…`.windsurf`), `bibliotheque/`, docs, `Chatbot/`, `ai-chat-agent-main/`,
  `scripts/`, `build/`, `dist/`.
- **Vérifié** : aucune exclusion ne couvre un chemin que le Dockerfile copie
  explicitement (`src/`, `public/`, `*.config.*`, `index.html`,
  `factory-dashboard.html`, `package*.json`, `server/src`).

### Palier 1d — Rétention backups (F5/F14) — `scripts/rotate-env-backups.ps1`
- Conserve les N plus récents `.env.backup.*` (défaut 3), **dry-run par défaut**
  (`Remove-Item -WhatIf`) : ne supprime jamais tout seul.
- Suppression réelle uniquement avec `-Force` (décision opérateur).
- Testé : 10 backups détectés → 3 KEEP / 7 PURGE simulés, 0 supprimé.
- Recommandations VPS documentées dans l'en-tête : coffre (SOPS/age/Vault),
  `.env` hors arborescence web, permissions `chmod 600`, rotation des secrets.

### Palier 1e — CI sécurité (F6) — `.github/workflows/security-audit.yml`
- Fichier **distinct** de `ci.yml` (qui a déjà un job Snyk) → additif, sans
  collision.
- Job `npm-audit` : **bloquant** sur HIGH/CRITICAL (racine + serveur).
- Job `gitleaks` : binaire pinné (v8.18.4), **visible mais non bloquant**
  (`continue-on-error`) + rapport SARIF en artefact. À passer en bloquant une
  fois l'historique vérifié propre.

### Palier 2 — RLS multi-tenant (F8 / ADR_0003) — RÉVERSIBLE & OFF par défaut
- `server/src/db/rls.ts` :
  - `RLS_TENANT_TABLES` : `conversations`, `messages`, `leads`,
    `catalog_properties`, `catalog_import_runs`.
  - `withTenant(tenantId, fn)` : transaction + `set_config('app.tenant_id', $1, true)`
    (équivalent paramétré et **transaction-local** de `SET LOCAL`, compatible
    pooling).
  - `withAdminBypass(fn)` : transaction + `set_config('app.bypass_rls','on',true)`
    pour les endpoints d'agrégation cross-tenant (`/api/admin/db/*`,
    `/api/priv/overview`, `fleet.service`) → ils voient **tous** les tenants.
  - `tenantQuery(...)` : point d'intégration unique. Flag OFF → `pool.query`
    (comportement actuel **inchangé**) ; flag ON → `withTenant`.
  - `isRlsEnabled()` lit `DB_RLS_ENABLED` (OFF par défaut).
- Migration `003_rls_multitenant.sql` (+ `.rollback.sql`) : idempotente,
  `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`
  (`bypass_rls='on' OR tenant_id = current_setting('app.tenant_id')`). Source de
  vérité = `rls.ts`.
- **Important** : la migration n'est **pas** appliquée au boot. L'activation est
  une décision opérateur en environnement de test (voir Runbook RLS ci-dessous).
- Tests `server/src/db/__tests__/` :
  - `pool-tls.test.ts` (résolveur TLS),
  - `rls.test.ts` (unitaires sur pool mocké + intégration réelle sous
    `TEST_DATABASE_URL`),
  - `tenant-isolation.test.ts` (contrat applicatif + preuve cross-tenant DB).

### Palier 3a — Secret session admin (F9) — `server/src/middleware/admin-session.ts`
- En **production** : `resolveAdminSessionSecret()` **refuse** (throw) si
  `ADMIN_SESSION_SECRET` est absent, ou s'il est égal à `ADMIN_API_KEY`.
- En **dev** : fallback `JWT_SECRET`/`ADMIN_API_KEY` conservé + warning (rien
  cassé en local / tests).
- Un déploiement qui a déjà un `ADMIN_SESSION_SECRET` distinct n'est pas affecté.
- Test ajouté : `__tests__/admin-session-secret.test.ts` (fichier distinct).

### Palier 3b — IP allowlist admin — `server/src/index.ts`
- `ADMIN_IP_ALLOWLIST` (CSV) → middleware `adminIpAllowlist()` appliqué à
  `/admin`, `/api/admin`, `/priv`, `/api/priv`.
- **Variable vide → aucun filtrage** (no-op, défaut inoffensif). Sinon 403 hors
  liste. Utilise `req.ip` (cohérent avec `trust proxy` en prod).

### Palier 3c — Effacement RGPD par lead — `server/src/routes/admin.routes.ts`
- `DELETE /api/admin/db/lead/:id` : `requireAdminSession` + `requireCSRF`,
  validation UUID, **confirmation requise** (`{ "confirm": true }` ou
  `?confirm=true`).
- Transaction : supprime le lead (`RETURNING tenant_id, conversation_id`) ; si
  `?cascade=true`, supprime aussi la conversation liée et ses messages
  (effacement PII complet). 404 si lead absent.
- **Audit sans PII** : journalise `leadId`, `tenantId`, `cascade`, compteurs —
  jamais l'email/le téléphone. Effacement volontairement **définitif** (droit à
  l'oubli).
- Note : à l'activation RLS, les routes admin doivent passer par
  `withAdminBypass`.

---

## 4. Runbooks d'activation

### TLS DB (F12)
1. Confirmer la connectivité Neon en l'état (rien à changer).
2. Poser `DB_SSL_REJECT_UNAUTHORIZED=true` dans l'env de prod. Optionnel :
   `DB_SSL_CA=/chemin/neon-ca.pem` (ou contenu PEM) pour épingler la CA.
3. Redémarrer ; vérifier la connexion + l'absence du warning TLS.
4. Rollback : retirer la variable → comportement d'origine.

### RLS (F8) — en environnement de TEST d'abord
1. Préparer une base **de test** distincte ; exporter `TEST_DATABASE_URL`.
2. Lancer la suite : `cd server && npx vitest run src/db` (les tests
   d'intégration RLS s'exécutent alors et prouvent l'isolation A/B + bypass).
3. Appliquer la migration : `psql "$TEST_DATABASE_URL" -f server/src/db/migrations/003_rls_multitenant.sql`.
4. Faire tourner l'app de test avec `DB_RLS_ENABLED=true` et router le chemin
   widget/chat via `tenantQuery`/`withTenant` ; router les vues d'agrégation
   admin via `withAdminBypass`.
5. Valider tous les chemins (chat, admin, factory, /priv). Surveiller les
   « 0 row » inattendus (signe d'un chemin sans contexte tenant).
6. Rollback : `psql … -f server/src/db/migrations/003_rls_multitenant.rollback.sql`
   et retirer `DB_RLS_ENABLED`. Réversible à 100 %.
7. **Ne pas activer en prod** sans cette validation (décision opérateur).

### IP allowlist admin
- Poser `ADMIN_IP_ALLOWLIST="1.2.3.4,5.6.7.8"`. Vérifier l'accès depuis une IP
  listée (OK) et non listée (403). Vider la variable pour désactiver.

---

## 5. Vérification (2026-06-19)
- `cd server && npx vitest run` → **167 passed | 7 skipped** (les 7 skip = tests
  d'intégration RLS sans `TEST_DATABASE_URL`). 0 test cassé.
- `npm audit` racine = **0 vuln** ; serveur = **0 vuln** (0 HIGH).
- `npx tsc --noEmit` : **mes fichiers sont 100 % type-clean**.

### Note multi-agent (à l'attention du lead)
Au moment de la vérif, `npx tsc` (donc `npm run build`) échoue avec **3 erreurs
uniquement** dans `server/src/services/__tests__/chat.service.test.ts`
(`'res.qualification' possibly undefined`). Ce fichier est **untracked** (absent
de HEAD) : c'est le WIP d'un **autre agent** (zone `services/`), pas le mien. Il
n'entre pas dans mes commits ; sur un checkout propre de ma branche (CI), il est
absent → build vert. Le build prod (`Dockerfile.production`, esbuild) n'exécute
pas `tsc` sur les tests → non affecté. Correctif trivial côté propriétaire :
`res.qualification!.pushedToCRM` ou `res.qualification?.pushedToCRM`.

---

## 6. Garde-fous respectés
- Aucune modification de la logique LLM/Groq, du widget, des payloads CRM.
- Aucune modification frontend (`src/**`), ni du sous-dépôt `Chatbot/`, ni du
  flux 2FA/TOTP.
- Aucun secret en clair dans le code/commits ; valeurs `.env` jamais lues ni
  affichées (référencées par nom de clé).
- Tout est réversible (flags, variables vides, migrations avec rollback,
  fallback de connexion DB garanti).
- Commits limités à mes fichiers (jamais `git add -A`).
