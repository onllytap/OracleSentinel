# Implementation Plan — Command Center v2.1 (R1–R19)

> Plan d'exécution **additif** par vagues. Source : `requirements.md` (R1–R19) + `design.md`.
> Règles absolues : ne rien casser, ignorer `Chatbot/`, ne pas démarrer de serveur long, ne pas
> committer/déployer (orchestrateur uniquement, entre les vagues). Chaque agent n'édite QUE ses
> **fichiers possédés**. `main` reste vert et déployable après chaque vague.

## Conventions

- `[P]` = peut tourner **en parallèle** dans sa vague (fichiers disjoints). `[S]` = **sérialisé**.
- Chaque tâche déclare : **Requirements**, **Fichiers possédés** (exclusifs), **Vague**,
  **Dépend de**, **Vérif**.
- **Vérif standard (DoD)** — exécuter avant de rendre :
  ```
  cd server && npx tsc --noEmit          # exit 0
  cd server && npx vitest run <ciblé>    # vert
  npm run build                          # (racine) OK  — uniquement si UI/build impacté
  python scripts/qg_preprod_test.py      # vert — uniquement si l'API change (après extension T14)
  ```
- **NE PAS committer** : les ~170 icônes non suivies `assets/icon/*.png`, ni le sous-module `Chatbot`.

## Vue d'ensemble des vagues (DAG)

```
Vague 0 (SÉRIEL, fichiers partagés) :  1. T0
        │
        ▼
Vague 1 (PARALLÈLE, disjoint)       :  2.T1 [P]  3.T2 [P]  4.T3 [P]  5.T4 [P]  6.T5 [P]
        │
        ▼
Vague 2 (PARALLÈLE, disjoint)       :  7.T6 [P]  8.T7 [P]  9.T8 [P]  10.T9 [P]
        │
        ▼
Vague 3                             :  11–14 (T10–T13) QG-front [S sur CommandCenter.tsx]
                                       15.T14 [P]   16.T15 [P]
```

---

## Vague 0 — Fondations (SÉRIEL)

- [ ] 1. **(T0) Infra & wiring** — socle additif partagé `[S]`
  - [ ] 1.1 Créer `server/src/utils/crypto.ts` (AES-256-GCM) : `isEncryptionConfigured`,
        `encryptSecret`/`decryptSecret` (blob `base64(iv12||tag16||ct)`), `encryptJson`/`decryptJson`.
        Prod sans `APP_ENCRYPTION_KEY` → lève ; dev → clé dérivée + warn. Jamais de log de secret.
  - [ ] 1.2 Étendre `server/src/db/ensure-db.ts` : ajouter (idempotent) les 5 tables `tenants`,
        `tenant_crm_configs`, `tenant_subscriptions`, `usage_events`, `audit_log` (+ index) — cf.
        design §7. Ne pas modifier les tables existantes.
  - [ ] 1.3 Créer 6 stubs de routers (exportent un `Router` vide monté, renvoyant 501/`not_implemented`
        en attendant leur vague) : `routes/tenant.routes.ts`, `routes/tenant-crm.routes.ts`,
        `routes/billing.routes.ts`, `routes/rgpd.routes.ts`, `routes/metrics.routes.ts`,
        `routes/redeploy.routes.ts`.
  - [ ] 1.4 `server/src/index.ts` : monter le **webhook Stripe public** `POST /api/billing/webhook`
        avec `express.raw({type:'application/json'})` **AVANT** `express.json` (import gardé,
        no-op si module billing absent) ; monter les 6 routers sous `/api/priv` (gated
        `adminIpAllowlist`) **après** `express.json`.
  - [ ] 1.5 `.env.example` : ajouter (append) `APP_ENCRYPTION_KEY`, `BILLING_ENABLED=false`,
        `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER|PRO|SCALE`,
        `ADMIN_BREAK_GLASS` (commentés, sans valeurs).
  - _Requirements: socle de R17/R18/R19 ; prépare R5/R6/R7/R11_
  - _Fichiers possédés: `server/src/utils/crypto.ts`, `server/src/db/ensure-db.ts`,
    `server/src/index.ts`, `server/src/routes/{tenant,tenant-crm,billing,rgpd,metrics,redeploy}.routes.ts`,
    `.env.example`_
  - _Vague: 0 (SÉRIEL) · Dépend de: — · Vérif: `tsc --noEmit`_
  - _Note: déviation assumée du PLAN (6 stubs au lieu de 4) pour éviter la contention de
    `command-center.routes.ts` entre T5 et T9 (cf. design §4.5/§4.6)._

