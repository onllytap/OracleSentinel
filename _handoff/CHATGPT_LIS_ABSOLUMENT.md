# CHATGPT LIS ABSOLUMENT - Passation OracleSentinel / Sentinel

Ce fichier est a lire en premier, avant toute analyse, commande, modification ou conclusion sur le projet.

Le createur du projet a donne un contexte tres important : ce workspace est une backup d'entreprise, sensible, et probablement incomplet par rapport a l'ensemble reel du systeme. Il ne faut pas juger le projet uniquement depuis un dossier local sans verifier les autres dossiers/documentations mentionnes.

## Mission reelle du projet

OracleSentinel / Sentinel vise a resoudre le probleme de prospection manuelle des agences immobilieres.

Le produit principal est un chatbot widget tres design qui :

- qualifie les leads immobiliers ;
- discute avec eux de facon fluide ;
- aide a closer ou pre-closer les prospects ;
- collecte les donnees utiles ;
- renvoie les informations vers le CRM de l'entreprise cliente.

La partie chatbot s'appelle surtout **Sentinel**. La partie **Oracle** correspond davantage au CRM, a l'infrastructure et aux systemes d'orchestration.

## Contraintes non negociables

Avant toute intervention, respecter ces regles :

- Faire un plan avant les modifications. Le projet est sensible et l'utilisateur veut une approche entreprise.
- Ne pas reconstruire le projet.
- Ne pas remplacer l'architecture existante.
- Ne pas toucher a la logique neuronale du chatbot.
- Ne pas toucher a la logique Claude deja construite.
- Ne pas modifier la configuration LLM/Groq ni le modele choisi.
- Ne pas modifier le design du widget sans demande explicite.
- Ne pas modifier la logique de ciblage backend sans demande explicite.
- Ne pas changer les payloads CRM Airtable/Twenty sans verification et tests.
- Ne rien supprimer sans inventaire, justification, sauvegarde et validation explicite.
- Ne pas conclure qu'une feature manque seulement parce qu'elle n'est pas visible dans ce dossier.
- Ne pas prendre les erreurs locales comme preuve que le systeme global ne fonctionne pas.

L'utilisateur insiste : le chatbot repond, parle, est connecte, fonctionne tres bien, et a deja permis de customiser/deployer plusieurs chatbots via `/factory`.

Le travail attendu est principalement :

- optimisation ;
- verification qualite ;
- durcissement production ;
- securite ;
- deploiement entreprise ;
- infrastructure ;
- documentation ;
- robustesse sur plusieurs mois.

## Contexte donne par l'utilisateur

### Produit et vente

Le produit sera vendu a des entreprises via :

- prospection LinkedIn ;
- mailing ;
- prospection telephonique ;
- livraison/deploiement pour agences ou entreprises clientes.

### CRM et integrations

Les integrations importantes :

- Airtable via API key et webhooks ;
- Twenty CRM, deja capable de recevoir les donnees ;
- Cloudflare Worker ;
- VPS Ubuntu 16 GB RAM ;
- Docker sur VPS, a verifier.

Ne pas casser les flux deja fonctionnels.

### LLM

Le choix LLM est deja decide :

- Groq ;
- modele special deja valide par l'utilisateur ;
- configuration a ne pas changer.

La mission est de verifier que cette partie est deployable et robuste, pas de la remplacer.

## Dossiers et systemes mentionnes

### Workspace courant

Chemin courant connu :

```txt
D:\Chatbot - Copy
```

Ce dossier contient au moins une version du chatbot/widget/backend, mais il ne faut pas supposer qu'il contient tout le systeme.

### SYSTEM 2 VRAI

L'utilisateur mentionne un document ou dossier appele **SYSTEM 2 VRAI**.

Il semble porter la partie deploiement/factory/infrastructure. D'apres le contexte utilisateur, il decrit notamment une plateforme AAE, Auto-Action Engine, orientee automatisation human-in-the-loop.

Architecture annoncee pour SYSTEM 2 VRAI :

- backend Fastify / Node.js 20 / TypeScript ;
- frontend cockpit Next.js 14 ;
- PostgreSQL 16 ;
- Drizzle ORM ;
- Redis 7 + BullMQ 5 ;
- Documenso ;
- n8n self-hosted ;
- OpenTelemetry ;
- Prometheus ;
- Grafana ;
- Caddy ;
- multi-tenancy ;
- compliance gate RGPD ;
- validation humaine avant execution ;
- integrations Twenty CRM, Brevo/SMTP, Google Calendar, Documenso.

Important : si le code factory ou certains elements critiques ne sont pas dans `D:\Chatbot - Copy`, chercher SYSTEM 2 VRAI avant de conclure qu'ils manquent.

### Site vitrine

L'utilisateur mentionne aussi une partie vitrine separee, deja decidee par le responsable technique.

Chemin annonce :

```txt
c:\Users\LDO2026\Desktop\01_Mes_Projets\PROJET\PROJET\projet - 3 VRAI
```

Architecture annoncee :

- landing page B2B OracleSentinel ;
- Next.js 15.2.4 ;
- React 19.1.0 ;
- TypeScript strict ;
- Tailwind CSS 4.1.2 ;
- Lenis Smooth Scroll ;
- GSAP ;
- Framer Motion ;
- Three.js / React Three Fiber ;
- Zustand ;
- Axios ;
- NextAuth.js ;
- Biome 2.3.9 ;
- SEO metadata ;
- PostHog ;
- Headless UI.

