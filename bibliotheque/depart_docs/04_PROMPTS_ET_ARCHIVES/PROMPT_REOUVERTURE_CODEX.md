# PROMPT DE REOUVERTURE CODEX - OracleSentinel / Sentinel

Copie-colle ce prompt dans une nouvelle conversation Codex quand tu rouvres le projet sans aucun contexte.

---

Tu es Codex et tu arrives dans un projet sans aucun contexte precedent.

Avant toute commande, analyse, modification ou conclusion, lis imperativement ces fichiers dans cet ordre :

1. `CHATGPT_LIS_ABSOLUMENT.md`
2. `_handoff/CHATGPT_LIS_ABSOLUMENT.md`
3. `README.md` si present
4. `docs/HANDOFF_FACTORY_V2.md` si present

Contexte general :

Le projet s'appelle **OracleSentinel / Sentinel**.

Le but produit est de vendre aux agences immobilieres et entreprises un chatbot widget tres design qui resout la prospection manuelle de leads. Le widget discute avec les prospects, qualifie leurs besoins, aide a closer ou pre-closer le lead, collecte les donnees importantes, puis renvoie les informations vers le CRM de l'entreprise cliente.

Important sur le naming :

- **Sentinel** = le chatbot/widget et l'experience lead.
- **Oracle** = la partie CRM, infrastructure, orchestration et systemes entreprise.
- La marque globale reste **OracleSentinel**.

Contraintes absolues :

- Ne reconstruis pas le projet.
- Ne remplace pas l'architecture.
- Ne supprime rien sans validation explicite.
- Ne fais aucun nettoyage agressif : c'est une backup d'entreprise sensible, probablement la derniere.
- Ne touche pas a la logique neuronale du chatbot.
- Ne touche pas a la logique Claude deja construite.
- Ne change pas le modele LLM ni la configuration Groq.
- Ne modifie pas le design du widget sans demande explicite.
- Ne modifie pas la logique de ciblage backend sans demande explicite.
- Ne change pas les payloads CRM Airtable/Twenty sans tests et validation.
- Ne conclus pas qu'une feature est absente seulement parce qu'elle n'est pas visible dans le dossier courant.

Ce que l'utilisateur attend :

L'utilisateur ne veut pas une refonte. Il veut une preparation production ready prudente :

- verification qualite ;
- optimisation ;
- durcissement securite ;
- robustesse deploiement ;
- verification Docker/VPS/Cloudflare Worker ;
- documentation ;
- prevention des bugs de versioning ;
- assurance que le code peut tenir plusieurs mois sans casser.

Etat fonctionnel annonce par l'utilisateur :

- Le chatbot repond et parle correctement.
- Les connexions fonctionnent.
- Le systeme de customization via `/factory` a deja permis de deployer plusieurs chatbots.
- Airtable fonctionne via API key et webhooks.
- Twenty CRM recoit deja les donnees.
- Groq avec un modele special est deja choisi et valide.
- Le deploiement cible est Cloudflare Worker + VPS Ubuntu 16 GB RAM.
- Docker sur VPS est prevu/a confirmer.

Attention importante :

Le workspace courant peut ne pas contenir tout le projet. L'utilisateur mentionne d'autres systemes/dossiers, notamment :

- **SYSTEM 2 VRAI** : document/dossier de deploiement, factory et infrastructure.
- **projet - 3 VRAI** : site vitrine OracleSentinel.

Ne juge donc pas le projet uniquement depuis le dossier local.

Le systeme **SYSTEM 2 VRAI** est decrit comme une architecture entreprise type AAE, Auto-Action Engine, avec :

- Fastify / Node.js / TypeScript ;
- Next.js ;
- PostgreSQL ;
- Drizzle ORM ;
- Redis / BullMQ ;
- Documenso ;
- n8n ;
- OpenTelemetry ;
- Prometheus / Grafana ;
- Caddy ;
- multi-tenancy ;
- compliance gate RGPD ;
- validation humaine avant execution ;
- integrations CRM et automatisations.

Le site vitrine **projet - 3 VRAI** est decrit comme :

- Next.js 15 ;
- React 19 ;
- TypeScript strict ;
- Tailwind CSS 4 ;
- Lenis ;
- GSAP ;
- Framer Motion ;
- Three.js / React Three Fiber ;
- Zustand ;
- Axios ;
- NextAuth ;
- Biome ;
- SEO ;
- PostHog ;
- Headless UI.

Ta premiere mission :

1. Lire les fichiers de passation.
2. Cartographier prudemment le workspace.
3. Retrouver les references a SYSTEM 2 VRAI, factory, deploy, VPS, Cloudflare, Docker.
4. Ne rien modifier tant que tu n'as pas compris les limites du projet.
5. Produire un plan de production readiness avant toute modification importante.

Commandes de depart conseillees, non destructrices :

```powershell
git status --short --branch
rg --files -g '!node_modules/**'
rg -n -i "system 2 vrai|system|vrai|factory|deploy|cloudflare|worker|docker|vps|twenty|airtable|groq" -g '!node_modules/**'
```

Si tu dois faire des modifications :

- elles doivent etre chirurgicales ;
- elles doivent etre expliquees avant ;
- elles ne doivent pas casser le comportement existant ;
- elles doivent privilegier docs, env examples, verification, scripts de smoke test, securite, Docker, CI, robustesse ;
- elles ne doivent jamais toucher au cerveau du chatbot sans ordre explicite.

Plan attendu :

Phase 0 - Preservation :

- verifier etat git ;
- identifier les dossiers critiques ;
- ne rien supprimer ;
- lister les risques.

Phase 1 - Cartographie :

- separer chatbot, backend, factory, CRM, infra, site vitrine, docs ;
- trouver SYSTEM 2 VRAI ;
- comprendre ce qui est dans le workspace et ce qui est externe.

Phase 2 - Verification :

- build backend ;
- build frontend si pertinent ;
- typecheck ;
- verifier Docker ;
- verifier env ;
- verifier routes sensibles ;
- verifier CRM sans casser les payloads.

Phase 3 - Production readiness :

- secrets et `.env.example` ;
- CORS/auth/CSRF/rate limit ;
- logs sans donnees sensibles ;
- healthchecks ;
- timeouts/retries ;
- migrations non destructrices ;
- backup/restore ;
- deploiement VPS/Cloudflare Worker ;
- documentation de runbook.

Phase 4 - Validation :

- smoke tests ;
- checklist pre-deploiement ;
- checklist rollback ;
- rapport clair de ce qui est pret, fragile, ou a valider avec l'utilisateur.

Style de collaboration attendu :

- Parle en francais.
- Sois prudent, senior, et tres concret.
- Ne sois pas celui qui casse une backup qui marche.
- Ne fais pas de grandes theories avant d'avoir lu les fichiers.
- Si tu vois un probleme, distingue clairement :
  - ce qui est prouve dans le dossier courant ;
  - ce qui est une hypothese ;
  - ce qui peut etre dans un autre dossier.

Commence maintenant par confirmer que tu vas lire les fichiers de passation, puis execute uniquement des commandes de lecture/cartographie non destructrices.

---

