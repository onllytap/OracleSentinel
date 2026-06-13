# Documentation de depart - Chatbot OracleSentinel

Ce dossier est le point d'entree unique pour comprendre, verifier et reprendre le projet.

## Verdict final

Le dossier `D:\Chatbot - Copy` est considere comme stable pour ce palier.

Score critique senior final : **7.8/10**.

Ce n'est pas un 10/10 parce que les gros services metier restent encore peu couverts par des tests unitaires profonds, surtout `chat.service.ts`, `admin.routes.ts`, `factory`, `catalog` et les connecteurs CRM. En revanche, le socle technique est maintenant propre : typage, builds, tests, Playwright, audits et CI sont en place.

## Etat verifie

| Controle | Etat |
|---|---|
| TypeScript frontend | OK |
| TypeScript serveur | OK |
| Build frontend | OK |
| Build serveur | OK |
| Tests unitaires frontend | OK, 5 tests |
| Tests unitaires serveur | OK, 59 tests |
| Playwright E2E | OK, 8 scenarios desktop + mobile |
| Audit npm root | OK, 0 vulnerabilite |
| Audit npm serveur | OK, 0 vulnerabilite |
| CI GitHub Actions | OK, workflow ajoute |
| Sentry MCP | 1 issue restante, externe a ce dossier |

## Commandes de verification

Depuis la racine du projet :

```powershell
npm run verify
npm audit
```

Depuis le serveur :

```powershell
cd server
npm run verify
npm run test:coverage
npm audit
```

Le `verify` racine lance maintenant :

```text
typecheck -> tests unitaires frontend -> build frontend -> Playwright -> audit prod
```

Le `verify` serveur lance :

```text
typecheck -> tests unitaires serveur -> build serveur -> audit prod
```

## Ce qui a ete securise

| Zone | Etat |
|---|---|
| Admin API key | Testee |
| Admin session + CSRF | Testes |
| Widget auth JWT | Teste |
| Rate limit store PostgreSQL | Durci et teste |
| Validation des inputs chat/lead | Testee |
| Sentry release tracking | Corrige |
| Domaine runtime profil/env | Centralise |
| CRM config | Validation renforcee, y compris `NaN` |
| Frontend API service | Teste |
| Playwright | Desktop + mobile |

## Point Sentry a ne pas confondre

Sentry montre encore l'issue `JAVASCRIPT-NEXTJS-A` :

```text
NOT_TAGGED_CALL: Query not called as a tagged template literal
```

Cette issue vient d'un autre chemin/projet utilisant `postgres@3.4.9`. Le dossier actuel `D:\Chatbot - Copy` utilise `pg`, et les scans locaux n'ont pas montre ce pattern dans le code actif de ce dossier.

Conclusion : ne pas bloquer ce dossier a cause de cette issue Sentry externe.

## Seul warning local connu

Le fichier `.env` contient :

```text
NODE_ENV=production
```

Vite affiche un warning avec cette valeur. Les tests, builds et audits passent quand meme.

Je n'ai pas modifie `.env` parce que ce fichier peut contenir des secrets. Si vous voulez supprimer le warning local, retirez cette ligne ou adaptez-la hors secrets.

## Structure du dossier de docs

```text
00_DEPART_DOCS/
  README.md
  00_COMMENCER_ICI/
  01_AUDIT_ET_ETAT_PROJET/
  02_GUIDES_UTILISATION/
  03_DEPLOIEMENT_ET_PROD/
  04_PROMPTS_ET_ARCHIVES/
  05_DOCS_TECHNIQUES/
  99_ARCHIVES_LOURDES/
```

## Ou chercher quoi

| Besoin | Dossier |
|---|---|
| Comprendre rapidement le projet | `00_COMMENCER_ICI` |
| Voir les audits, diagnostics, rapports | `01_AUDIT_ET_ETAT_PROJET` |
| Changer de domaine, profil, tester, securiser | `02_GUIDES_UTILISATION` |
| Deployer ou diagnostiquer la prod/VPS | `03_DEPLOIEMENT_ET_PROD` |
| Retrouver les prompts et historiques longs | `04_PROMPTS_ET_ARCHIVES` |
| Docs techniques avancees | `05_DOCS_TECHNIQUES` |
| Fichiers volumineux / references lourdes | `99_ARCHIVES_LOURDES` |

## Decision senior

Ne plus toucher a ce dossier pour ce palier, sauf si l'un de ces cas arrive :

1. Un test `verify` echoue.
2. Une vulnerabilite npm revient.
3. Sentry remonte une issue qui pointe explicitement vers `D:\Chatbot - Copy`.
4. Une fonctionnalite metier nouvelle est demandee.
5. On decide volontairement d'attaquer le prochain gros chantier : tests profonds de `chat.service.ts`, `catalog`, `admin.routes.ts`, `factory` et connecteurs CRM.

Sinon : le dossier est assez stable pour etre garde comme base propre.
