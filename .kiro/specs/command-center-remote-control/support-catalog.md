# Catalogue de remédiation à distance — Support client (50 scénarios)

> Base de connaissances qui pilote le **Panel de Support & Remédiation** du Command Center.
> Chaque entrée : la question telle qu'un patron d'agence (non technique) la poserait →
> la cause réelle → l'action que l'opérateur déclenche **à distance** depuis le panel →
> le **niveau de confiance** de l'auto-fix → l'escalade si ce n'est pas sûr.
>
> Niveaux de confiance :
> - **AUTO** : remédiation sûre, réversible, applicable en 1 clic (re-scan/validation automatique après).
> - **GUIDÉ** : le panel propose le correctif, l'opérateur valide une valeur avant d'appliquer.
> - **ESCALADE** : pas d'auto-fix fiable → diagnostic fourni + ticket/escalade technique.
>
> Toute action passe par : session admin + CSRF, journal d'audit, et re-vérification après application.

---

## A. Le bot ne répond pas / est lent

**1. « Mon chatbot ne répond plus du tout à mes clients ! »**
- Cause : bot en erreur (clé LLM expirée/quota), ou service injoignable.
- Action panel : healthcheck du bot → si LLM en échec, bascule sur la clé/fournisseur de secours → relance à chaud → re-test d'un message.
- Confiance : **AUTO** (si fournisseur de secours dispo) sinon **GUIDÉ**.
- Escalade : si tous les fournisseurs LLM sont down → incident infra.

**2. « Le bot met 30 secondes à répondre, c'est trop lent. »**
- Cause : latence LLM élevée, modèle trop lourd, ou pas de cache.
- Action panel : afficher latence mesurée → proposer un modèle plus rapide → activer le cache de réponses → re-mesurer.
- Confiance : **GUIDÉ** (changement de modèle = validation).
- Escalade : latence réseau persistante côté fournisseur.

**3. « Le bot répond une fois sur deux. »**
- Cause : rate-limit atteint, ou timeouts intermittents.
- Action panel : vérifier compteurs rate-limit du tenant → relever le quota du tenant → vérifier les timeouts.
- Confiance : **AUTO**.
- Escalade : instabilité fournisseur.

**4. « Depuis ce matin il est tombé en panne. »**
- Cause : déploiement récent / config cassée.
- Action panel : voir l'historique de déploiement du bot → **rollback** vers la dernière version saine.
- Confiance : **AUTO** (rollback réversible).
- Escalade : si la version saine échoue aussi.

**5. « Le bot affiche une erreur rouge sur mon site. »**
- Cause : widget ne joint pas l'API (auth widget / domaine non autorisé).
- Action panel : vérifier le mapping widget→tenant et les origines autorisées → ajouter le domaine du client → re-test.
- Confiance : **GUIDÉ** (on confirme le domaine).
- Escalade : problème DNS côté client.

---

## B. Réponses incorrectes / mauvais comportement

**6. « Le bot raconte n'importe quoi / invente des biens. »**
- Cause : prompt trop permissif, pas d'ancrage sur le catalogue (hallucination).
- Action panel : renforcer le prompt (garde-fous anti-invention) → forcer l'ancrage catalogue → re-test sur questions types.
- Confiance : **GUIDÉ** (édition de prompt validée).
- Escalade : qualité de données catalogue insuffisante.

**7. « Il donne des prix qui ne sont plus à jour. »**
- Cause : catalogue pas réimporté récemment.
- Action panel : lancer une réimportation du catalogue du tenant → comparer avant/après.
- Confiance : **AUTO**.
- Escalade : flux XML source du client cassé.

**8. « Il propose des biens déjà vendus. »**
- Cause : statut « retiré/vendu » non synchronisé.
- Action panel : réimport + filtre statut → purge des biens retirés.
- Confiance : **AUTO**.
- Escalade : statuts absents dans le flux source.

**9. « Il ne comprend pas les questions sur les charges/surfaces. »**
- Cause : champs catalogue mal mappés.
- Action panel : afficher le mapping des champs → corriger le mapping → re-test.
- Confiance : **GUIDÉ**.
- Escalade : champ absent du flux.

