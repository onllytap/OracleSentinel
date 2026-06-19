# Audit final senior

Date de cloture : 2026-06-07.

## Note finale

**7.8/10 - stable, livrable, mais pas encore "enterprise-grade".**

Le projet est passe d'un etat fonctionnel mais fragile a un socle verifie par tests, audits, builds, Playwright, Sentry MCP et CI.

## Notes par axe

| Axe | Note | Commentaire senior |
|---|---:|---|
| Securite applicative | 8.2 | Admin, auth widget, CSRF, rate limit, audits npm OK |
| Stabilite frontend | 7.6 | E2E + tests API frontend, mais peu de tests composants |
| Stabilite backend | 7.8 | Controleur chat, middlewares et validateurs couverts |
| Tests / QA | 7.7 | 64 tests au total, mais couverture globale serveur encore basse |
| CRM / pipeline leads | 7.5 | Config et contrat push testes, connecteurs encore peu couverts |
| Observabilite | 7.5 | Sentry active, release non nulle, mais pas valide par deploiement live |
| CI/CD | 8.4 | Workflow GitHub Actions present et coherent |
| Dette structurelle | 6.7 | Gros fichiers metier encore massifs |

## Tests en place

| Zone | Couverture utile |
|---|---|
| Frontend API service | health, widget auth, chat, 429, lead form |
| Chat controller | validation, erreurs LLM/rate-limit, pagination, lead duplicate |
| Admin | API key, session JWT, CSRF |
| Widget auth | token, scope, origine |
| Rate limit store | SQL quote, increment, fallback DB, reset/cleanup |
| Domain runtime | normalisation domaine, profil runtime |
| Prompts | garage, immobilier, OracleSentinel |
| CRM | config, validator, push result |
| Validators | chat + lead form |
| Sentry | release name |

## Commande de confiance

Si une seule commande doit etre lancee avant de livrer :

```powershell
npm run verify
```

Puis, pour le serveur :

```powershell
cd server
npm run verify
```

## Risques residuels acceptes

| Risque | Niveau | Pourquoi accepte |
|---|---:|---|
| Couverture globale serveur faible | Moyen | Les zones critiques exposees ont ete priorisees |
| Gros services metier peu decoupes | Moyen | Refactor trop large pour ce palier |
| Warning `.env` sur `NODE_ENV=production` | Bas | Non bloquant, fichier sensible non modifie |
| Issue Sentry externe | Bas pour ce dossier | Ne pointe pas vers ce codebase |

## Prochain chantier seulement si necessaire

Le prochain vrai saut de qualite serait :

1. Extraire et tester la logique pure de `chat.service.ts`.
2. Decouper `admin.routes.ts`.
3. Tester `catalog.service.ts` et `catalog-import.service.ts`.
4. Encadrer les connecteurs CRM par tests de contrat.
5. Ajouter des tests composants React si l'UI evolue souvent.

Tant qu'aucun de ces chantiers n'est explicitement demande, le dossier peut rester en l'etat.