---

## Vague 1 — Backend fondations (PARALLÈLE, disjoint)

- [ ] 2. **(T1) CRM par agence (chiffré)** `[P]`
  - [ ] 2.1 `services/tenant-crm.service.ts` : `getTenantCrmConfig`, `saveTenantCrmConfig`
        (secrets chiffrés via `crypto.ts`), `testTenantCrmConnection` (message non secret),
        `pushLeadForTenant(tenantId,lead,sessionId)→{handled,result?}`, `buildTenantConnector`
        (réutilise `new TwentyConnector(cfg)`/`new AirtableConnector(cfg)` + nouveau `WebhookConnector`).
  - [ ] 2.2 `routes/tenant-crm.routes.ts` (remplit le stub) : `GET/PUT /tenants/:id/crm`,
        `POST /tenants/:id/crm/test` ; gated + CSRF sur mutations ; **jamais** de secret en réponse.
  - [ ] 2.3 Tests : round-trip mapping, no-secret-out, fallback (`handled=false`), provider `webhook`.
  - _Requirements: R17.1–R17.9_
  - _Fichiers possédés: `server/src/services/tenant-crm.service.ts`,
    `server/src/routes/tenant-crm.routes.ts`, `server/src/services/**/__tests__/tenant-crm*.test.ts`_
  - _Vague: 1 [P] · Dépend de: T0 (crypto, table, stub, mount) · Vérif: tsc + vitest ciblé + harness_

- [ ] 3. **(T2) Facturation & quotas (Stripe), désactivable** `[P]`
  - [ ] 3.1 `services/billing.service.ts` : `BILLING_ENABLED`, `getPlans/getPlan` (99/299/799 défauts),
        `recordUsage` (no-op si off, ne lève pas), `getTenantUsage`, `isOverQuota`, `getQuotaStatus`,
        `getSubscription` (sans secret), `handleStripeWebhook` (vérif **HMAC** `node:crypto`),
        `stripeWebhookHandler` (exporté pour montage T0).
  - [ ] 3.2 `middleware/quota.middleware.ts` : `enforceQuota(kind)` (402 si over-quota & billing on).
  - [ ] 3.3 `routes/billing.routes.ts` (remplit le stub, mgmt) : `GET /billing/plans`,
        `GET /tenants/:id/billing`, `PUT /tenants/:id/billing/plan` (CSRF, audité).
  - [ ] 3.4 Tests : off = aucun métering ; métering on ; quota ; **signature webhook valide/invalide**.
  - _Requirements: R18.1–R18.7_
  - _Fichiers possédés: `server/src/services/billing.service.ts`,
    `server/src/routes/billing.routes.ts`, `server/src/middleware/quota.middleware.ts`,
    `server/src/**/__tests__/billing*.test.ts`_
  - _Vague: 1 [P] · Dépend de: T0 (table usage/subs, stub, mount webhook) · Vérif: tsc + vitest_

- [ ] 4. **(T3) Provisioning d'agences** `[P]`
  - [ ] 4.1 `services/tenant.service.ts` : `listTenants/getTenant/getTenantByWidgetId`,
        `generateWidgetId`, `buildEmbedSnippet`, `provisionTenant→{tenant,embedSnippet}`,
        `setTenantStatus`, `isTenantServable` (**fail-open** : absent/erreur ⇒ true).
  - [ ] 4.2 `routes/tenant.routes.ts` (remplit le stub) : `GET /tenants`, `POST /tenants/provision`
        (CSRF), `POST /tenants/:id/status` (CSRF, audité), `GET /tenants/:id` ; sans secret.
  - [ ] 4.3 Extension **additive** `middleware/widget-auth.ts` : fallback `getTenantByWidgetId` quand
        `widget_id` absent de `WIDGET_TENANT_MAP` (la map env garde la priorité).
  - [ ] 4.4 Tests : widget_id unique, snippet, fail-open, statut.
  - _Requirements: R19.1–R19.7_
  - _Fichiers possédés: `server/src/services/tenant.service.ts`,
    `server/src/routes/tenant.routes.ts`, `server/src/middleware/widget-auth.ts` (additif),
    `server/src/**/__tests__/tenant*.test.ts`_
  - _Vague: 1 [P] · Dépend de: T0 (table tenants, stub, mount) · Vérif: tsc + vitest + harness_

