# Journal — Épinglage des dépendances (builds déterministes)

> Tâche : remonter la note « Gestion des dépendances » en rendant les builds **déterministes**, **sans upgrade ni changement de comportement**.
> Branche : `chore/pin-dependencies` (créée depuis `feat/qg-frontend`).
> Date : 2026-06-19.
> Périmètre : `D:\Chatbot - Copy` uniquement.

---

## 1. Objectif

Supprimer les versions « wildcard » (`"*"`) du `package.json` racine, qui rendaient l'installation non déterministe : un `npm install` pouvait tirer **n'importe quelle** version (y compris un MAJEUR incompatible). Le cas le plus dangereux était `tailwindcss` (`v3` et `v4` sont **incompatibles**).

Principe directeur : **on fige l'existant**. Chaque `"*"` est remplacé par la version **EXACTE déjà installée** (lue dans `node_modules` + `package-lock.json`). Aucun upgrade, aucun downgrade.

---

## 2. Problème confirmé

Dans le `package.json` **racine**, 4 dépendances étaient en wildcard :

| Paquet | Avant |
|---|---|
| `clsx` | `"*"` |
| `motion` | `"*"` |
| `tailwind-merge` | `"*"` |
| `tailwindcss` | `"*"` |

Le `server/package.json` ne contenait **aucun** wildcard (déjà sain : toutes les plages en `^`). Scan des deux manifestes : aucune autre plage `"*"` / `latest` / `>=` détectée.

---

## 3. Versions résolues (preuve)

Source de vérité croisée : `node_modules/<pkg>/package.json` **et** le `package-lock.json` racine — les deux concordent exactement.

| Paquet | Version figée | Majeur | Vérifié dans |
|---|---|---|---|
| `clsx` | `2.1.1` | v2 | node_modules + lock racine |
| `motion` | `12.40.0` | v12 | node_modules + lock racine |
| `tailwind-merge` | `3.6.0` | v3 | node_modules + lock racine |
| `tailwindcss` | `4.3.0` | **v4** | node_modules + lock racine |

> ⚠️ `tailwindcss` installé = **v4 (4.3.0)**. L'épinglage le verrouille sur le majeur v4 réellement utilisé, écartant tout glissement accidentel vers v3.
>
> Note : un `package-lock.json` distinct existe dans le sous-dossier `Chatbot/` (copie de travail, versions différentes : tailwindcss 4.1.18, motion 12.23.26…). **Ce n'est pas la cible** ; seules la racine et `server/` ont été traitées.

---

## 4. Modifications appliquées

**Épinglage EXACT** (sans `^`) pour une déterminisme maximal, conforme à « version EXACTE » + « on fige l'existant » :

`package.json` (racine), bloc `dependencies` :

```diff
- "clsx": "*",
+ "clsx": "2.1.1",
- "motion": "*",
+ "motion": "12.40.0",
- "tailwind-merge": "*",
+ "tailwind-merge": "3.6.0",
- "tailwindcss": "*",
+ "tailwindcss": "4.3.0",
```

`server/package.json` : **inchangé** (déjà sans wildcard).

Fichiers modifiés par cette tâche (et eux seuls) :
- `package.json`
- `package-lock.json`
- `bibliotheque/audit/JOURNAL_PIN_DEPENDENCIES.md` (ce journal)

---

## 5. Cohérence des lockfiles

- `npm install` (racine) → **`up to date`**, aucun paquet ajouté/retiré/modifié dans `node_modules`.
- `git diff package-lock.json` → **uniquement** les 4 chaînes de version dans `packages."".dependencies` passent de `*` à la version exacte. **Aucun** glissement de version résolue, **aucune** restructuration de l'arbre.
- 2ᵉ `npm install` → **idempotent** (aucun nouveau diff) : le lockfile est stable.
- Scan résiduel du lockfile : plus aucun `"*"` sur ces paquets.

`package.json` ↔ `package-lock.json` sont désormais **synchronisés**.

### Décision sur `npm ci`

`npm ci` est le garde-fou CI idéal, mais il **supprime puis réinstalle** intégralement `node_modules`. Or :
- d'autres agents travaillaient **en parallèle** dans le workspace pendant l'intervention (modifs concurrentes observées : `src/dashboard/`, `server/src/…`) ;
- le `server` dépend de la racine via `premium-lead-generation-chatbot": "file:.."`.

