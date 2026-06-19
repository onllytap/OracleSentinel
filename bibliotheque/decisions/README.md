# Architecture Decision Records (ADR) — Sentinel

Ce dossier consigne les **décisions d'architecture** proposées pour l'évolution de Sentinel.

## Convention

- Un ADR = une décision. Format : contexte → décision → conséquences.
- **Statut** : `Proposé` (en attente de validation), `Accepté`, `Rejeté`, `Remplacé par ADR-XXXX`.
- Tant qu'un ADR est `Proposé`, **aucune implémentation** n'est faite (conforme à la Phase 0 et au handoff : pas de changement de comportement sans validation).

## Index

| ADR | Titre | Statut |
|---|---|---|
| [ADR_0001](ADR_0001_evolution_qg_supervision_unifiee.md) | Évolution du QG vers une supervision unifiée | Accepté — étape 1 livrée |
| [ADR_0002](ADR_0002_gestion_distante_chatbots.md) | Gestion distante contrôlée des chatbots | Proposé |
| [ADR_0003](ADR_0003_defense_profondeur_multitenant_rls.md) | Défense en profondeur multi-tenant (RLS PostgreSQL) | Proposé |

## Garde-fous transverses (s'appliquent à tous les ADR)

- Ne pas modifier la logique LLM/Groq, le modèle, le design du widget, ni les payloads CRM.
- Ne rien supprimer sans inventaire + validation.
- Toute évolution est **incrémentale**, **réversible**, et **testée** avant livraison.
