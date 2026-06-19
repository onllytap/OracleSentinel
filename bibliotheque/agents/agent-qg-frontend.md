# Journal — Agent QG Frontend

> Agent dédié à l'étape **3b de l'ADR_0001** : enrichir l'onglet « Chatbots » du QG React
> (`src/dashboard/CommandCenter.tsx`) pour un usage entreprise à 350+ agences.
> Branche : `feat/qg-frontend`. Zone de travail exclusive : `src/dashboard/**`.

---

## Contexte lu avant d'agir

1. `bibliotheque/README.md` — index + carte du code.
2. `bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md` — contraintes (ne pas reconstruire,
   ne pas toucher LLM/Groq, design widget, payloads CRM, backend ; évolution réversible).
3. `bibliotheque/architecture/ARCHITECTURE.md` — §6 = le QG (3 surfaces, auth `admin_session` + CSRF).
4. `bibliotheque/decisions/ADR_0001_evolution_qg_supervision_unifiee.md` — étapes 1→3b.

## Contrat d'API utilisé (existant, NON modifié)

- `GET /api/admin/db/tenants` → `{ success, tenants:[{ tenant_id, property_count, available,
  retired, conversation_count, lead_count, last_import, last_updated, widgetIds[] }] }`
  (base de la table + cible de la purge par `tenant_id`).
- `GET /api/priv/overview` → `{ success, generatedAt, summary{...}, agencies:[{ tenantId,
  widgetIds[], propertyCount, available, retired, conversationCount, leadCount, conversionRate,
  lastActivityAt, lastImportAt, lastImportErrors, active, health }] }`
  (`health` = healthy|idle|attention|empty). Source de la santé par agence.

Les deux endpoints dérivent du même ensemble de tenants (catalog_properties ∪ WIDGET_TENANT_MAP).
Fusion **par `tenantId`** côté client : la table reste pilotée par `/db/tenants` (rétro-compat +
purge), enrichie par `overview` (santé + métadonnées). `overview` est optionnel : s'il échoue,
la table fonctionne toujours (dégradation gracieuse, badge « santé indisponible »).

---

## Décisions d'implémentation

- **Additif & réversible** : aucune route backend touchée, aucune nouvelle dépendance.
- **Pagination** (25/page) plutôt que virtualisation : zéro dépendance, robuste à 350+.
- **Tri « problèmes d'abord » par défaut** : rang santé `attention < empty < idle < healthy`,
  colonnes triables (clic en-tête).
- **Filtre santé** (chips avec compteurs) + **recherche** (tenantId / widgetId) combinés.
- **Réutilisation UI** : `Card`, `Badge`, `Table`, `Dialog`, `Stat`, `Skeleton`, `cn`,
  `GradientButton`, `UtilityButton`. Couleurs santé : healthy=vert, idle=gris, attention=orange,
  empty=neutre.
- **Logique d'auth et de purge tenant inchangée.**

---

## Changements (au fil de l'eau)

- [init] Création de la branche `feat/qg-frontend` + ce journal.

## Réalisé (étape 3b) — `src/dashboard/CommandCenter.tsx`

Modifications **additives**, dans la zone exclusive `src/dashboard/**` uniquement :

- **Helpers santé** (module-level) : `type Health`, `HEALTH_CONFIG`
  (healthy=vert/emerald, attention=orange/amber, idle=gris/slate, empty=neutre),
  `HEALTH_RANK` (tri « problèmes d'abord »), `HEALTH_FILTERS`, composant `HealthBadge`,
  `convRate()`, `lastActivityOf()`, composant `SortHeader` (en-tête de colonne triable).
- **`ChatbotsView` réécrit** :
  - **Fusion** `/api/admin/db/tenants` (base + cible de purge) × `/api/priv/overview`
    par `tenantId` → enrichit chaque ligne avec `health`, `conversionRate`,
    `lastImportErrors`, `lastImportAt`, `lastActivityAt`, `active`.
  - Overview **optionnel** : s'il échoue, la table reste fonctionnelle + bandeau
    « État de santé indisponible ».
  - **Colonne « État »** avec badge santé coloré.
  - **Tri** triable par colonne, **défaut = santé / problèmes d'abord** (tie-break :
    agences les plus actives d'abord, puis nom).
  - **Recherche** (tenantId / widgetId) + **filtre par état** (chips avec compteurs).
  - **Pagination** 25/page (reset page sur changement recherche/filtre/tri ; clamp).
  - États **loading / erreur / vide** soignés (+ bouton « Réinitialiser les filtres »),
    table en `overflow-x-auto` pour le **responsive**.
- **`BotDetail` enrichi** (rétro-compatible) : badge santé + statut d'activité (si dispo),
  taux de conversion (valeur serveur prioritaire), **erreurs au dernier import**,
  dernier import & dernière activité (champs overview avec fallback snake_case).
  Logique de **purge tenant inchangée**.

### Vérification
- `npm run build` (= `vite build`) : ✅ OK — 3055 modules, *built in ~16.8s*,
  `build/dashboard.html` + `build/assets/dashboard-*.js|css` régénérés (exit 0).
- `npm run typecheck` (`tsc --noEmit`) : ✅ **0 erreur** (projet entier).
- Aucun fichier backend modifié. Aucune dépendance ajoutée. Aucun secret touché.
  Sous-module `Chatbot/` non touché.

### Git
- Branche : `feat/qg-frontend`.
- Fichiers stagés (précis) : `src/dashboard/CommandCenter.tsx`,
  `bibliotheque/agents/agent-qg-frontend.md`.
- Non stagés volontairement : sous-module `Chatbot`, `server/src/services/__tests__/qualification.service.test.ts`
  (préexistant, hors périmètre).
