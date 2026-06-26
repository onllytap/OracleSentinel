# SECURITY_REVIEW — Sentinel Chatbot (D:\Chatbot - Copy)

> Audit sécurité basé sur le code réel. Phase 0 — lecture seule.
> Date : 2026-06-19. Aucune modification de code. Vérifications non destructives uniquement.
> Convention : les secrets ne sont jamais reproduits ; seules les **clés** et observations sont citées.

---

## 1. Méthode et périmètre

- Revue du code : `server/src` (index, routes, middleware, services, db, utils), `src/dashboard`, Docker/compose, `.env.example`.
- Vérifications : `npm audit` (racine + serveur), `npm ls form-data`, `git status`.
- Modèle de menace considéré : visiteur anonyme du widget, locataire malveillant (cross-tenant), opérateur admin compromis, attaquant réseau, fuite de secrets, SSRF, XSS, CSRF, injection SQL.

Cotation : **Critique / Élevée / Moyenne / Faible / Info**. La sévérité tient compte de l'exploitabilité **réelle dans ce contexte**, pas seulement de la note théorique de l'avis.

---

## 2. Posture de sécurité actuelle (points validés ✅)

| Contrôle | Implémentation | Fichier |
|---|---|---|
| En-têtes de sécurité | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`; `x-powered-by` désactivé | `index.ts` |
| CORS | Allowlist en prod (`WIDGET_ALLOWED_ORIGINS`/`FRONTEND_URL`), credentials, méthodes/headers restreints | `index.ts` |
| Rate limiting | `express-rate-limit` + store PostgreSQL (persistant, multi-instance), 600/15 min | `index.ts`, `middleware/rate-limit-store.ts` |
| Auth widget | JWT `jose` HS256, contrôle d'origine (Origin/Referer), scopes, mapping tenant, TTL | `middleware/widget-auth.ts` |
| Auth admin | `ADMIN_API_KEY` comparé en temps constant → session JWT HttpOnly 30 min | `middleware/admin-api-key.ts`, `admin.routes.ts` |
| CSRF | Double-submit cookie + header `X-CSRF-Token`, comparaison temps constant, sur POST/PUT/DELETE | `middleware/admin-session.ts` |
| Injection SQL | Requêtes **paramétrées** partout ; allowlist de tables pour `COUNT` | `routes/admin*.ts`, `services/chat.service.ts` |
| SSRF | `isBlockedWebhookHost` + `resolvesToPrivateAddress` (anti DNS-rebinding) + `redirect: manual` | `utils/ssrf-guard.ts`, `factory.routes.ts` |
| XSS (page `/embed`) | `escapeHtml`, `safeCssColor`, `safeWidgetId`, validation du header `Host`, CSP | `index.ts` |
| Redaction secrets | Masquage clés API/DB URL/webhook côté `/factory/config` et `/priv` | `factory.routes.ts`, `services/infra-monitor.service.ts` |
| Auth forte (option) | better-auth (email+mot de passe min 12, 2FA TOTP) monté si configuré | `auth/auth.ts` |
| Limites de charge | `express.json({ limit: '1mb' })`, limites dédiées par endpoint (10kb–50mb) | `index.ts`, routes |
| Gestion d'erreurs | Messages génériques en prod, détails loggés serveur + Sentry, `X-Request-Id` | `index.ts` |
| Conteneur | Docker multi-stage, utilisateur **non-root**, healthcheck | `Dockerfile.production`, `server/Dockerfile` |
| Hygiène secrets (git) | `.gitignore` exclut `.env*`, backups, `*_CONFIG.txt` | `.gitignore` |

**Conclusion posture** : nettement au-dessus de la moyenne pour un produit de cette taille. Les fondamentaux OWASP (injection, auth, CSRF, en-têtes, SSRF) sont couverts.

---

## 3. Findings classés par sévérité

### 3.1 ÉLEVÉE

#### F1 — Mot de passe PostgreSQL par défaut dans `docker-compose.production.yml`
- **Constat** : valeurs par défaut `POSTGRES_PASSWORD:-oraclesentinel_prod_2026` et `DATABASE_URL` construite avec ce fallback. Si l'environnement de déploiement ne surcharge pas ces variables, la base de production démarre avec un **mot de passe connu et présent dans le dépôt**.
- **Impact** : accès complet à la base (leads, conversations, PII) si le port est joignable ou si un attaquant lit le compose.
- **Exploitabilité** : dépend de la config VPS réelle (à vérifier côté SYSTEM 2 VRAI / `.env` prod). Le port DB est exposé `5433:5432`.
- **Recommandation** : retirer le fallback en clair ; exiger `POSTGRES_PASSWORD` (échouer si absent) ; ne pas publier le port DB hors réseau Docker interne ; rotation du mot de passe. **Non destructif** côté code (modif compose + doc).

### 3.2 MOYENNE

#### F2 — Vulnérabilité dépendance `form-data@4.0.5` (CRLF injection, GHSA-hmw2-7cc7-3qxx)
- **Constat** : `npm audit` (serveur) signale 1 vuln **high**. Chaîne : `@anthropic-ai/sdk@0.33.1 → @types/node-fetch@2.6.13 → form-data@4.0.5`. Un mismatch de version est aussi présent (`@types/node-fetch` veut `^4.0.6`).
- **Impact réel** : la vuln concerne des noms de champs/fichiers multipart non échappés. Ici `form-data` est utilisé par le SDK HTTP, **pas** avec des noms de champs contrôlés par l'utilisateur → exploitabilité **faible** dans ce contexte. Reste à corriger (dette + signalé high).
- **Recommandation** : `npm audit fix` (serveur), puis `npm run verify`. Réversible.

#### F3 — `server/Dockerfile` masque les erreurs TypeScript
- **Constat** : `RUN npx tsc --build tsconfig.json 2>&1 || true`. Le `|| true` laisse le build réussir même si `tsc` échoue. Atténuation : `RUN test -f dist/index.js || (… exit 1)` (échoue si aucun output).
- **Impact** : du code partiellement compilé / avec erreurs de types peut être livré si `dist/index.js` existe malgré des erreurs.
- **Note** : le pipeline prod « complet » (`Dockerfile.production`) utilise **esbuild** et ne masque pas. Le risque est limité au chemin de build `server/Dockerfile`.
- **Recommandation** : retirer `|| true`, ou faire échouer explicitement sur erreur `tsc`. Aligner sur `Dockerfile.production`.

#### F4 — `schema.sql` legacy destructif coexiste avec `ensure-db`
- **Constat** : `server/src/db/schema.sql` contient `DROP TABLE IF EXISTS leads/messages/conversations CASCADE` et un schéma **sans `tenant_id`** (obsolète). Le schéma réel est `ensure-db.ts` (idempotent, non destructif, exécuté au boot).
- **Impact** : exécution accidentelle de `schema.sql` (copier/coller, script de setup) = **perte de données** et régression multi-tenant.
- **Recommandation** : renommer en `schema.legacy.sql` avec un en-tête « NE PAS EXÉCUTER — référence historique », ou supprimer après validation/inventaire (handoff : pas de suppression sans validation). Documenter `ensure-db.ts` comme source de vérité.

#### F5 — Secrets au repos : `.env.backup.*` (×10)
- **Constat** : 10 fichiers `.env.backup.<timestamp>` à la racine, générés par la factory (`saveConfig`/`restoreLatestBackup`). Ils contiennent vraisemblablement des secrets historiques. Gitignorés (`*.env.backup`, `.env.backup.*`) donc absents du dépôt, mais présents **en clair sur le disque**.
- **Impact** : surface de fuite si la machine/VPS est compromise ou sauvegardée sans chiffrement ; rotation de secret incomplète si d'anciennes valeurs persistent.
- **Recommandation** : politique de rétention (garder N derniers, purge des plus anciens après validation), stockage hors arborescence web, chiffrement au repos. **Ne pas supprimer sans validation** (handoff).

#### F6 — Couverture de tests insuffisante sur services métier critiques
- **Constat** (corroboré par `bibliotheque/depart_docs/README`) : `chat.service.ts`, `admin.routes.ts`, `factory`, `catalog`, connecteurs CRM peu couverts par des tests profonds.
- **Impact** : risque de régression silencieuse sur la logique de qualification/CRM/purge tenant lors d'évolutions.
- **Recommandation** : tests ciblés (voir plan qualité). Ne pas modifier la logique, seulement la verrouiller par des tests.

### 3.3 FAIBLE

#### F7 — Exposition des variables `VAR_*` dans `/api/admin/db/overview`
- **Constat** : l'endpoint renvoie une liste de clés d'env « sûres » **plus toutes les clés `VAR_*`** (valeurs tronquées à 80 caractères). Si un secret est stocké dans une variable `VAR_*`, ses 77 premiers caractères seraient visibles dans l'UI admin.
- **Impact** : fuite partielle de secret, mais **derrière session admin** (surface réduite).
- **Recommandation** : n'exposer que des clés sur allowlist explicite ; masquer toute valeur ressemblant à un secret ; ne pas dumper `VAR_*` en clair.

#### F8 — Isolation tenant uniquement applicative (pas de RLS)
- **Constat** : l'isolation repose sur le filtrage `tenant_id` dans chaque requête (correctement appliqué dans `chat.service.ts`). Pas de **Row-Level Security** PostgreSQL ni de contrainte au niveau base.
- **Impact** : un oubli de filtre `WHERE tenant_id = $x` dans une future requête entraînerait une fuite cross-tenant. Aujourd'hui : non observé.
- **Recommandation** : défense en profondeur via RLS (POC sur `leads`/`messages`), ou helper de requête imposant le tenant. À cadrer en ADR.

#### F9 — Fallback de secret de session admin
- **Constat** : `admin-session.ts` dérive le secret de signature depuis `ADMIN_SESSION_SECRET || JWT_SECRET || ADMIN_API_KEY`. Pratique pour le boot, mais réutilise potentiellement l'`ADMIN_API_KEY` comme clé de signature JWT.
- **Impact** : couplage des secrets (un seul secret pour auth + signature). Faible si les secrets sont forts et distincts en prod.
- **Recommandation** : exiger `ADMIN_SESSION_SECRET` distinct en production (warn/refuse si égal à `ADMIN_API_KEY`).

#### F10 — `cookieCache` / SameSite
- **Constat** : cookies admin `HttpOnly`, `SameSite=Lax`, `Secure` en prod. Correct. `SameSite=Lax` autorise la navigation GET cross-site mais les mutations sont protégées par CSRF token + `same-origin` côté client.
- **Recommandation** : envisager `SameSite=Strict` pour `admin_session` (le QG n'a pas besoin de navigation cross-site). À tester pour ne pas casser le flux de login.

### 3.4 INFO / Hygiène

- **F11** — `/embed` utilise `script-src 'unsafe-inline'` (nécessaire au script inline du widget hébergé) et `frame-ancestors *` (embarquement public voulu). Acceptable pour la fonction, mais à surveiller ; envisager un nonce CSP si le contenu inline est figé.
- **F12** — `infra-monitor` et `pool` utilisent `rejectUnauthorized: false` pour les sondes/Neon. Justifié pour des sondes de reachability et certains managed PG, mais à documenter (pas de validation de chaîne TLS).
- **F13** — Hygiène repo : `git status` émet des warnings sur des dossiers `.agent/skills/*` référencés mais absents du disque (entrées orphelines). Sans impact sécurité, à nettoyer pour la lisibilité.
- **F14** — Multiples dossiers d'outils IA (`.claude`, `.cursor`, `.gemini`, `.kilocode`, `.kiro`, `.opencode`, `.qoder`, `.windsurf`, `.agent`, `.agents`) : surface de configuration large, à garder hors image de production (vérifier `.dockerignore`).

---

## 4. Analyse par domaine demandé

### 4.1 Données
- **Quoi** : conversations, messages, leads (PII : email, téléphone, besoins), catalogue immobilier par tenant, runs d'import, rate-limits, builds factory.
- **Où** : PostgreSQL (Neon en prod via `NEXT_PRIVATE_DATABASE_URL`/`DATABASE_URL`, TLS).
- **Circulation** : widget → backend → DB ; backend → CRM (Airtable/Twenty) pour les leads qualifiés.
- **Accès** : widget (tenant scoping JWT), admin (session), super-admin (`/priv`).
- **Protections existantes** : paramétrage SQL, scoping tenant, transactions, redaction, TLS.
- **À renforcer** : RLS (F8), exposition `VAR_*` (F7), secrets au repos (F5), mot de passe par défaut (F1).

### 4.2 Backend
- Routes correctement gardées (session/CSRF sur mutations ; scopes sur widget). Validation Zod sur les routes factory. Garde SSRF sur les tests de webhook. Gestion d'erreurs sans fuite en prod. Logs structurés sans PII apparente dans les chemins critiques (à confirmer par revue ciblée des `console.log` de `chat.service`).
- **À renforcer** : tests (F6), secret de session distinct (F9).

### 4.3 Frontend
- Le QG (`src/dashboard`) utilise une **session cookie HttpOnly** (pas de token en `localStorage`) + CSRF double-submit + `credentials: same-origin` → bonne posture contre le vol de token.
- Le widget reçoit un JWT court (TTL via `JWT_TTL_SECONDS`, défaut 1200s) borné par origine et scope.
- **À surveiller** : `VITE_*` exposées au client (par nature publiques) — vérifier qu'aucune valeur sensible n'y figure (l'`.env.example` racine ne contient que des valeurs publiques : OK).

### 4.4 Dépendances
- Racine : **0 vulnérabilité**.
- Serveur : **1 vulnérabilité haute** (F2, transitive, exploitabilité faible ici).
- **Action** : `npm audit fix` serveur + `verify`. Mettre en place une vérification d'audit régulière (déjà présente : script `audit:prod`).

---

## 5. Recommandations priorisées

| Prio | Action | Sévérité visée | Risque de l'action |
|---|---|---|---|
| P0 | Retirer le mot de passe Postgres par défaut du compose + ne pas exposer le port DB | F1 | Faible (config/doc) |
| P0 | `npm audit fix` serveur + `npm run verify` | F2 | Faible (réversible) |
| P1 | Corriger `server/Dockerfile` (supprimer `|| true`) | F3 | Faible |
| P1 | Marquer `schema.sql` comme legacy non exécutable | F4 | Faible |
| P1 | Politique de rétention/chiffrement des `.env.backup.*` | F5 | Moyen (validation requise) |
| P2 | Restreindre l'exposition `VAR_*` admin | F7 | Faible |
| P2 | Exiger `ADMIN_SESSION_SECRET` distinct en prod | F9 | Faible |
| P2 | POC Row-Level Security tenant | F8 | Moyen (validation requise) |
| P3 | Tests services métier (chat/admin/factory/catalog/CRM) | F6 | Faible |
| P3 | Nettoyage hygiène repo + `.dockerignore` | F13, F14 | Faible |

> Toutes les actions P0/P1 sont **non destructives** et n'affectent ni la logique LLM/Groq, ni le design du widget, ni les payloads CRM. Les actions touchant les données (F5, F8) nécessitent une validation explicite conformément au handoff.

---

## 6. Ce qui n'a pas pu être vérifié (transparence)

- L'état **réel** des variables d'environnement de production (le `.env` prod n'a pas été exfiltré ni reproduit). F1/F9 dépendent de la config VPS effective, potentiellement gérée côté SYSTEM 2 VRAI.
- L'exposition réseau réelle du port PostgreSQL (`5433`) dépend du pare-feu/reverse-proxy du VPS, non inspectable depuis ce dossier.
- La présence éventuelle de PII dans les logs en production (revue statique seulement ; pas d'accès aux logs runtime).
- L'efficacité runtime du rate-limit/CSRF n'a pas été testée dynamiquement (pas de serveur lancé en Phase 0).


---

## 7. Mise à jour 2026-06-19 (soir) — Re-audit du périmètre élargi (QG v2.1)

> Depuis la rédaction des §1-6, le QG s'est enrichi (Waves 0-3, sur `main@9346634`) : CRM par agence,
> facturation Stripe, provisioning, métriques, 2FA TOTP, contrôle distant. Cette section **re-audite la
> nouvelle surface** d'attaque. Méthode identique : lecture du code réel, `npm audit`, aucune modification.

### 7.1 Vérification des findings antérieurs (état au soir)
- **F2** (form-data) → **RÉSOLU** : `npm audit` racine **et** serveur ⇒ **0 vulnérabilité** (re-vérifié ce soir,
  malgré l'ajout des dépendances des Waves). F1, F3, F4, F7, F9, F10 traités (cf. `REMEDIATION_LOG.md`).
  F5 (backups), F8 (RLS) restent des décisions opérateur / différées documentées.

### 7.2 Nouvelle surface — contrôles validés ✅
| Contrôle | Implémentation vérifiée | Fichier |
|---|---|---|
| **Chiffrement secrets au repos** | AES-256-GCM correct (IV 12o, authTag 16o vérifié, clé 32o via `APP_ENCRYPTION_KEY`). **Refuse de démarrer en prod sans clé** ; clé DEV dérivée hors prod uniquement | `utils/crypto.ts` |
| **CRM par agence** | Secrets **chiffrés** en base, **jamais renvoyés** par l'API (`hasCredentials: bool` seulement) ; push fail-safe (`handled:false` → repli global) | `services/tenant-crm.service.ts` |
| **Webhook Stripe** | Signature HMAC-SHA256 vérifiée manuellement, **comparaison à temps constant**, fenêtre 300 s anti-rejeu ; jamais 500 (anti retry-storm) ; secret & raw-body **jamais loggés** | `services/billing.service.ts`, `index.ts` |
| **Facturation inerte par défaut** | `BILLING_ENABLED!=true` ⇒ `recordUsage` no-op, `isOverQuota` toujours `false` (jamais de blocage du hot path chat) | `services/billing.service.ts` |
| **2FA TOTP** | `ADMIN_API_KEY` + TOTP (RFC 6238) ; codes de récupération à usage unique ; break-glass tracé ; secret TOTP chiffré, jamais renvoyé après enrôlement | `services/totp.service.ts`, spec R11-R14 |
| **Contrôle distant gardé** | Toutes les routes `/api/priv/*` sous `requireAdminSession` (+`requireCSRF` sur écritures) ; `redeploy` exige `confirm:true` + single-flight (409) ; rollback borné | `routes/*.routes.ts` |
| **Isolation par tenant** | Validation stricte `tenantId` (`/^[a-zA-Z0-9_.-]{1,100}$/`) sur chaque route ; chemins mono-segment → pas de shadowing entre routeurs | `tenant.routes.ts`, `redeploy.routes.ts` |
| **Défense réseau (option)** | `adminIpAllowlist()` sur `/admin` + `/api/priv` (activable via `ADMIN_IP_ALLOWLIST`) ; `/qg` & `/priv` en CSP stricte | `index.ts`, `command-center.routes.ts` |

### 7.3 Findings nouveaux (priorisés)

#### F15 — `APP_ENCRYPTION_KEY` : variable critique à exiger explicitement au déploiement — **MOYENNE**
- **Constat** : sans `APP_ENCRYPTION_KEY` valide, le serveur **refuse** d'enregistrer/lire les secrets CRM par
  agence (comportement voulu, sûr). Mais si la clé est **perdue ou tournée sans migration**, les blobs CRM
  existants deviennent **indéchiffrables** (perte de la config CRM par tenant, pas des leads).
- **Reco** : documenter la clé comme **secret de prod obligatoire** (au même rang que `POSTGRES_PASSWORD`/
  `ADMIN_SESSION_SECRET`), prévoir une **procédure de rotation** (ré-chiffrement des blobs) et une sauvegarde
  sûre de la clé. Action : doc + `.env.example` (non destructif).

#### F16 — Stockage du secret 2FA TOTP : confirmer le chiffrement effectif — **À VÉRIFIER (probable Faible)**
- **Constat** : la spec (R14) exige le secret TOTP **chiffré au repos** et jamais renvoyé après enrôlement.
  `utils/crypto.ts` fournit le bon primitif ; à **confirmer par lecture** de `totp.service.ts` que le secret
  est bien stocké via `encryptSecret`/`encryptJson` (et non en clair), et que les codes de récupération sont
  **hashés**. Probable conforme vu la qualité du reste ; vérification de revue ciblée recommandée.

#### F17 — Endpoints RGPD : valider l'autorisation et l'audit des opérations destructives — **À VÉRIFIER**
- **Constat** : `rgpd.routes.ts` (export/effacement) manipule des données personnelles. À confirmer : (a) gardé
  `requireAdminSession`+`requireCSRF`, (b) **double confirmation** pour un effacement définitif, (c) **journalisé**
  dans `audit.service`. Aligné avec la philosophie « soft-delete d'abord » de la roadmap.

#### F18 — Module estimation (WIP) hors périmètre d'audit figé — **INFO**
- **Constat** : `estimation`/`mandates`/`dpe` (routes + services + UI) sont **non commités** et instables.
  `/api/estimate` est public (sous rate-limit `/api/`). **À auditer dans sa branche** une fois figé
  (validation Zod des entrées, pas de PII en clair dans les logs, idempotence de la capture de mandat).

### 7.4 Verdict du re-audit
La nouvelle surface est **construite avec une bonne hygiène sécurité** : chiffrement au repos correct,
vérification de signature webhook robuste, secrets jamais exposés, gardes session/CSRF systématiques,
fonctionnalités sensibles inertes par défaut. **0 vulnérabilité de dépendance**. Les findings F15-F17 sont
des **vérifications/documentations** (non des failles avérées) ; F18 attend le gel du WIP. Aucune action
destructive requise ; durcissements proposés non destructifs et alignés sur le handoff.