- [ ] 5. **(T4) Audit & RGPD** `[P]`
  - [ ] 5.1 `services/audit.service.ts` : `appendAudit` (append-only, `meta` filtrée PII/secret,
        ne lève jamais), `listAudit`.
  - [ ] 5.2 `routes/rgpd.routes.ts` (remplit le stub) : `GET /tenants/:id/rgpd/export` (audité),
        `DELETE /tenants/:id/rgpd` (CSRF + double confirmation, soft-anonymisation, audité).
  - [ ] 5.3 Tests : append-only (pas de mutation), `meta` sans secret, export/suppression gated.
  - _Requirements: R5.1–R5.6 (+ RGPD)_
  - _Fichiers possédés: `server/src/services/audit.service.ts`,
    `server/src/routes/rgpd.routes.ts`, `server/src/**/__tests__/audit*.test.ts`_
  - _Vague: 1 [P] · Dépend de: T0 (table audit_log, stub, mount) · Vérif: tsc + vitest_

- [ ] 6. **(T5) Métriques réelles & latence** `[P]`
  - [ ] 6.1 `services/metrics.service.ts` : `getBotMetrics`, `getFleetMetrics`, `probeLatency`
        (sonde réelle, `AbortSignal.timeout`, `null` si timeout). `responseRate` borné 0..100 ;
        `lastActivityAt` null si aucune activité ; `hostingLocation` sans secret.
  - [ ] 6.2 Extension **additive** `services/surveillance.service.ts` : remplacer le pseudo-ping par
        `metrics.probeLatency` et exposer `BotMetrics` dans le snapshot.
  - [ ] 6.3 `routes/metrics.routes.ts` (remplit le stub) : `GET /tenants/:id/metrics`, `GET /metrics`.
  - [ ] 6.4 Tests : `responseRate` borné, latence null si timeout, `lastActivityAt` none.
  - _Requirements: R6.1–R6.7, R7.1–R7.5 (+ base R8)_
  - _Fichiers possédés: `server/src/services/metrics.service.ts`,
    `server/src/services/surveillance.service.ts` (additif),
    `server/src/routes/metrics.routes.ts`, `server/src/**/__tests__/metrics*.test.ts`_
  - _Vague: 1 [P] · Dépend de: T0 (stub, mount) · Vérif: tsc + vitest_

---

## Vague 2 — Runtime & sécurité (PARALLÈLE, disjoint)

- [ ] 7. **(T6) Hook runtime lead→CRM par tenant + métering + garde statut** `[P]`
  - [ ] 7.1 `services/chat.service.ts` (additif, gardé) — début `processMessage` : garde
        `isTenantServable` (R19.4, fail-open) + paywall `isOverQuota` si `BILLING_ENABLED` (R18.4).
  - [ ] 7.2 Au point de push existant : `pushLeadForTenant(...)` ; si `!handled` → push **global
        inchangé** ; `recordUsage('lead')`. Ajouter `recordUsage('message'|'conversation')`.
  - [ ] 7.3 **NE PAS toucher** la logique compréhension/qualif/LLM. Tous les nouveaux appels en
        try/catch fail-open (jamais de 500). Tests de non-régression chat.
  - _Requirements: R17.6/R17.7/R17.8, R18.3/R18.4, R19.4_
  - _Fichiers possédés: `server/src/services/chat.service.ts`,
    `server/src/services/**/__tests__/chat-hook*.test.ts`_
  - _Vague: 2 [P] · Dépend de: T1 (`pushLeadForTenant`), T2 (`recordUsage`/`isOverQuota`),
    T3 (`isTenantServable`) · Vérif: tsc + vitest ciblé_

- [ ] 8. **(T7) TOTP / 2-step réconcilié avec passkey** `[P]`
  - [ ] 8.1 `services/totp.service.ts` : RFC6238 via `node:crypto` ; secret **chiffré** (`crypto.ts`) ;
        tables `admin_totp`/`admin_recovery_codes` **auto-créées** ; `beginEnrollment`,
        `activateEnrollment` (recovery codes 1×), `verifyTotp`, `consumeRecoveryCode`, `resetTotp`,
        `isBreakGlass`, lockout.
  - [ ] 8.2 `routes/admin.routes.ts` (additif) : insérer la **2e étape TOTP avant**
        `signAdminSessionToken()` dans `POST /session` (si enrôlé) ; endpoints
        `/api/admin/totp/{begin,activate,verify,reset}` (gated/CSRF). Passkey **inchangé**.
        Break-glass via `ADMIN_BREAK_GLASS`. Audit des événements auth.
  - [ ] 8.3 `middleware/admin-session.ts` (additif minimal si nécessaire). Ne pas changer la
        résolution du secret de session ni le CSRF.
  - [ ] 8.4 Tests : RFC6238 (fenêtre), recovery usage unique, lockout, break-glass, login passkey intact.
  - _Requirements: R11.1–R11.8, R12.1–R12.7, R13 (API), R14.1–R14.6, R5.6_
  - _Fichiers possédés: `server/src/services/totp.service.ts`,
    `server/src/routes/admin.routes.ts`, `server/src/middleware/admin-session.ts` (additif),
    `server/src/**/__tests__/totp*.test.ts`_
  - _Vague: 2 [P] · Dépend de: T0 (crypto) · Vérif: tsc + vitest + harness_