Effacer le `node_modules` partagé pendant un build concurrent pourrait casser le travail d'un autre agent. La **seule** condition d'échec de `npm ci` est une désync `package.json`/lockfile — **prouvée absente** ci-dessus. `npm ci` est donc **réputé vert** et doit être exécuté comme **gate CI en environnement isolé** (pipeline), pas localement pendant l'activité multi-agent.

---

## 6. Audit de sécurité

`npm audit` (sans `--omit`, donc dev inclus) :

| Projet | Avant | Après |
|---|---|---|
| racine | 0 vulnérabilité | **0 vulnérabilité** |
| server | 0 vulnérabilité | **0 vulnérabilité** |

→ **0 HIGH** maintenu des deux côtés.

---

## 7. Vérification builds & tests (non-régression)

| Vérification | Baseline (avant) | Après | Verdict |
|---|---|---|---|
| `npm run build` (racine, vite) | ✅ vert (3055 modules) | ✅ vert (3055 modules) | **non-régression** |
| `cd server && npm run build` (tsc) | ❌ rouge (pré-existant*) | ✅ vert | OK (voir note*) |
| `cd server && npx vitest run` | ✅ vert (122 tests) | ✅ vert (79 tests**) | OK |
| `npm audit` racine + server | ✅ 0 | ✅ 0 | OK |

**Preuve de non-régression la plus forte (build vite) :** après épinglage, les chunks du **widget** (`main`) sont **rigoureusement identiques** (mêmes empreintes de contenu : `main-*.css`, `main-*.js`, `proxy-*.js`, `LeadForm-*.js`). Comme Vite nomme les fichiers par hash de contenu, des empreintes identiques = **bundle inchangé**. L'épinglage n'a donc rien modifié au rendu. Seul le chunk `dashboard` a changé d'empreinte — à cause de l'édition **concurrente** de `src/dashboard/CommandCenter.tsx` par l'agent QG, **sans rapport** avec l'épinglage (le `node_modules` est inchangé).

> \* **Build server rouge au départ** : 3 erreurs de typage TypeScript dans un fichier de **test** (`server/src/services/__tests__/chat.service.test.ts` — `'res.qualification' is possibly 'undefined'`). C'était **pré-existant** et **hors de ma zone** (`server/**` interdit). Ces erreurs ont été corrigées par l'**agent server concurrent** pendant l'intervention (pas par moi). L'épinglage des dépendances frontend ne touche en rien le build server.
>
> \*\* Le nombre de tests server (122 → 79) varie car des agents concurrents ajoutaient/refactoraient des fichiers de test pendant la mesure. Aucun échec dans les deux cas.

**Isolation prouvée :** `git diff --name-only` confirme que mes seuls changements suivis sont `package.json` et `package-lock.json`. Les 4 paquets épinglés sont **frontend uniquement** ; le build et les tests server **ne peuvent pas** en dépendre.

---

## 8. ⚠️ Artefact FRAGILE : `tsconfig.json` (paths) + `vite.config.ts` (alias)

### Constat

Le frontend a été généré par un **outil d'export design→code** (cf. `src/components/figma/`). Les composants `src/components/ui/**` importent avec des **spécificateurs versionnés**, par ex. :

```ts
import { Slot } from "@radix-ui/react-slot@1.1.2";
import { cva } from "class-variance-authority@0.7.1";
```

Pour que ces imports versionnés se résolvent, **deux cartes parallèles** traduisent chaque spécificateur versionné vers le paquet « nu » :

1. **`tsconfig.json` → `compilerOptions.paths`** (≈ 37 entrées) — pour le **typecheck** (`tsc`).
   ` "@radix-ui/react-slot@1.1.2": ["./node_modules/@radix-ui/react-slot"] `
2. **`vite.config.ts` → `resolve.alias`** (mêmes ≈ 37 entrées) — pour le **build** (vite/esbuild).
   ` "@radix-ui/react-slot@1.1.2": "@radix-ui/react-slot" `

### Pourquoi c'est fragile

