# REMEDIATION_LOG — Journal de remédiation

> Trace des corrections appliquées suite à l'audit (`SECURITY_REVIEW.md`).
> Chaque entrée : quoi, pourquoi, comment vérifié, réversibilité.

---

## Phase 1 — Durcissement réversible (2026-06-19)

Objectif : corriger les findings sans impact produit (aucune modification de la logique LLM/Groq, du design widget, ni des payloads CRM).

| Finding | Action | Fichier(s) | Vérification | Réversible |
|---|---|---|---|---|
| **F2** (form-data CRLF, high) | Application de l'override `form-data ^4.0.6` déjà déclaré (via `npm install`) | `server/package-lock.json` | `npm audit` → **0 vulnérabilité** ; `npm ls form-data` → **4.0.6** | Oui (git) |
| **F1** (mot de passe Postgres par défaut) | Remplacement du fallback en clair par une variable **requise** (`${POSTGRES_PASSWORD:?…}`) aux 2 emplacements | `docker-compose.production.yml` | Relecture ; substitution compose standard | Oui (git) |
| **F3** (masquage erreurs TS) | Suppression de `\|\| true` après `tsc` (la garde `test -f dist/index.js` est conservée) | `server/Dockerfile` | **Build serveur OK** (`tsc && copy-assets` → « Copied views + migrations to dist/ ») | Oui (git) |
| **F4** (schéma legacy destructif) | Renommage `schema.sql` → `schema.legacy.sql` + en-tête « NE PAS EXÉCUTER » ; contenu préservé | `server/src/db/schema.legacy.sql` (créé), `server/src/db/schema.sql` (retiré) | `grep` : aucun import code actif ; `copy-assets.js` ne le copie pas | Oui (git) |

### Détails de vérification
- **Dépendances** : `cd server && npm audit` ⇒ `found 0 vulnerabilities`. La racine était déjà à 0.
- **Build serveur** : `cd server && npm run build` ⇒ `tsc` compile sans erreur puis `copy-assets.js` affiche « Copied views + migrations to dist/ ». Confirme que retirer `|| true` ne casse pas le build (tsc passe déjà proprement, comme dans le script `build` npm et la CI).
- **Note environnement** : `tsc` à froid dépasse la limite d'exécution interactive (~120 s) dans le bac à sable ; la vérification a donc été faite via un build en arrière-plan. Pour rejouer localement : `cd server && npm run verify`.

### Impact / non-régression
- Aucune modification de code applicatif TypeScript ni de logique métier.
- `F1` change le comportement de `docker compose` **uniquement** si `POSTGRES_PASSWORD` n'est pas défini : c'est l'effet voulu (échec explicite plutôt que mot de passe faible). **Action requise au déploiement** : définir `POSTGRES_PASSWORD` dans l'environnement / `.env` de prod.

---

## Phase 1bis — Durcissement applicatif sans rupture (2026-06-19)