**10. « Le bot est trop insistant / pas assez commercial. »**
- Cause : ton/température mal réglés.
- Action panel : ajuster ton + température dans la config tenant → aperçu → déployer.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

---

## C. Catalogue de biens

**11. « J'ai ajouté des annonces mais le bot ne les connaît pas. »**
- Cause : pas de réimport depuis l'ajout.
- Action panel : déclencher l'import (dry-run puis commit) → afficher nombre de biens vus/ajoutés.
- Confiance : **AUTO**.
- Escalade : URL de flux invalide.

**12. « Toutes mes annonces ont disparu du bot. »**
- Cause : import en échec a vidé/écrasé, ou mauvais tenant.
- Action panel : voir le dernier import (erreurs) → rollback de l'import → réimport propre.
- Confiance : **GUIDÉ**.
- Escalade : flux source vide.

**13. « Les photos ne s'affichent pas dans les réponses. »**
- Cause : URLs photos absentes/expirées dans le flux.
- Action panel : vérifier le champ photos sur un échantillon → signaler les biens sans photo.
- Confiance : **ESCALADE** (dépend des données client).
- Escalade : corriger le flux côté client.

**14. « Je veux que le bot ne montre que les biens à vendre, pas en location. »**
- Cause : pas de filtre transaction.
- Action panel : appliquer un filtre transaction au tenant → re-test.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**15. « Mon import dure des heures / ne finit jamais. »**
- Cause : flux volumineux ou bloqué.
- Action panel : voir l'état du job d'import → annuler le job bloqué → relancer en mode incrémental.
- Confiance : **AUTO**.
- Escalade : taille de flux hors limites.

---

## D. Leads & CRM

**16. « Je ne reçois plus les coordonnées des clients (leads). »**
- Cause : connecteur CRM désactivé ou clé expirée.
- Action panel : tester la connexion CRM (Twenty) → réactiver le connecteur → renvoyer les leads en attente.
- Confiance : **GUIDÉ** (clé à confirmer).
- Escalade : CRM client indisponible.

**17. « Les leads n'arrivent pas dans mon CRM Twenty. »**
- Cause : URL/API Twenty mal configurée ou score minimum trop haut.
- Action panel : vérifier la config CRM → baisser le seuil de score → rejouer l'envoi.
- Confiance : **GUIDÉ**.
- Escalade : schéma Twenty incompatible.

**18. « J'ai des leads en double dans le CRM. »**
- Cause : pas de déduplication par email/téléphone.
- Action panel : activer la déduplication → fusionner les doublons récents.
- Confiance : **AUTO**.
- Escalade : aucune.

**19. « Le bot ne demande jamais le numéro de téléphone. »**
- Cause : étape de qualification désactivée.
- Action panel : activer la collecte téléphone dans la qualification → re-test du parcours.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**20. « Je veux être prévenu par email à chaque nouveau lead. »**
- Cause : notifications email non activées.
- Action panel : activer l'email de lead + saisir l'adresse → envoyer un email de test.
- Confiance : **AUTO**.
- Escalade : SMTP en échec.

---

## E. Apparence & intégration sur le site

**21. « Le chatbot n'apparaît pas sur mon site. »**
- Cause : script d'intégration absent ou domaine non autorisé.
- Action panel : régénérer le code d'intégration → autoriser le domaine → fournir la procédure de collage.
- Confiance : **GUIDÉ**.
- Escalade : accès au site géré par un tiers.

**22. « Les couleurs du bot ne vont pas avec mon site. »**
- Cause : thème par défaut.
- Action panel : régler couleur primaire/fond/texte → aperçu live → appliquer.
- Confiance : **AUTO**.
- Escalade : aucune.

**23. « La bulle est au mauvais endroit / cache un bouton. »**
- Cause : position du widget.
- Action panel : changer la position (coin/offset) → appliquer.
- Confiance : **AUTO**.
- Escalade : conflit CSS spécifique au site.

