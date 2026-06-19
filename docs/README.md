# docs/

Ce dossier ne duplique pas la documentation. La **source de vérité unique** du
projet est la bibliothèque :

➡️ [`../bibliotheque/README.md`](../bibliotheque/README.md) — index maître
(carte du code, audit, architecture, décisions, déploiement).

Pour démarrer (installation, commandes, variables d'environnement, surfaces du
QG), voir le [README racine](../README.md).

## Repères rapides

| Besoin | Où aller |
|---|---|
| Onboarding (stack, démarrage, env) | [README racine](../README.md) |
| Index complet de la documentation | [`bibliotheque/README.md`](../bibliotheque/README.md) |
| Contraintes à lire avant de modifier | [`bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md`](../bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md) |
| Écosystème (3 systèmes) | [`bibliotheque/audit/SYSTEM_MAP.md`](../bibliotheque/audit/SYSTEM_MAP.md) |
| Architecture réelle | [`bibliotheque/architecture/ARCHITECTURE.md`](../bibliotheque/architecture/ARCHITECTURE.md) |
| Décisions d'évolution (ADR) | [`bibliotheque/decisions/README.md`](../bibliotheque/decisions/README.md) |

> Pourquoi ce simple pointeur ? Pour éviter deux documentations divergentes.
> Toute nouvelle doc de fond va dans `bibliotheque/` ; `docs/` ne fait qu'y renvoyer.
