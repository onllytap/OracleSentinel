# ADR_0001 — Évolution du QG vers une supervision unifiée

- **Statut** : Accepté — Étape 1 livrée (2026-06-19). Validé par le propriétaire (« finissons le QG pour 350 agences »).
- **Date** : 2026-06-19
- **Décideurs** : propriétaire produit + ingénierie
- **Références** : `bibliotheque/architecture/ARCHITECTURE.md` §6, `bibliotheque/audit/INITIAL_ANALYSIS.md` §6-7

---

## État d'implémentation

| Étape | Description | Statut |
|---|---|---|
| 1 | Agrégateur backend `GET /api/priv/overview` (résumé flotte + santé par agence + cache) — `services/fleet.service.ts`, `routes/command-center.routes.ts` | ✅ Livré (build OK) |
| 1b | Page servie `/priv` (`views/priv.html`) : KPI « 350 » codé en dur remplacé par le nombre réel d'agences + section « État des agences » (santé : sain/veille/alerte/vide), XSS-safe | ✅ Livré |
| 2 | Servir le QG React (`CommandCenter.tsx`) en production via le backend (static + route) | ✅ Livré — route `/qg` (build vérifié) |
| 3 | Onglet « Bots/Agences » du QG React consommant `/api/priv/overview` (drill-down, recherche, pagination 350) | ⏳ Proposé |

### Implémentation étape 2
`server/src/index.ts` sert désormais le Command Center React en production :
- `express.static(build/, { index:false })` pour les assets hashés (résolution multi-chemins : `../../build` local, `../build` docker full-stack) ;
- route `GET /qg` → `build/dashboard.html` (CSP adaptée SPA, fallback explicite si `build/` absent) ;
- `/priv` (page infra+flotte légère) **conservée intacte** comme repli.
Build vérifié : `tsc` serveur OK + `vite build` OK (`build/dashboard.html` + `build/assets/dashboard-*.js|css`, 3055 modules, 23.8s). Le QG React appelle `/api/admin/*` et `/api/priv/*` en same-origin.

### Suite recommandée
Étape 3 : enrichir l'onglet « Chatbots » du QG React avec `/api/priv/overview` (santé par agence, tri worst-first, recherche/pagination pour 350+). Optionnel : pointer `/priv` vers le QG React si tu veux une URL unique.


## Contexte

Le « QG Admin » est aujourd'hui réparti sur **trois surfaces** au mécanisme d'authentification commun (`admin_session` + CSRF) mais aux interfaces séparées :

- `/admin` — données (vue DB par tenant, CRUD catalogue, purge tenant) ;
- `/factory` — configuration & build des bots, tests connexions, rollback ;
- `/priv` — santé de l'infrastructure (sondes temps réel).

Conséquences actuelles :
- l'opérateur navigue entre trois pages pour une tâche unique (ex. diagnostiquer un bot) ;
- la **vue « état des chatbots »** (activité, erreurs récentes, dernier import, volume de leads par tenant) n'est pas consolidée ;
- `/priv` couvre l'infra mais **pas l'état applicatif des bots**.

La mission demande explicitement de permettre de voir : état des chatbots, informations utiles, erreurs, activité, configuration.

## Décision

Faire **converger** les trois surfaces vers une **vue de supervision unifiée**, sans casser les pages existantes, en procédant par addition :

1. **Conserver** `/admin`, `/factory`, `/priv` tels quels (rétro-compatibilité, aucun risque de régression).
2. Ajouter un **agrégateur de supervision en lecture seule** côté backend : un endpoint `GET /api/priv/overview` (gardé par `requireAdminSession`) qui compose :
   - le snapshot infra existant (`collectInfraSnapshot`) ;
   - un **résumé par tenant/bot** (réutilisant les requêtes déjà présentes dans `admin.routes` et `factory.routes` : nombre de conversations, leads, dernier import, erreurs d'import, statut de config) ;
   - les dernières erreurs applicatives (via `logBuffer` factory déjà existant).
3. Étendre le frontend `src/dashboard/CommandCenter.tsx` (déjà une app React authentifiée) avec un onglet **« Bots »** consommant cet agrégateur. Le CommandCenter devient le point d'entrée unique ; `/admin` et `/factory` restent accessibles en « vue détaillée ».
4. Aucune nouvelle donnée n'est créée : l'agrégateur **réutilise** les sources existantes (pas de duplication, pas de schéma nouveau à ce stade).

## Conséquences

**Positives**
- Vue 360° (infra + bots + activité) sans refonte.
- Réutilisation maximale du code et de l'auth existants → faible risque.
- Évolution réversible (un endpoint + un onglet ; suppression = retour à l'état actuel).

**Négatives / coûts**
- Un endpoint d'agrégation à maintenir (performances : prévoir un cache court / requêtes bornées).
- Risque de surcharge DB si l'agrégateur est appelé trop souvent → polling raisonné + `Cache-Control: no-store` mais throttle côté client.

**Risques & mitigations**
- *Charge DB* : borner les requêtes (LIMIT), agréger par `COUNT` indexés `(tenant_id, …)` déjà présents, cache mémoire 5–10 s.
- *Exposition de données* : l'agrégateur ne renvoie que des **compteurs et métadonnées** (jamais de PII de lead en clair dans la vue d'ensemble).

## Plan d'implémentation (après validation)

1. `GET /api/priv/overview` (lecture seule, session-gated, données agrégées bornées + cache court).
2. Tests unitaires de l'agrégateur (mock pool).
3. Onglet « Bots » dans `CommandCenter.tsx` (santé + activité par tenant).
4. Documentation : mise à jour `ARCHITECTURE.md` §6.

## Alternatives écartées

- **Refonte complète du QG en une seule app** : rejetée (risque élevé, contraire au handoff « ne pas reconstruire »).
- **Fusionner les routes existantes** : rejetée (casse la rétro-compatibilité et les pages HTML servies).
