# ADR_0003 — Défense en profondeur multi-tenant (Row-Level Security PostgreSQL)

- **Statut** : **Mécanisme livré** (réversible, OFF par défaut) — activation différée (décision opérateur après validation en test). Maj 2026-06-19, branche `feat/data-security-hardening`.
- **Date** : 2026-06-19
- **Décideurs** : ingénierie + sécurité
- **Références** : `bibliotheque/audit/SECURITY_REVIEW.md` (F8), `server/src/db/ensure-db.ts`, `server/src/services/chat.service.ts`

---

## Contexte

L'isolation entre agences (tenants) repose **aujourd'hui uniquement sur le filtrage applicatif** : chaque requête ajoute `WHERE tenant_id = $x`. C'est correctement appliqué dans le code actuel (`chat.service.ts`, `admin.routes.ts`, `factory.routes.ts`).

Risque résiduel (F8) : un **oubli futur** de la clause `tenant_id` dans une nouvelle requête provoquerait une **fuite cross-tenant** (un client verrait les leads/conversations d'un autre). Il n'existe aucun filet de sécurité au niveau base.

## Décision (proposition à valider)

Introduire la **Row-Level Security (RLS)** PostgreSQL comme **défense en profondeur**, en complément (et non en remplacement) du filtrage applicatif :

1. Activer RLS sur les tables multi-tenant (`conversations`, `messages`, `leads`, `catalog_properties`, `catalog_import_runs`).
2. Définir une politique : `tenant_id = current_setting('app.tenant_id', true)`.
3. Au début de chaque requête/connexion applicative, positionner `SET app.tenant_id = $tenant` (via un wrapper de pool ou `SET LOCAL` dans une transaction).
4. Conserver un **rôle d'administration** (super-admin) capable de bypass (BYPASSRLS) pour les vues `/admin`/`/priv` qui agrègent volontairement plusieurs tenants.

## Conséquences

**Positives**
- Un oubli de filtre applicatif **ne suffit plus** à fuiter des données : la base bloque.
- Aligné sur la cible « entreprise » et les attentes RGPD (cloisonnement fort).

**Négatives / coûts**
- Nécessite de **propager le tenant courant** à chaque connexion (wrapper de pool ou pattern transactionnel) — changement transverse à tester soigneusement.
- Les requêtes **multi-tenant volontaires** (admin) doivent utiliser un rôle privilégié → distinguer connexions « widget/tenant » et « admin ».
- Risque de **régression** si une requête légitime perd l'accès faute de `app.tenant_id` positionné.

**Risques & mitigations**
- *Régression fonctionnelle* : déployer en **POC isolé** sur une seule table (`leads`) en environnement de test, valider tous les chemins (chat, admin, factory), puis étendre.
- *Performance* : RLS ajoute un prédicat ; les index `(tenant_id, …)` existants le couvrent déjà.
- *Complexité opérationnelle* : documenter le contrat « toute connexion applicative DOIT positionner app.tenant_id ».

## Statut d'adoption recommandé

**Optionnel / à valider.** L'isolation applicative actuelle est fonctionnelle. Cet ADR est une **amélioration de robustesse** pour la trajectoire entreprise, pas une correction d'un défaut actif. À prioriser si :
- le nombre de tenants augmente fortement, ou
- des exigences contractuelles/RGPD imposent un cloisonnement au niveau base.

## Plan d'implémentation (si accepté)

1. POC RLS sur `leads` (test) + wrapper de pool positionnant `app.tenant_id`.
2. Suite de tests cross-tenant (tentative d'accès à un tenant tiers → refus base).
3. Extension progressive aux autres tables.
4. Rôle admin BYPASSRLS pour les vues d'agrégation.
5. Documentation du contrat de connexion dans `ARCHITECTURE.md`.

## Alternatives

- **Helper de requête imposant le tenant** (plus léger que RLS) : une fonction unique `tenantQuery(tenantId, sql, params)` qui refuse toute requête sur tables multi-tenant sans tenant. Moins robuste que RLS (contournable) mais sans changement base. Peut être une **étape intermédiaire**.
- **Statu quo** : accepter le risque résiduel (faible aujourd'hui) et le couvrir par des tests + revue de code.

---

## Statut d'implémentation (2026-06-19)

Le **mécanisme** est livré sur la branche `feat/data-security-hardening`,
**réversible et désactivé par défaut**. L'isolation applicative actuelle reste
le seul chemin actif tant que `DB_RLS_ENABLED` n'est pas positionné.

**Livré :**
- `server/src/db/rls.ts` : `withTenant(tenantId, fn)` (transaction +
  `set_config('app.tenant_id', $1, true)`), `withAdminBypass(fn)`
  (`set_config('app.bypass_rls','on',true)` pour l'agrégation cross-tenant),
  `tenantQuery(...)` (point d'intégration : OFF → `pool.query` inchangé ; ON →
  `withTenant`), `isRlsEnabled()` (lit `DB_RLS_ENABLED`, OFF par défaut),
  `applyRlsPolicies()` / `removeRlsPolicies()`.
- `server/src/db/migrations/003_rls_multitenant.sql` (+ `.rollback.sql`) :
  idempotent, `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`
  sur les 5 tables multi-tenant. **Non exécuté au boot.**
- Tests `server/src/db/__tests__/` : `rls.test.ts` (unitaires + intégration
  réelle prouvant qu'avec RLS, tenant A ≠ tenant B et que l'admin bypass voit
  tout) et `tenant-isolation.test.ts` (isolation applicative, filet indépendant
  du flag). Intégration DB exécutée uniquement si `TEST_DATABASE_URL` est défini
  (jamais la prod).

**Choix de conception :**
- `FORCE ROW LEVEL SECURITY` pour que la policy s'applique même au rôle
  propriétaire (isolation effective avec un rôle applicatif partagé). Une
  connexion sans contexte tenant ni bypass voit **0 ligne** (défaut sûr).
- `set_config(..., is_local=true)` (transaction-local) : compatible pooling, le
  contexte est réinitialisé à la fin de la transaction (le bypass ne fuit jamais
  vers la requête suivante sur la même connexion poolée).

**Plan d'activation** (décision opérateur, en test d'abord) : voir le runbook
RLS dans `bibliotheque/agents/agent-data-security.md` §4. Résumé : valider en
test (`TEST_DATABASE_URL` + suite vitest) → appliquer la migration 003 → router
le chemin widget/chat via `tenantQuery`/`withTenant` et les vues admin via
`withAdminBypass` → `DB_RLS_ENABLED=true` → valider tous les chemins → puis
seulement envisager la prod. Rollback : migration `.rollback.sql` + retrait du
flag.

**Reste à faire pour l'activation** (hors périmètre de cette livraison) :
- Câbler le chemin widget/chat (`chat.service.ts`, zone équipe chatbot) sur
  `tenantQuery`/`withTenant`, et les endpoints d'agrégation admin
  (`admin.routes`, `command-center.routes`, `fleet.service`) sur
  `withAdminBypass`.
- Décider du rôle de connexion (propriétaire avec `FORCE`, ou rôle applicatif
  non-propriétaire dédié au trafic tenant).
