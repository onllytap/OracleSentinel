# Onboarding d'une nouvelle agence cliente

OracleSentinel déploie, pour chaque agence, un chatbot IA qui qualifie les leads et les pousse dans le CRM **propre à cette agence**. Tout est piloté depuis le **QG** (Command Center, page `/priv`) et facturé à l'abonnement.

Ce guide couvre l'intégration de bout en bout : informations à collecter, mise en service (provisioning), puis cycle de vie de l'agence.

---

## 1. Informations à collecter pour finaliser le contrat

À recueillir avant la mise en service. Ces données alimentent le registre clients du QG (raison sociale, SIREN, TVA, DPA...).

### Identité légale
- **Raison sociale**
- **Forme juridique** (SAS, SARL, SCI, agent commercial indépendant...)
- **SIREN / SIRET**
- **N° de TVA intracommunautaire**
- **Adresse du siège social**
- **Nom du représentant légal**

### Contact
- **Email de contact** (facturation + technique)
- **Téléphone de contact**
- **Nom de domaine du site web** (où le widget sera intégré)

### CRM cible
- **Type de CRM** : `Twenty`, `Airtable` ou **webhook générique**
- **Qui fournit les accès** (clé API / URL de webhook) et via quel canal sécurisé. Selon le provider :
  - **Twenty** : URL de l'API + clé API
  - **Airtable** : URL du webhook (automation)
  - **Webhook générique** : URL + secret optionnel + nom d'en-tête optionnel

### Conformité RGPD
- **Contact / DPO** de l'agence
- **Finalité** du traitement (qualification de prospects)
- **Durée de conservation** des données de leads
- Lien vers la politique de confidentialité de l'agence

> Les secrets CRM (clé API, URL de webhook) sont **chiffrés au repos (AES-256-GCM)**. Ils ne sont jamais réaffichés ni journalisés : l'interface n'expose qu'un indicateur de présence (`hasCredentials`), jamais la valeur.

---

## 2. Procédure de mise en service (pas-à-pas)

> Tout se fait depuis le **QG** (`/priv`), en mode super-admin (session admin requise).

### Étape 1 — Créer l'agence dans le QG
Provisionner l'agence (tenant) avec sa **raison sociale** et son **plan** (`starter` par défaut). Le système génère automatiquement :
- un **`tenant_id`** stable et unique (dérivé du nom) ;
- un **`widget_id`** unique (format `wgt_…`) ;
- un **snippet d'intégration** prêt à copier.

### Étape 2 — Récupérer le widget_id + le snippet d'intégration
Le QG renvoie un snippet du type :

```html
<!-- OracleSentinel chat widget — paste before </body> -->
<script src="https://api.oraclesentinel.com/embed?widget_id=wgt_xxxxxxxx" data-widget-id="wgt_xxxxxxxx" async></script>
<noscript>
  <iframe src="https://api.oraclesentinel.com/embed?widget_id=wgt_xxxxxxxx" title="Assistant" loading="lazy" style="border:0;width:100%;height:600px"></iframe>
</noscript>
```

### Étape 3 — Coller le snippet sur le site de l'agence
Coller le snippet **juste avant `</body>`** sur les pages où le chatbot doit apparaître. Aucune autre dépendance n'est requise : chargement `async`, repli `<noscript>` via iframe si JavaScript est désactivé.

### Étape 4 — Configurer le CRM de l'agence
Depuis le QG, renseigner le CRM de l'agence : provider (`twenty` / `airtable` / `webhook`), activation, mapping des champs (`firstName`, `lastName`, `phone`, `email`, `need`, `qualification`, `notes`) et secrets.
- **Ne jamais exposer la clé** : elle est saisie une seule fois, chiffrée immédiatement, et n'est plus jamais réaffichée.
- Si aucun CRM n'est configuré ou activé, le lead suit le chemin de push global par défaut (aucune perte).

### Étape 5 — Tester
- Lancer le **test de connexion CRM** depuis le QG (résultat OK / échec, sans aucun secret en clair).
- Ouvrir le site de l'agence, démarrer une conversation, qualifier un lead de test et vérifier qu'il **arrive bien dans le CRM de l'agence**.

### Checklist de mise en service
- [ ] Agence créée dans le QG (tenant_id + widget_id)
- [ ] Snippet collé avant `</body>` sur le site
- [ ] CRM configuré (provider + mapping + secrets chiffrés)
- [ ] Test de connexion CRM OK
- [ ] Lead de test reçu côté agence
- [ ] Informations légales + RGPD enregistrées

---

## 3. Cycle de vie d'une agence

Chaque agence porte un statut, modifiable à tout moment depuis le QG :

| Statut | Effet |
| --- | --- |
| **active** | Le chatbot fonctionne normalement et sert les visiteurs. |
| **suspended** | Le bot est **coupé** (ex. impayé, demande de l'agence). Réversible : repasser en `active` réactive le service. |
| **archived** | Agence retirée du service ; le bot ne répond plus. |

> `suspended` et `archived` **coupent le service du bot**. À l'inverse, une agence inconnue ou un incident technique transitoire laisse le service ouvert (principe « fail-open ») pour ne jamais casser un bot en production par erreur.
