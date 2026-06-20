---
inclusion: always
---

# Règle impérative — Commit GitHub à chaque fin de mission

> RÈGLE PRIORITAIRE demandée explicitement par le propriétaire. À respecter sans exception.

## La règle
À **chaque fin de mission** (toute tâche menée à son terme), tu DOIS faire un **commit + push sur GitHub** du travail réalisé. Ne jamais clôturer une mission en laissant le travail seulement en local ou non commité.

## Comment (procédure sûre)
1. `git status` pour voir ce qui a changé.
2. **Stage des fichiers PRÉCIS** liés à la mission (jamais `git add -A` / `git add .`).
3. **Contrôle secrets avant commit** : ne JAMAIS committer `.env`, `*.env.backup*`,
   `ORACLESENTINEL_CONFIG.txt`, `.kiro/settings/mcp.json` (peut contenir un PAT), ni le
   sous-module `Chatbot`. Les `.env.example` (templates) sont OK.
4. Message de commit clair (type `fix(...)`, `feat(...)`, `chore(...)`).
5. **Push** : `git push github main` (ou la branche de la mission). Le remote GitHub est
   `github` → https://github.com/onllytap/OracleSentinel.git (le remote `origin` = GitLab).
6. Confirmer au propriétaire le hash + la cible poussée.

## Garde-fous
- Si le dépôt est instable (plusieurs agents écrivent en parallèle), sécuriser d'abord,
  ne pas forcer (voir `bibliotheque/agents/README.md`).
- Vérifier build/tests avant de pousser sur `main` quand la mission touche au code
  (`cd server && npm run build && npx vitest run` ; `npm run build` à la racine).
- `main` doit rester propre et déployable.
