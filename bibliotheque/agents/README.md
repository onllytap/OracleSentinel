# 🛰️ Coordination multi-agents — OracleSentinel / Sentinel

> Tableau de bord pour faire travailler plusieurs agents IA **en parallèle** sur
> `D:\Chatbot - Copy` **sans collision** et sans casser la production.
> Source de vérité de l'organisation. Mise à jour : 2026-06-19.

---

## 1. Règles d'or (valent pour TOUS les agents)

1. **Une branche par agent.** Jamais de commit/push direct sur `main`. Le **Lead** seul merge.
2. **Zone exclusive.** Chaque agent n'édite QUE les fichiers de sa colonne « Édite ». En cas de
   doute, il s'arrête et le note dans son journal.
3. **Commits ciblés.** Jamais `git add -A` / `git add .` (à cause du sous-dépôt `Chatbot/` qui
   contient un secret non ignoré). On stage des fichiers nommés.
4. **Zéro secret.** On ne lit/affiche/commite jamais une valeur de `.env`. On référence par nom de clé.
5. **Ne pas casser l'existant.** Pas de modif de la logique LLM/Groq, du widget, des payloads CRM.
   Tout changement risqué est réversible et, si possible, derrière un flag désactivé par défaut.
6. **Périmètre = `D:\Chatbot - Copy` uniquement.** `SYSTEM 2 VRAI` et `projet-3 VRAI` = lecture seule.
   Le dossier `Chatbot/` (sous-dépôt git séparé) n'est touché par personne.
7. **Journal obligatoire.** Chaque agent tient `bibliotheque/agents/agent-<nom>.md` (décisions,
   fichiers touchés, points de coordination).
8. **Vérifier avant de rendre.** Builds + tests verts (voir §5). Les builds sont lents (>120 s) →
   les lancer en arrière-plan et attendre le signal de succès.

---

## 2. Roster & couloirs (zones disjointes)

| Agent | Branche | ✅ Édite (exclusif) | ⛔ Ne touche pas | Mission / note visée |
|---|---|---|---|---|
| **Lead / Intégration** (architecte) | `main` + `feat/remote-control-design` | `main` (merge), `bibliotheque/decisions/**` (ADR), `bibliotheque/agents/README.md`, `.kiro/specs/**` | le code des couloirs actifs pendant qu'ils travaillent | Revue, merge non-régression, **ADR_0004** + design remote-control (priorité 1) |
| **A1 — QG Frontend** | `feat/qg-chatbots-supervision` | `src/dashboard/**` | `server/**`, `package.json`, `src/` hors dashboard | Onglet Chatbots supervision (ADR_0001 3b) — *Frontend 13→16+* |
| **A2 — Tests backend** | `feat/backend-tests` | `server/src/**/__tests__/**` (+ `export` minimes) | `src/**`, logique métier | Couverture tests (F6) — *Tests 13→16+* |
| **A3 — Data-security** | `feat/data-security-hardening` | `server/src/db/**`, `.github/workflows/**`, `scripts/**`, `server/src/utils/logger.ts` ; *partagé (additif)* : `admin-session.ts`, `index.ts` | `src/**`, `.dockerignore` (→ C1), flux **2FA** (→ spec) | RLS/TLS/secrets/RGPD (F8/F12/F5) — *Sécurité 18→, robustesse* |
| **C1 — Hygiène dépôt** | `feat/repo-hygiene` | racine (hors code), `.gitignore`, `.dockerignore`, entrées git fantômes | `src/**`, `server/**` (code), `package.json`, `index.html`, `dashboard.html` | Hygiène/organisation — *9→16+* |
| **C2 — Documentation** | `docs/onboarding` | `README.md` (racine), `docs/**`, liens dans `bibliotheque/README.md` | code, config, ADR existants | Documentation — *8→16+* |
| **C3 — Dépendances** | `chore/pin-dependencies` | `package.json` (racine+server), lockfiles, `tsconfig.json` | `src/**`, `server/**` (logique) | Déterminisme deps — *10→17+* |

> Les notes proviennent de l'audit le plus récent (global 14/20). Tests (13) et Frontend (13) sont
> portés par A2 et A1 ; les 3 notes les plus basses (Doc 8, Hygiène 9, Deps 10) par C2/C1/C3.

---

## 3. Chevauchements arbitrés (lire avant de lancer)

| Fichier / sujet | Risque | Décision |
|---|---|---|
| `.dockerignore` | C1 **et** A3 le visent | **C1 le possède.** A3 le saute. |
| `.env.backup.*` (suppression) | secrets sur disque | **Personne ne supprime auto.** Décision opérateur via le script dry-run de A3. |
| `tailwindcss` épinglé (C3) | impacte le build du QG (A1) | C3 épingle à la **version installée** (pas d'upgrade) ; vérifier le build ; **merger C3 en premier**. |
| `admin-session.ts`, `index.ts` | A3 (additif) ⟷ futur remote-control (Lead) | A3 fait des changements **minimes/additifs** ; merger A3 **avant** le flux 2FA du spec. |
| `bibliotheque/**` | plusieurs agents écrivent | `decisions/**` = Lead ; `agents/agent-*.md` = chaque agent (nom distinct) ; `agents/README.md` = Lead ; C2 n'ajoute que des **liens** dans `bibliotheque/README.md`. |
| `__tests__/**` | A2 **et** A3 (tests d'isolation) | Noms de fichiers **distincts** : A3 → `tenant-isolation.test.ts`, `rls.test.ts`, `pool-tls.test.ts` ; A2 → tests unitaires de services. |

---

## 4. Ordre de merge (par le Lead)

```
C3 (deps déterministes)  →  C1 (hygiène)  →  A3 (data-security)  →  A1 + A2 (QG + tests)  →  C2 (docs, en dernier)
```

- Le Lead lance une **non-régression complète après CHAQUE merge** (voir §5).
- En cas de conflit : zones disjointes ⇒ il ne devrait pas y en avoir ; sinon le Lead arbitre selon §3.
- `main` reste toujours déployable.

---

## 5. Vérification (non-régression standard)

```powershell
# Frontend (racine) — build lent, lancer en arrière-plan
npm run build                       # vite build → build/dashboard.html + build/assets/*

# Backend (server/)
npm run build                       # tsc && copy-assets  → "Copied views + migrations to dist/"
npx vitest run                      # tous les tests verts
npm audit                           # 0 vulnérabilité HIGH
```

---

## 6. Rôle du Lead (moi) — ce que je fais « en plus » de coordonner

- **Intégration** : revue de branches, merge dans l'ordre §4, non-régression, garde `main` sain.
- **Architecture** : `ADR_0004` = réconciliation `ADR_0002` ⟷ spec `command-center-remote-control`
  + design du **`Effective_Config` par tenant et son hot-reload** (la contrainte dure : un seul
  process partagé ⇒ « redéployer un bot » = recharger sa config, pas redémarrer le process).
- **Spec** : tenir `.kiro/specs/command-center-remote-control` à jour (acter que Req 9/10 sont déjà
  faites : SSRF guard + deps HIGH).
- **Priorité 1 réelle** : préparer le terrain du contrôle distant pour qu'il se branche dans les
  points d'extension laissés par A1.

---

## 7. Ajouter un nouvel agent (checklist)

1. Lui donner une **branche** et une **zone exclusive** qui n'empiète sur aucune ligne du §2.
2. Vérifier les **chevauchements** (§3) ; arbitrer AVANT de lancer.
3. Lui imposer les **règles d'or** (§1) et un **journal** `agent-<nom>.md`.
4. L'ajouter à ce tableau et à l'**ordre de merge** (§4).
