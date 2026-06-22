# Tarification OracleSentinel

Facturation **par agence et par mois**. Trois plans, alignés sur le volume d'activité du chatbot : messages, leads qualifiés, conversations.

| Plan | Prix /agence/mois | Pour qui |
| --- | --- | --- |
| **Starter** | **99 €** | Agence indépendante, démarrage |
| **Pro** | **299 €** | Agence active, volume régulier |
| **Scale** | **799 €** | Réseau / fort volume multi-sites |

---

## Détail des plans

### Starter — 99 €/mois
Quotas indicatifs (par mois) :
- ~5 000 messages
- ~200 leads
- ~1 000 conversations

Inclus :
- 1 chatbot dédié à l'agence
- CRM propre à l'agence (Twenty / Airtable / webhook), configuration chiffrée
- Branding de base (nom de l'agent, couleurs)
- Support standard (email)

### Pro — 299 €/mois
Quotas indicatifs (par mois) :
- ~20 000 messages
- ~1 000 leads
- ~5 000 conversations

Inclus : tout le plan Starter, plus :
- Branding avancé + personnalisation de la personnalité du bot
- Support prioritaire

### Scale — 799 €/mois
Quotas indicatifs (par mois) :
- ~100 000 messages
- ~5 000 leads
- ~25 000 conversations

Inclus : tout le plan Pro, plus :
- Volumes élevés, multi-sites
- Support dédié

---

## Facturation & quotas

- **Stripe optionnel** : la facturation est **désactivable** (drapeau `BILLING_ENABLED`). Désactivée, elle est totalement inerte — aucun comptage d'usage, **aucun blocage** de quota. Le chatbot fonctionne sans contrainte de facturation.
- **Quotas configurables** : prix et quotas (messages / leads / conversations) sont paramétrables par plan. Un quota fixé à `0` vaut **illimité**.
- **Comptage mensuel** : l'usage est mesuré par mois calendaire, par agence.
- **Abonnements Stripe** : quand la facturation est active, le statut d'abonnement (active, trialing, past_due, canceled...) est synchronisé via un webhook Stripe sécurisé.

> Les montants et quotas ci-dessus sont des **valeurs par défaut indicatives**. Ils peuvent être ajustés par agence selon le contrat.