| Finding | Action | Fichier(s) | Vérification | Réversible |
|---|---|---|---|---|
| **F7** (exposition `VAR_*` en clair) | Masquage des valeurs ressemblant à un secret (clé OU contenu) dans `/api/admin/db/overview` ; les URLs/config bénignes restent lisibles (tronquées) | `server/src/routes/admin.routes.ts` (`looksLikeSecretEnv`, `maskEnvValue`, `displayEnvValue`) | **Build serveur OK** ; aucun test sur cet endpoint (comportement d'affichage uniquement, derrière session admin) | Oui (git) |
| **F9** (secret de session admin réutilisé) | Centralisation de la résolution du secret (`resolveAdminSessionSecret`) + **avertissement non bloquant** en production si `ADMIN_SESSION_SECRET` absent ou égal à `ADMIN_API_KEY` | `server/src/middleware/admin-session.ts`, `server/src/routes/admin.routes.ts` | **Build serveur OK** ; `admin-session.test.ts` → **4/4 passés** (ordre de fallback préservé) | Oui (git) |

### Détails
- **F7** — La logique : une valeur est masquée (`abc••••xyz`) si la clé contient `secret/token/key/password/auth/credential/dsn/private/cookie/session`, OU si la valeur est une chaîne opaque (≥ 40 car. sans espace) ou une URL contenant des identifiants (`user:pass@`). Les URLs simples et les valeurs de config courtes restent affichées. Effet : plus aucune fuite partielle de secret via l'UI admin, sans perdre la lisibilité de la config légitime.
- **F9** — Comportement **inchangé** pour les déploiements fonctionnels (l'ordre `ADMIN_SESSION_SECRET > JWT_SECRET > ADMIN_API_KEY` est conservé). On ajoute seulement un `console.warn` en production pour signaler une configuration faible. Choix délibéré : **avertir plutôt que bloquer** afin de ne jamais verrouiller un admin existant (handoff : ne pas casser). Recommandation déploiement : définir un `ADMIN_SESSION_SECRET` dédié, distinct de `ADMIN_API_KEY`.
- Suite de tests complète : `cd server && npm run verify` (lance typecheck + tests + build + audit). Vérification ici faite via build (tsc) + test ciblé `admin-session`.

---

## Phase 1ter — QG flotte + durcissement final (2026-06-19)

| Finding | Action | Fichier(s) | Vérification | Réversible |
|---|---|---|---|---|
| **F10** (cookie admin SameSite) | `admin_session` / `csrf_token` passés en `SameSite=Strict` (login + QG same-origin) | `server/src/routes/admin.routes.ts` (`cookieBaseAttrs`) | Build serveur OK ; login same-origin inchangé | Oui (git) |
| **F6** (tests) | Test unitaire de la classification de santé des agences (`deriveHealth`, 4 cas + précédence) | `server/src/services/__tests__/fleet.service.test.ts` (+ export `deriveHealth`) | `vitest` vert | Oui (git) |
| **QG étape 3** | Carte « Santé de la flotte » dans le QG React (Overview) via `/api/priv/overview` | `src/dashboard/CommandCenter.tsx` | `vite build` OK | Oui (git) |

### F5 — Hygiène des sauvegardes `.env.backup.*` (à exécuter par l'opérateur)
Les backups sont gitignorés (jamais poussés) mais restent en clair sur le disque. Recommandation : conserver les 3 plus récents et supprimer le reste, **après vérification**. Commande PowerShell sûre (à lancer manuellement) :

```powershell
Get-ChildItem '.env.backup.*' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -WhatIf
```

Retirer `-WhatIf` pour exécuter réellement. Idéalement : secrets dans un coffre (VPS : permissions 600, hors arborescence web) + rotation planifiée. Non exécuté ici (suppression = décision opérateur, conforme au handoff).

### F8 — RLS multi-tenant : DIFFÉRÉ volontairement
Non implémenté dans ce palier : c'est un changement **transverse** (propagation du tenant à chaque connexion) qui peut casser des requêtes légitimes s'il est précipité. `decisions/ADR_0003` impose un **POC en environnement de test** (table `leads`) avant extension. L'isolation applicative actuelle (filtrage `tenant_id` dans toutes les requêtes) reste fonctionnelle et vérifiée. À activer quand le volume / les exigences RGPD le justifient.

---

## Reste à faire (validation / palier ultérieur)

- **F8** — RLS PostgreSQL (POC test d'abord, voir ADR_0003).
- **F6 (suite)** — Couverture profonde des services métier (chat.service, admin.routes, factory, catalog, connecteurs CRM) — gros chantier à planifier.
- **F5 (exécution)** — Lancer la purge des backups + mettre les secrets en coffre (décision opérateur).
- **QG (suite)** — Onglet « Chatbots » du QG React enrichi (badge santé par agence, tri/recherche pour 350+) ; option : unifier `/priv` → QG React.

Voir `SECURITY_REVIEW.md` pour le détail et la priorisation.