Cette partie est fournie pour contexte global, pas forcement pour intervention immediate.

## Audit local deja realise dans D:\Chatbot - Copy

Ces constats concernent le dossier local uniquement. Ils ne doivent pas etre interpretes comme une preuve que le systeme global est absent ou casse.

Constats principaux :

- Le backend `server` build correctement avec `npm run build`.
- Le build frontend racine echoue actuellement car `factory-dashboard.html` reference `/src/factory-main.tsx`, fichier non trouve dans ce workspace.
- Le typecheck frontend racine signale plusieurs erreurs TypeScript, notamment imports versionnes de type `lucide-react@0.487.0`, Radix avec versions dans les imports, mismatch de types dans certains composants.
- `README.md` reference `server/.env.example`, mais ce fichier n'a pas ete trouve dans le workspace courant.
- Certains fichiers/configs contiennent des valeurs sensibles ou des mots de passe par defaut : ne pas les recopier dans des reponses publiques, et prevoir une revue secrets/env.
- Les routes admin semblent plus sensibles que les routes factory sur certains points de securite, notamment CSRF a verifier.
- `schema.sql` contient des operations destructrices de type `DROP TABLE`; toute initialisation DB doit etre traitee avec prudence.
- Un Dockerfile serveur semble pouvoir masquer une erreur TypeScript via un `|| true`; a verifier avant production.
- Le projet contient beaucoup de dossiers d'assistants/outils/copies. Ne pas nettoyer brutalement.

## Methode de travail attendue pour le prochain GPT

### Etape 0 - Lire avant d'agir

Lire ce fichier puis lire au minimum :

- `README.md`
- `docs/HANDOFF_FACTORY_V2.md` si present
- `package.json`
- `server/package.json`
- `server/src/index.ts`
- `server/src/routes`
- `server/src/middleware`
- `server/src/services`
- fichiers Docker / compose / deploy
- docs de deploiement

Chercher ensuite les references a SYSTEM 2 VRAI et aux dossiers VRAI :

```powershell
rg --files -g '!node_modules/**' | rg -i "system|vrai|handoff|factory|deploy"
```

Ne pas lancer de recherche destructive ou nettoyage global.

### Etape 1 - Faire un plan

Avant de modifier :

1. cartographier les dossiers reels ;
2. separer chatbot, factory, backend, CRM, infra, docs, site vitrine ;
3. lister les risques sans juger trop vite ;
4. proposer un plan de durcissement production ;
5. demander validation si les changements touchent le comportement.

### Etape 2 - Verification non destructive

Priorite aux commandes non destructrices :

```powershell
git status --short --branch
rg --files -g '!node_modules/**'
npm run build
npm run typecheck
npm run lint
```

Adapter selon les scripts disponibles. Si une commande risque de generer beaucoup de fichiers ou toucher au projet, l'annoncer avant.

### Etape 3 - Axes de production readiness

Travailler par phases :

- preservation : sauvegarde, inventaire, etat git ;
- build : frontend/backend/docker ;
- env : `.env.example`, validation des variables, separation secrets/config ;
- securite : rate limit, CSRF, auth admin, CORS, headers, secrets, logs sans PII ;
- CRM : Airtable/Twenty, tests de payload, retries, timeouts, idempotence ;
- infra : Docker, Cloudflare Worker, VPS Ubuntu, reverse proxy, healthchecks ;
- data : PostgreSQL, migrations non destructrices, backups, restore test ;
- observabilite : logs, Sentry/OTel si present, alerting, health endpoint ;
- performance : chargement widget, bundle, cache, latence API, timeouts LLM ;
- docs : runbook deploiement, rollback, checklist client ;
- tests : smoke tests non intrusifs, tests API critiques, tests integration CRM avec mocks.

## Ce qui est autorise

Sauf instruction contraire, sont pertinents :

- revue qualite ;
- corrections de build sans changer le comportement ;
- durcissement Docker/deploiement ;
- ajout de `.env.example` coherent ;
- ajout de documentation ;
- ajout de scripts de verification ;
- ajout de tests non invasifs ;
- amelioration de logging/healthcheck ;
- correction de failles evidentes si elles ne changent pas le flux produit ;
- optimisation de chargement et robustesse.

## Ce qui est interdit sans validation explicite

- Rebuild complet.
- Remplacement du modele LLM.
- Changement de provider LLM.
- Changement du prompt/cerveau du chatbot.
- Refonte design.
- Suppression de dossiers, docs, backups, anciennes versions.
- Migration destructive.
- Reformatage massif non necessaire.
- Changement du format envoye a Airtable/Twenty.
- Suppression de la factory parce qu'elle semble incomplete.
- Conclusion definitive sans chercher SYSTEM 2 VRAI.

## Premiere reponse ideale du prochain GPT

Le prochain GPT doit repondre dans cet esprit :

> J'ai lu le fichier de passation. Je vais commencer par cartographier le workspace et retrouver les documents SYSTEM 2 VRAI / factory avant toute modification. Je ne touche pas a la logique chatbot, au modele Groq, au design ou aux flux CRM sans validation. Je vais d'abord produire un plan de durcissement production base sur des verifications non destructrices.

Ensuite seulement, executer les recherches et construire le plan.

## Rappel final

L'utilisateur a plus de contexte que le contenu visible du dossier. Respecter cela.

Le bon comportement n'est pas de "tout reparer", mais de rendre livrable sans casser ce qui marche deja.