- [ ] 9. **(T8) Fix SSRF webhook tester (R9) + deps HIGH (R10)** `[P]`
  - [ ] 9.1 Durcir `POST /api/factory/test/webhook` : scheme http/https only, garde SSRF
        (`utils/ssrf-guard`) sur IP résolues, pas de redirect cross-host ; `.snyk` justifié ou allowlist.
  - [ ] 9.2 `package.json`/lock (racine + server) : upgrades HIGH ; si pas de fix → justification
        documentée. Rollback si build/tests cassent.
  - [ ] 9.3 Vérif `snyk` si dispo + build + vitest.
  - _Requirements: R9.1–R9.5, R10.1–R10.4_
  - _Fichiers possédés: handler `server/src/routes/factory.routes.ts` (section webhook test),
    `package.json` + lockfiles (racine + `server/`), `.snyk` (si utilisé)_
  - _Vague: 2 [P] · Dépend de: — (indépendant) · Vérif: build + vitest + snyk_
  - _Note: contention potentielle `package.json` avec toute autre tâche deps → T8 est seul propriétaire
    des manifests/lock pendant la Vague 2._

- [ ] 10. **(T9) Redéploiement distant d'un bot** `[P]`
  - [ ] 10.1 `services/redeploy.service.ts` : `requestRedeploy` (single-flight/tenant, in_progress→
        succeeded, rollback→rolled_back), `getActiveConfigVersion`, `getRedeployState`, `isOutOfDate` ;
        table `tenant_redeploys` **auto-créée** ; « appliquer » = reload cache tenant-config.
  - [ ] 10.2 Extension **additive** `services/tenant-config.service.ts` : exposer un
        `resetTenantConfigCache(tenantId)` ciblé + sous-objet `runtime?{model,temperature}` validé
        (R1.5/R1.6) dans `sanitizeOverride` (round-trip préservé).
  - [ ] 10.3 `routes/redeploy.routes.ts` (remplit le stub) : `POST /tenants/:id/redeploy`
        (CSRF + confirmation), `GET /tenants/:id/redeploy`.
  - [ ] 10.4 Tests : single-flight, rollback, isolation, out-of-date.
  - _Requirements: R3.1–R3.8, R4.1–R4.5 (+ R1.4/1.5/1.6 via runtime)_
  - _Fichiers possédés: `server/src/services/redeploy.service.ts`,
    `server/src/services/tenant-config.service.ts` (additif),
    `server/src/routes/redeploy.routes.ts`, `server/src/**/__tests__/redeploy*.test.ts`_
  - _Vague: 2 [P] · Dépend de: T0 (stub, mount) · Vérif: tsc + vitest_

---

## Vague 3 — QG front + qualité + GTM

> ⚠️ `src/dashboard/CommandCenter.tsx` (2957 l.) = **point de contention**. Décision (design §9) :
> **un seul propriétaire « QG-front » sérialise** les tâches 11→14 sur ce fichier ; chaque feature
> vit dans une **vue neuve** `src/dashboard/views/*.tsx` (parallélisable) ; l'intégration =
> petites lignes import+montage. `api.ts` découpé en `src/dashboard/api/*.ts` ré-exportés.

- [ ] 11. **(T10) QG : CRM par agence (UI)** `[S sur CommandCenter.tsx]`
  - [ ] 11.1 `src/dashboard/views/CrmView.tsx` + `src/dashboard/api/crm.ts` : éditeur config CRM,
        test connexion, mapping ; aucun secret affiché.
  - [ ] 11.2 Intégration : import + montage de l'onglet dans `CommandCenter.tsx` (lignes minimales).
  - _Requirements: R17 (UI), R16_
  - _Fichiers possédés: `src/dashboard/views/CrmView.tsx`, `src/dashboard/api/crm.ts`,
    `src/dashboard/CommandCenter.tsx` (montage) [S], `src/dashboard/api.ts` (ré-export) [S]_
  - _Vague: 3 · Dépend de: T1 · Vérif: `npm run build` (racine)_