**24. « Je veux mon logo et le nom de mon agence dans le bot. »**
- Cause : branding non personnalisé.
- Action panel : définir nom agent + logo → aperçu → déployer.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**25. « Le bot s'ouvre tout seul et dérange mes visiteurs. »**
- Cause : auto-ouverture activée.
- Action panel : désactiver l'auto-open / régler le délai → appliquer.
- Confiance : **AUTO**.
- Escalade : aucune.

---

## F. Langue & ton

**26. « Le bot répond en anglais à des clients français. »**
- Cause : langue par défaut/détection.
- Action panel : forcer la langue FR du tenant → re-test.
- Confiance : **AUTO**.
- Escalade : aucune.

**27. « Il tutoie les clients, je veux du vouvoiement. »**
- Cause : ton informel.
- Action panel : régler le ton (formel) dans la config → aperçu → déployer.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**28. « Le bot utilise du jargon que les clients ne comprennent pas. »**
- Cause : prompt trop technique.
- Action panel : ajuster le prompt (langage simple) → re-test.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**29. « Je veux qu'il gère aussi l'arabe / l'espagnol. »**
- Cause : multi-langue non activé.
- Action panel : activer la détection multi-langue → re-test.
- Confiance : **GUIDÉ**.
- Escalade : qualité variable selon langue.

**30. « Le bot se présente avec le mauvais nom d'agence. »**
- Cause : nom d'agent obsolète.
- Action panel : corriger le nom dans la config tenant → déployer.
- Confiance : **AUTO**.
- Escalade : aucune.

---

## G. Horaires & disponibilité

**31. « Je ne veux pas que le bot réponde la nuit. »**
- Cause : pas de plage horaire configurée.
- Action panel : définir les horaires d'activité du tenant + message hors-horaire → appliquer.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**32. « Pendant les vacances, je veux un message d'absence. »**
- Cause : pas de mode absence.
- Action panel : activer le mode absence avec dates + message → appliquer.
- Confiance : **AUTO**.
- Escalade : aucune.

**33. « Le bot doit dire quand l'agence est ouverte. »**
- Cause : horaires d'agence absents de la base de connaissances.
- Action panel : saisir les horaires d'agence → re-test.
- Confiance : **AUTO**.
- Escalade : aucune.

**34. « Je veux transférer vers un humain à certaines heures. »**
- Cause : pas de règle de transfert.
- Action panel : configurer la bascule vers contact humain (email/tel) selon horaires.
- Confiance : **GUIDÉ**.
- Escalade : intégration téléphonie externe.

**35. « Le bot a répondu un jour férié alors que c'était fermé. »**
- Cause : jours fériés non pris en compte.
- Action panel : ajouter les jours fériés à la plage d'indisponibilité.
- Confiance : **AUTO**.
- Escalade : aucune.

---

## H. Notifications & emails

**36. « Je ne reçois aucun email du système. »**
- Cause : SMTP (Brevo) en échec ou adresse erronée.
- Action panel : tester le SMTP → corriger l'adresse destinataire → email de test.
- Confiance : **GUIDÉ**.
- Escalade : compte Brevo bloqué.

**37. « Les emails de leads finissent dans les spams. »**
- Cause : expéditeur/domaine non aligné (SPF/DKIM).
- Action panel : afficher l'expéditeur configuré → recommander l'alignement de domaine.
- Confiance : **ESCALADE** (DNS côté client).
- Escalade : configuration DNS du domaine client.

**38. « Je reçois trop de notifications. »**
- Cause : notif sur chaque message au lieu des leads qualifiés.
- Action panel : régler le seuil de notification (leads qualifiés uniquement).
- Confiance : **AUTO**.
- Escalade : aucune.

**39. « Je veux ajouter un collègue en copie des leads. »**
- Cause : un seul destinataire.
- Action panel : ajouter une adresse en copie → email de test.
- Confiance : **AUTO**.
- Escalade : aucune.

**40. « Le récapitulatif de conversation dans l'email est vide. »**
- Cause : génération du résumé désactivée.
- Action panel : activer le résumé de conversation → renvoyer un exemple.
- Confiance : **AUTO**.
- Escalade : aucune.

---

## I. Accès, compte & sécurité

