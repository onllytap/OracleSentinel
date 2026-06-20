# ROADMAP — QG de contrôle à distance des chatbots

> Plan des features à attaquer pour transformer le QG (`/qg`) en véritable centre
> de commande des chatbots déployés en Cloudflare Workers : tout voir, tout piloter
> à distance, en sécurité. Aligné avec `decisions/ADR_0002` (gestion distante) et
> `architecture/VPS_DEPLOYMENT_MAP.md` (topologie réelle).
> Date : 2026-06-20.

---

## 0. La vérité d'architecture (à garder en tête)

Le pilotage se fait sur **2 couches distinctes**, présentées dans une seule fiche bot :

```
┌─ Couche EDGE (Cloudflare) ──────────┐   ┌─ Couche CERVEAU (backend Sentinel) ─┐
│ Worker = façade / proxy             │   │ oraclesentinel-server (:3001 VPS)   │
│ • env vars (ex. BACKEND_URL)        │   │ • system prompt, modèle LLM         │
│ • déployer une nouvelle version     │   │ • conversations, leads (PostgreSQL) │
│ • désactiver / supprimer / dupliquer│   │ • config par tenant (factory)       │
│  → API Cloudflare                   │   │  → backend + DB                     │
└─────────────────────────────────────┘   └─────────────────────────────────────┘
```

Conséquences de design :
- **« Modifier le prompt/modèle »** = couche cerveau (backend), PAS le Worker.
- **« Redémarrer »** n'existe pas en serverless → équivaut à **redéployer une version**
  + re-vérifier la santé (health-ping réel).
- **Statut ONLINE/DOWN/latence** = health-ping réel des URLs `*.workers.dev` +
  analytics Cloudflare. Jamais de valeur inventée.
- **Conversations** = base Sentinel → soft/hard delete côté backend.

---

## 1. Méthode de travail (comment planifier chaque feature)

Pour **chaque** feature :
1. **Observer** (lire le code/données concernés) → 2. **Concevoir** (ADR si décision
   structurante) → 3. **Implémenter** (branche, additif, réversible) → 4. **Tester**
   (unitaire + build) → 5. **Vérifier** (en live, sans casser) → 6. **Documenter** →
   7. **Commit + push GitHub**.

Garde-fous transverses (non négociables) :
- **Lecture avant écriture avant destructif.** On livre dans cet ordre.
- **Audit** de toute action (qui, quoi, quand, résultat).
- **Confirmation explicite** + double confirmation pour tout ce qui est destructif.
- **Soft-delete par défaut**, hard-delete en dernier recours.
- **Secrets** : jamais en clair, jamais commités. Le **MCP Cloudflare reste un outil
  de dev** — la prod utilise un **token Cloudflare scoppé** dans `.env`.
- Ne pas toucher : logique LLM/Groq, design widget, payloads CRM, autres projets du VPS.

---

## 2. Prérequis (Phase 0)

