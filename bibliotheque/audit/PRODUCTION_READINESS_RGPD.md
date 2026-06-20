# PRODUCTION_READINESS & RGPD — Sentinel (chemin vers « produit fini »)

> Objectif : un produit **vendable** et **légalement défendable**. On manipule de la PII de
> prospects immobiliers (nom, téléphone, email, besoins) **+ le contenu des conversations**.
> ⚠️ Ce document liste des mesures **techniques** (que je peux implémenter) et des items
> **juridiques** qui nécessitent une **revue par un avocat / DPO** — je ne donne pas de conseil
> juridique, je signale et j'outille.

Date : 2026-06-20.

---

## 1. Ce qui est déjà solide (acquis sur `main`)

- **Sécurité applicative** : JWT widget (origin+scope+tenant), session admin HttpOnly + CSRF +
  `SameSite=Strict`, rate-limit persistant, garde SSRF, en-têtes (CSP/X-Frame), comparaisons
  temps constant, masquage des secrets, allowlist IP admin (option), durcissement TLS DB (option).
- **Isolation multi-tenant** : filtrage `tenant_id` partout (+ RLS PostgreSQL dispo, flag off).
- **Exploitation** : Sentry (erreurs), logs `pino` structurés + redaction PII, healthchecks, Docker non-root.
- **Qualité** : 174 tests, CI (verte en local ; le rouge GitHub = blocage **facturation Actions**, pas le code).

---

## 2. RGPD — exposition réelle (le risque « prison »)

| # | Sujet | État | Qui |
|---|---|---|---|
| G1 | **Consentement + mention de confidentialité** au point de capture du lead (le widget collecte email/téléphone) | ❌ À ajouter (case de consentement + lien politique de confidentialité avant envoi CRM) | Tech + juridique |
| G2 | **Transfert de PII hors UE** : le contenu des conversations (PII saisie par le prospect) part vers **Groq (US)** ; CRM **Airtable (US)** ; Sentry (UE ✅). Transfert US = base légale + SCC + information requises | ❌ Risque majeur à cadrer | Juridique + tech |
| G3 | **Minimisation** : ne pas envoyer plus de PII que nécessaire au LLM ; envisager **redaction PII avant Groq** ou un LLM UE | ❌ À implémenter | Tech |
| G4 | **Droit à l'effacement** (art. 17) : suppression par personne (pas seulement par tenant) | ⏳ À vérifier/compléter (`DELETE /api/admin/db/lead/:id`) | Tech |
| G5 | **Droit d'accès / portabilité** (art. 15/20) : export des données d'une personne | ❌ À implémenter (endpoint export) | Tech |
| G6 | **Rétention** : purge auto des conversations/leads après N mois (sinon conservés indéfiniment) | ❌ À implémenter (job de purge) | Tech + juridique (durée) |
| G7 | **Registre des traitements** + liste des **sous-traitants** (Groq, Neon, Airtable/Twenty, Sentry) | ❌ À produire | Juridique |
| G8 | **DPA** (accord de sous-traitance) avec chaque agence cliente (tu es sous-traitant de leurs leads) | ❌ Modèle à faire | Juridique |
| G9 | **Politique de confidentialité** + mentions légales (pages publiques) | ❌ À rédiger | Juridique |
| G10 | **Notification de violation** (process) + journal d'accès admin (audit) | ⏳ Partiel (logs) | Tech + process |

**Le point le plus chaud = G1 + G2 + G6** : capter de la PII sans consentement/mention, l'envoyer
à un LLM US sans cadre de transfert, et la garder sans limite. C'est exactement ce qui expose à une
sanction RGPD (jusqu'à 4 % du CA). À traiter en priorité.

---

## 3. Production-ready (technique) — gaps restants

- **CI** : débloquer la facturation GitHub Actions (ou héberger les checks ailleurs).
- **Sauvegardes/DR** de la base (Neon : vérifier backups + PITR).
- **Rétention/rotation** des `.env.backup.*` + secrets en coffre (déjà cadré, script dry-run fourni).
- **Dépendances** : 2 vulns *moderate* (postcss/next côté root) à nettoyer.
- **Sentry par app** : projet distinct Sentinel ≠ System 2 (aujourd'hui mélangés dans `javascript-nextjs`).
- **Charge** : test de montée en charge pour 350 agences (rate-limit, pool DB).
- **Uptime monitoring** + alerting.

---

## 4. Roadmap proposée vers « produit fini »

**Lot 1 — Conformité PII (priorité « pas de prison »)** *(technique, je peux le faire)*
1. **Consentement widget** (G1) : case + lien politique de confidentialité, horodatage du consentement stocké avec le lead.
2. **Rétention** (G6) : job de purge configurable (`DATA_RETENTION_DAYS`) sur conversations/messages/leads.
3. **Droits des personnes** (G4/G5) : endpoints admin **export** + **effacement** par email/téléphone, audités.
4. **Minimisation LLM** (G3) : option de redaction PII avant envoi à Groq.

**Lot 2 — Cadre légal** *(nécessite avocat/DPO — je fournis les gabarits techniques)*
5. Gabarits : politique de confidentialité, registre des traitements, liste sous-traitants, modèle DPA. **À faire valider juridiquement.**
6. Décision **transfert US** (G2) : SCC + information, ou bascule LLM/CRM UE.

**Lot 3 — Durcissement prod**
7. Débloquer CI, nettoyer vulns, Sentry par app, sauvegardes, test de charge.

---

## 5. Limite de responsabilité
Les items « juridique » (G7-G9, DPA, transfert US) doivent être **validés par un professionnel du
droit / DPO**. Je fournis l'implémentation technique et les gabarits, pas un avis juridique.