**41. « J'ai oublié comment accéder à mon espace. »**
- Cause : procédure d'accès oubliée (non technique).
- Action panel : renvoyer la procédure d'accès + lien (sans jamais divulguer de secret).
- Confiance : **AUTO**.
- Escalade : aucune.

**42. « Je pense que quelqu'un d'autre a accédé à mes données. »**
- Cause : accès suspect.
- Action panel : consulter le journal d'audit du tenant → révoquer les sessions → forcer une rotation de clé.
- Confiance : **GUIDÉ**.
- Escalade : incident sécurité → procédure dédiée.

**43. « Un client demande la suppression de ses données (RGPD). »**
- Cause : demande de droit à l'effacement.
- Action panel : rechercher le lead par email/tel → supprimer ses données (lead + messages) → confirmation.
- Confiance : **GUIDÉ** (action irréversible, double confirmation).
- Escalade : aucune.

**44. « Je veux exporter toutes mes conversations et leads. »**
- Cause : besoin d'export.
- Action panel : générer un export CSV des leads/conversations du tenant.
- Confiance : **AUTO**.
- Escalade : aucune.

**45. « Désactivez temporairement mon bot, je refais mon site. »**
- Cause : mise en pause volontaire.
- Action panel : suspendre le bot du tenant (le widget affiche indisponible) → réactivation en 1 clic.
- Confiance : **AUTO** (réversible).
- Escalade : aucune.

---

## J. Compte, facturation & divers

**46. « J'ai changé le nom/les coordonnées de mon agence. »**
- Cause : infos agence obsolètes.
- Action panel : mettre à jour les infos du tenant → déployer.
- Confiance : **AUTO**.
- Escalade : aucune.

**47. « Combien de messages mon bot a-t-il traités ce mois-ci ? »**
- Cause : besoin de reporting.
- Action panel : afficher les métriques du tenant (messages, leads, taux de conversion) sur la période.
- Confiance : **AUTO** (lecture seule).
- Escalade : aucune.

**48. « Mon bot marchait mieux avant votre dernière mise à jour. »**
- Cause : régression après changement de config.
- Action panel : comparer les versions de config → rollback vers la version précédente.
- Confiance : **AUTO**.
- Escalade : aucune.

**49. « Je veux que le bot pose une question de qualification en plus. »**
- Cause : parcours de qualification à enrichir.
- Action panel : ajouter une étape de qualification → aperçu du parcours → déployer.
- Confiance : **GUIDÉ**.
- Escalade : aucune.

**50. « Rien ne marche, je n'y comprends rien, réglez tout ! »**
- Cause : client non technique, problème non identifié.
- Action panel : lancer le **diagnostic complet** du tenant (LLM, DB, catalogue, CRM, SMTP, widget) → liste priorisée des problèmes détectés → appliquer les correctifs AUTO → escalader le reste avec un rapport clair.
- Confiance : **AUTO** pour le diagnostic + les correctifs sûrs ; **ESCALADE** pour le reste.
- Escalade : rapport de diagnostic joint au ticket.

---

## Synthèse pour le panel

Le **Panel de Support & Remédiation** se construit à partir de ce catalogue :

1. **Recherche/sélection du problème** (par mots-clés du patron, en langage naturel) → entrée du catalogue.
2. **Diagnostic ciblé** : le panel lance les checks liés à l'entrée (réutilise `/api/priv/infra`, `/api/factory/test/*`, métriques tenant).
3. **Action de remédiation** : bouton qui exécute l'action distante (la plupart = capacités de contrôle par-tenant du présent spec : éditer config, réimporter, relancer, rollback…).
4. **Re-vérification automatique** après application + entrée au journal d'audit.
5. **Confiance & escalade** : AUTO appliqué directement, GUIDÉ demande une valeur, ESCALADE produit un rapport de diagnostic.

> Note d'honnêteté : ce panel **maximise** le taux de résolution à distance et garantit qu'aucune situation ne reste sans diagnostic ni piste — il ne « répare pas tout magiquement ». Les cas hors de notre périmètre (DNS client, flux source cassé, compte fournisseur bloqué) sont détectés, expliqués et escaladés proprement.