| Élément | État | Action |
|---|---|---|
| Backend public joignable (`api.oraclesentinel.com`) | ✅ fait (ADR_0004) | — |
| Token Cloudflare scoppé en `.env` | ⏳ à fournir | `CLOUDFLARE_API_TOKEN` (Workers Scripts: Read d'abord), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN=neverdiscord666` |
| Accès VPS (SSH clé) | ✅ fait | clé `kiro-sentinel` |

> Le token démarre en **lecture seule** (Phase 1). On élève les droits (Edit) seulement
> à la Phase 2, quand on active le déploiement.

---

## 3. Les phases

### Phase 1 — VISION (lecture seule) · risque : faible
**Quoi** : un onglet **« Workers »** dans le QG.
- Liste des Workers (API Cloudflare) : nom, date de déploiement, compat date.
- **Statut live réel** : health-ping de `*.workers.dev` (online / dégradé / down + latence).
- **Analytics** : requêtes/jour, erreurs %, CPU (GraphQL Cloudflare ; ~0 si peu de trafic).
- **Check backend public** : `api.oraclesentinel.com/health` affiché dans le QG.
- Vue détail (read-only) : bindings (type+nom, **sans valeurs secrètes**), URL, santé.

**Comment** : `server/src/services/cloudflare.service.ts` (lit le token `.env`,
dégrade proprement si absent) + routes `GET /api/priv/workers` et `/workers/:name`
(gated `requireAdminSession`, `no-store`) + composant `WorkersView` dans `CommandCenter.tsx`.
Cache court (~15 s) car les pings sortent sur le réseau.

**Critère d'acceptation** : je vois mes 4 Workers réels avec un statut réel et,
si le token est posé, leurs métriques. Aucune action destructrice possible.
**Dépendances** : token CF (lecture). **Sécurité** : valeurs de bindings masquées.

---

### Phase 2 — CONFIG ÉDITABLE + REDÉPLOIEMENT CONTRÔLÉ · risque : moyen
**Quoi** : éditer la config d'un bot **à distance** et l'appliquer.
- **Cerveau (backend)** : édition de la config par tenant, **versionnée** (table
  `bot_config_versions`, append-only — cf. ADR_0002 étape B). Create/Update = nouvelle
  version, jamais d'écrasement.
- Bouton **« Appliquer & Redéployer »** : réutilise le pipeline `/factory` existant
  (diff → dry-run/readiness → apply → **vérification health** → consigne la version).
  Échec → **rollback** auto vers la version précédente.
- **Edge (Worker)** : éditer les env vars (ex. `BACKEND_URL`) + **déployer une nouvelle
  version** via l'API Cloudflare ; le QG re-ping jusqu'au retour online.

**Comment** : étendre `factory` (versioning) + `cloudflare.service` (PUT settings /
deploy). Token CF élevé à **Edit**. Audit de chaque apply.
**Critère d'acceptation** : changer un prompt **ou** une env var → vérifié live →
versionné → rollback possible en 1 clic.
**Dépendances** : Phase 1. **Risque** : moyen → backups + audit + confirmation.

---

### Phase 3 — MONITORING AVANCÉ · risque : faible-moyen
**Quoi** :
- Historique des **déploiements/redémarrages** (heure + résultat) — `factory_builds`
  + journal des déploiements Worker.
- **Logs live** (N dernières lignes) : Cloudflare tail (si exposé) + logs backend.
- **Uptime** depuis le dernier déploiement + **alertes** « down depuis X min »
  (à partir du health-ping historisé).

**Comment** : historiser les pings (table légère `worker_health_probes` ou en mémoire
bornée) ; endpoint d'historique ; widget timeline dans la fiche.
**Critère d'acceptation** : la fiche bot montre un historique réel + une alerte quand
un worker est down. **Dépendances** : Phase 1.

---

### Phase 4 — GESTION DES CONVERSATIONS (soft / hard delete) · risque : moyen-élevé
**Quoi** :
- **Soft delete** : masquer les conversations pour l'utilisateur final, conservées côté
  admin → **restaurables**.
- **Hard delete** : suppression définitive, **double confirmation** (« irréversible »).
- Historique des conversations (filtre date / utilisateur).

**Comment** : colonne `deleted_at` (additive) sur `conversations`/`messages` (filtrée
partout côté lecture publique) ; endpoints `soft-delete` / `restore` / `hard-delete`
(gated + audit). Migration **additive** via `ensure-db` (jamais destructive au schéma).
**Critère d'acceptation** : soft-delete cache puis restaure ; hard-delete supprime après
double confirmation, le tout audité. **Risque** : données → backups + audit obligatoires.

---

### Phase 5 — ACTIONS WORKER (destructives) · risque : ÉLEVÉ
**Quoi** : Redémarrer (= redéployer la version courante) · Désactiver (offline sans
suppression) · Dupliquer (cloner la config vers `/factory`) · **Supprimer le Worker**.

**Comment** : API Cloudflare (deploy / route / DELETE script). **Double confirmation**
systématique, **audit**, et **« désactiver » recommandé avant « supprimer »**.
**Critère d'acceptation** : chaque action marche et est tracée ; impossible de supprimer
sans 2 confirmations. **Risque** : élevé → on le fait en **dernier**, après validation
explicite à chaque action.

---

### Phase 6 — PERMISSIONS & DURCISSEMENT · risque : moyen
**Quoi** : passer de l'admin mono-clé à **multi-utilisateur + rôles** (`viewer` /
`operator` / `owner`) via better-auth (déjà câblé) + 2FA. Actions destructrices = `owner`.
**Comment** : ADR dédié (cf. ADR_0002 étape D). Audit complet, rate-limit renforcé.
**Critère d'acceptation** : un `viewer` ne peut pas déployer/supprimer ; tout est audité.

---

## 4. Séquencement recommandé

```
Phase 0 (token CF)  →  Phase 1 (voir)  →  Phase 2 (éditer+redéployer)
   →  Phase 3 (monitoring)  →  Phase 4 (conversations)  →  Phase 5 (destructif)  →  Phase 6 (rôles)
```

Valeur livrée tôt (on « voit tout » dès la Phase 1), risque croissant maîtrisé,
destructif en dernier. Chaque phase est livrable et réversible indépendamment.

## 5. Ce qu'on attaque maintenant

**Phase 1** (lecture seule, sûre) — je démarre le backend `cloudflare.service.ts` +
routes `/api/priv/workers` + onglet **Workers** dans le QG. Token CF requis pour les
données réelles (sinon le QG affiche « Cloudflare non configuré » sans planter).