- [ ] 12. **(T11) QG : Billing & quotas (UI)** `[S sur CommandCenter.tsx]`
  - [ ] 12.1 `src/dashboard/views/BillingView.tsx` + `api/billing.ts` : plan, statut abonnement,
        usage vs quota, état over-quota ; sans clés secrètes.
  - _Requirements: R18.6 (UI), R16 · Fichiers: `views/BillingView.tsx`, `api/billing.ts`,
    `CommandCenter.tsx`/`api.ts` (montage) [S] · Dépend de: T2 · Vérif: build_

- [ ] 13. **(T12) QG : Provisioning agences (UI + snippet)** `[S sur CommandCenter.tsx]`
  - [ ] 13.1 `src/dashboard/views/ProvisioningView.tsx` + `api/provisioning.ts` : provision 1-clic,
        copie du snippet, cycle de vie (suspend/réactive/archive).
  - _Requirements: R19 (UI), R16 · Fichiers: `views/ProvisioningView.tsx`, `api/provisioning.ts`,
    `CommandCenter.tsx`/`api.ts` (montage) [S] · Dépend de: T3 · Vérif: build_

- [ ] 14. **(T13) QG : Settings/TOTP + métriques/latence (UI)** `[S sur CommandCenter.tsx]`
  - [ ] 14.1 `src/dashboard/views/SettingsView.tsx` + `api/settings.ts` : statut TOTP, enrôlement
        (QR/otpauth), reset (CSRF + ré-vérif), allowlist IP, timeout session, accès Audit_Log,
        guidance rotation clé — **sans secret**.
  - [ ] 14.2 Surveillance : afficher `BotMetrics` réels (latence mesurée, response rate,
        indicateurs in-progress/out-of-date).
  - _Requirements: R13, R12.7 (UI), R6/R7 (UI), R16 · Fichiers: `views/SettingsView.tsx`,
    `api/settings.ts`, `CommandCenter.tsx`/`api.ts` (montage) [S] · Dépend de: T5, T7, T9 · Vérif: build_

- [ ] 15. **(T14) Tests & CI** `[P]`
  - [ ] 15.1 Étendre `scripts/qg_preprod_test.py` : CRM (no-secret-out), billing (plans/statut),
        provisioning (provision/snippet/status→widget 403), TOTP (status), webhook Stripe (sig invalide→400).
  - [ ] 15.2 Tests backend additionnels manquants ; gate CI `tsc + vitest + build`.
  - _Requirements: R10.3 (+ transverse) · Fichiers: `server/src/**/__tests__/**` (nouveaux),
    `scripts/qg_preprod_test.py`, `.github/workflows/*` · Dépend de: vagues 1–2 · Vérif: tout_

- [ ] 16. **(T15) GTM & démo** `[P]`
  - [ ] 16.1 `docs/**` : landing/pricing in-repo, onboarding agence, one-pager. **Ne touche pas** au
        code runtime.
  - _Requirements: — (commercial) · Fichiers: `docs/**` · Dépend de: — · Vérif: lien/markdown_

---

## Intégration (orchestrateur, entre chaque vague)

- [ ] I.1 Vérifier le webhook Stripe public raw-body monté (T0) et le handler (T2) branché.
- [ ] I.2 Lancer la non-régression complète : `cd server && npx tsc --noEmit` ; `npx vitest run`
  (≥188 verts) ; `npm run build` (racine) ; `python scripts/qg_preprod_test.py`.
- [ ] I.3 Commit **fichiers précis** (jamais `-A`), contrôle secrets, **ne pas** committer
  `assets/icon/*.png` ni `Chatbot` ; `git push github main`.
- [ ] I.4 Déploiement VPS (hors agents) : `git fetch github main` → `reset --hard github/main` →
  `docker compose up -d --build oraclesentinel` ; check `/health` + `/qg`.

## Critères de livraison (« vendable », aucun bug)

- [ ] CRM par agence : config chiffrée, test connexion, push live vers le CRM du tenant, fallback global.
- [ ] Facturation Stripe + quotas, totalement désactivable.
- [ ] Provisioning 1-clic + snippet + cycle de vie (suspend/archive coupe le bot).
- [ ] Contrôle distant + métriques réelles + 2FA TOTP (R1–R16).
- [ ] `tsc` + `vitest` (≥188) + `build` + harness Python : tout vert. **Aucun 500.**
- [ ] Prod déployée et vérifiée (`/health`, `/qg`), runtime chatbot intact.
- [ ] Aucun secret en clair ni loggé ; audit append-only.