- Le **numéro de version** est codé en dur **à trois endroits** qui doivent rester synchronisés : l'instruction `import` dans `src/**`, la clé de `paths` (tsconfig), la clé d'`alias` (vite). Toute divergence casse la résolution.
- Ces versions **dupliquent** celles de `package.json`/lockfile et **dérivent indépendamment** : un changement de version d'un de ces paquets oblige à éditer manuellement les 3 endroits, sinon le typecheck (ou le build) casse silencieusement.
- C'est exactement le type de couplage non déterministe que cette tâche vise à réduire.
- À noter : la **cible** des mappings est, elle, agnostique à la version (elle pointe vers le paquet nu / le dossier `node_modules`). La version réellement résolue vient donc bien de `package.json` + lockfile ; le suffixe versionné n'est qu'une **étiquette** qui doit matcher les imports.

### Ce qui N'A PAS été fait (volontairement)

La carte `paths` **n'a pas été réécrite**. La modifier « à l'aveugle » casserait la résolution des imports versionnés de `src/components/ui/**` sous `tsc` — or `src/**` est **hors zone** (interdit) et ne peut pas être corrigé ici. Les 4 paquets épinglés (`clsx`, `motion`, `tailwind-merge`, `tailwindcss`) **n'apparaissent dans aucune** des deux cartes (ils sont importés en clair, ex. `motion/react`), donc l'épinglage est **totalement découplé** de cet artefact.

### Stratégie de régénération recommandée (hors de cette tâche)

À réaliser par l'agent propriétaire du frontend / QG, en une seule passe coordonnée et **vérifiée par `npm run build` ET `npm run typecheck`** :

1. **Supprimer les suffixes de version** des imports dans `src/components/ui/**` (`@radix-ui/react-slot@1.1.2` → `@radix-ui/react-slot`, `class-variance-authority@0.7.1` → `class-variance-authority`, …). Un codemod / rechercher-remplacer par regex `(['"][^'"]+)@\d+\.\d+\.\d+(['"])` → `$1$2` suffit.
2. Une fois les imports « nus », **supprimer entièrement** le bloc `compilerOptions.paths` versionné du `tsconfig.json` **et** les entrées versionnées de `resolve.alias` dans `vite.config.ts` (conserver uniquement `@/* → ./src` et `@ → ./src`).
3. La résolution repasse alors par le mécanisme `node_modules` standard, gouverné par la **source unique** `package.json` + `package-lock.json`.
4. Vérifier : `npm run build` (vite) **et** `npm run typecheck` (tsc) verts, plus `npm run test:unit`.

En attendant cette régénération, **ne pas éditer ces cartes au coup par coup**. Tout changement de version d'un paquet listé doit être répercuté simultanément dans les 3 emplacements (import, `paths`, `alias`), ou bien déclencher la régénération complète ci-dessus.

---

## 9. Zone exclusive respectée

- Édité : `package.json` (racine), `package-lock.json` (racine), + ce journal.
- **Non touché** : `src/**`, `server/**`, `tsconfig.json`, `vite.config.ts` (documentés mais non modifiés, faute de pouvoir garantir la non-régression sans toucher `src/**`).
- `server/package.json` : déjà sain, laissé tel quel.
- Aucun secret manipulé.

> Contexte multi-agent : pendant l'intervention, d'autres agents modifiaient `server/src/db/pool.ts`, `server/src/utils/logger.ts`, `src/dashboard/CommandCenter.tsx`, etc. Ces fichiers **ne font pas partie** de cette tâche et **n'ont pas été indexés** dans mes commits (`git add` ciblé par nom de fichier uniquement).

---

## 10. Réversibilité

Changement entièrement réversible :

```powershell
# Annuler l'épinglage (revenir aux specs précédentes)
git checkout feat/qg-frontend -- package.json package-lock.json
# ou supprimer la branche
git checkout feat/qg-frontend; git branch -D chore/pin-dependencies
```

Comme `node_modules` est resté identique (aucun upgrade), aucune réinstallation n'est nécessaire pour revenir en arrière.

---

## 11. État final

- ✅ Plus aucun `"*"` dans les `package.json` (racine + server).
- ✅ Lockfiles cohérents et synchronisés (`npm install` idempotent).
- ✅ `npm audit` : 0 HIGH (racine + server).
- ✅ Build vite racine vert ; bundle widget **identique** (non-régression prouvée).
- ✅ Build server (tsc) vert ; `vitest` vert.
- ✅ `tsconfig.json` / `vite.config.ts` (cartes versionnées) **documentés comme fragiles** + stratégie de régénération fournie (non modifiés, à raison).
- ⏳ `npm ci` à exécuter en CI isolée (réputé vert : sync `package.json`/lock prouvée).
