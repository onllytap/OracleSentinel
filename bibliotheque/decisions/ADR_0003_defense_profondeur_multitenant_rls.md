# ADR_0003 — Défense en profondeur multi-tenant (Row-Level Security PostgreSQL)

- **Statut** : Proposé (en attente de validation)
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
