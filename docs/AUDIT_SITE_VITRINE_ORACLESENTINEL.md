# PROMPT D'AUDIT & REFONTE — Site vitrine OracleSentinel (Next.js 15)

> Document à copier-coller tel quel à une autre IA (ex. Claude) qui n'a AUCUN contexte préalable.
> Il décrit le projet de A à Z, l'état réel du site aujourd'hui, et exactement quoi changer, par priorité.
> Rédigé après lecture directe du code source (lecture seule). Tout ce qui est affirmé ici a été vérifié dans les fichiers.

---

## 0. TON RÔLE ET TES RÈGLES

Tu es un ingénieur front-end senior (Next.js/React/TypeScript) doublé d'un copywriter B2B francophone. Mission : auditer puis refondre un site vitrine existant pour le rendre cohérent, crédible, conforme et réellement vendeur.

Règles impératives :
1. Langue : français. Cible française. Aucune section ne doit rester en anglais.
2. N'invente JAMAIS de chiffres, clients, témoignages, certifications ou logos. En France, afficher des résultats clients fictifs est une pratique commerciale trompeuse (risque DGCCRF). Si un chiffre n'est pas fourni et vérifiable, reformule de façon qualitative et honnête.
3. Pas de conseil juridique. Pour le DPE / loi Climat & Résilience, ajoute toujours une réserve « selon la réglementation en vigueur, à confirmer ADEME/Légifrance ».
4. Lis tout le code concerné avant de modifier. Ne propose pas de changement sur un fichier non lu.
5. Ne casse pas le design system existant (couleurs, typos, ambiance) — il est bon. Voir section 6.
6. Vérifie que `next build` passe après tes modifications.
7. Procède par priorité (P0 vers P3). Le P0 est bloquant, à faire quelle que soit la stratégie (section 3).
8. Si une décision dépend du propriétaire (identité légale, chiffres réels, choix stratégique), signale-le — n'invente pas.

---

## 1. LE PROJET (présentation depuis zéro)

- Entité : « OracleSentinel » (anciennement « TS Industry » dans d'anciens documents — voir incohérence de marque en P0). Fondateur SOLO : « Théo S. ».
- Nature : un site vitrine / landing page marketing. Ce n'est PAS l'application produit ; c'est le site qui doit vendre le produit et générer des rendez-vous.
- Objectif business : convertir un visiteur en rendez-vous qualifié (actuellement via un calendrier Cal.com sur la page /audit).

### Stack (vérifiée dans package.json)
- Next.js 15.2 (App Router), React 19, TypeScript 5, Tailwind CSS 4 (+ clsx, tailwind-merge), @headlessui/react.
- Animations : framer-motion, motion, gsap, aos, react-lenis (smooth scroll).
- Visuels lourds : three, @react-three/fiber + drei, three-globe, viewer Spline (script externe unpkg), effet « Lightning » WebGL, hls.js.
- Graphiques : recharts. Formulaires : react-hook-form + yup. Icônes : lucide-react, react-icons, @iconify/react.
- Analytics : posthog-js. next-auth présent mais non utilisé. Lint : Biome. Prise de RDV : widget Cal.com (calLink « oraclesentinel »).

### PIÈGE DE STRUCTURE À CONNAÎTRE ABSOLUMENT
Le vrai code n'est PAS à la racine. Il est imbriqué dans src/ qui contient lui-même un src/ :

```
<racine>/
 src/ (projet Next.js : package.json, next.config.mjs, public/, node_modules/)
 public/ (assets : images, vidéos, OracleSentinelLogo.png)
 src/ (LE VRAI CODE)
 app/ (App Router : pages, layout.tsx, globals.css, api/)
 components/ (CardNav, ui/, foundations/, portable-contact-form)
 data/ lib/ seo/ utils/ all-project-fonts/
```

- Lancer : se placer dans src/ (le dossier avec package.json), puis `npm install` et `npm run dev`. Build : `npm run build`.
- Alias `@/` = src/src/ (ex. @/app/components/... = src/src/app/components/...).
- Tous les chemins de ce document sont relatifs à src/src/ sauf mention contraire.

---

## 2. LE PRODUIT RÉELLEMENT VENDU AUJOURD'HUI (contexte indispensable)

Le site actuel vend un discours abstrait : « systèmes d'acquisition IA pour PME ». Or le produit concret a été recentré sur l'IMMOBILIER : un SaaS de chatbot multi-tenant pour AGENCES IMMOBILIÈRES, surnommé la « machine à mandats ». Capacités réelles :

- Estimation immobilière en ligne via chatbot/formulaire (le vendeur décrit son bien, puis estimation + capture du lead vendeur).
- Capture & qualification de leads vendeurs (prénom, téléphone, adresse, type de bien, chauffage...) envoyés à l'agence + CRM.
- Alerte « mandat chaud » : notification (cloche + e-mail) quand un vendeur à fort potentiel est détecté.
- Angle DPE 2026 / « fausse passoire » : message pédagogique sur l'impact du DPE et de la loi Climat sur la valeur d'un bien — TOUJOURS avec réserve légale.
- Récapitulatif mensuel anti-churn pour l'agence (stats de mandats captés). Notifications SMS optionnelles. Cas copropriété / DPE collectif.
- Un tableau de bord (« QG »), un CRM (basé sur Twenty CRM), et un widget embarquable à coller sur le site de l'agence.

> Conséquence : décalage MAJEUR entre ce que le site raconte (conseil IA générique) et ce que l'entreprise vend (capter des mandats pour agences immobilières). Traité en section 3.

---

## 3. LA DÉCISION STRATÉGIQUE N°1 (à trancher avant la refonte de fond)

Avant de réécrire le contenu, le propriétaire doit choisir cible et positionnement. Deux voies cohérentes :

### Voie A — Nicher sur l'immobilier (« la machine à mandats ») — RECOMMANDÉE
Parler directement aux directeurs et responsables d'agences immobilières.
- Hero type : « La machine à mandats pour agences immobilières. Transformez votre site en générateur de rendez-vous vendeurs, automatiquement. »
- Pourquoi : clarté immédiate (un gérant comprend en 3 secondes que c'est pour lui) ; vendabilité (un produit niché et concret se vend bien plus facilement qu'une promesse générique, surtout pour un fondateur solo sans expérience commerciale) ; honnêteté (on décrit le produit qui existe) ; SEO (requêtes immobilières précises plus atteignables que « acquisition IA »).

### Voie B — Rester un cabinet « acquisition IA » générique
Garder le positionnement actuel et ne faire que les corrections P0. À ne retenir que si le propriétaire vise explicitement plusieurs verticales ET a les preuves. Sinon, moins vendeur et moins honnête vis-à-vis du produit réel.

> Recommandation : Voie A. Ce document est organisé pour que le P0 soit valable dans les deux cas, et que le P1 (alignement immobilier) s'applique si la Voie A est retenue. Faire confirmer A ou B par le propriétaire avant le P1.

---

## 4. ÉTAT ACTUEL DU SITE — INVENTAIRE FACTUEL

### Design system (bon, à conserver)
- Couleurs : violet profond #281950 (fonds/hero/titres), orange #FF8963 vers #FF5A25 (CTA/accents), neutres clairs #F6F6F7 et #f3f4f6, footer noir.
- Typos : Instrument Serif (titres, autorité) + Outfit (corps). Sont aussi chargées Manrope, Oswald, Poppins (probablement en trop, voir perf).
- Ambiance : « cabinet premium », animations au scroll (AOS), effets de survol, visuels 3D.

### Navigation (components/CardNav.tsx, alimenté par app/components/Home/HeroV2/Header.tsx)
3 cartes dépliables + CTA « Candidater » vers /audit :
- Navigation : Accueil /, Pourquoi Nous /pourquoi-nous, FAQ /#faq.
- Services : AI Revenue Partner /ai-revenue-partner, Programmatic /programmatic, SEO IA /seo.
- Action : « Évaluer mon éligibilité » /audit, Documentation /docs, Oracle CRM /oracle.
- Deux autres composants de nav existent mais sont INUTILISÉS (Nav.tsx, HeaderMenu.tsx) et contiennent des liens morts.

### Page d'accueil (app/page.tsx)
Rend dans l'ordre : Hero, Aboutus, Dedicated, Digital, Beliefs, Work, Team, TechStack, UniverseGallery, FAQ, Join.
- Imports morts : Featured, Testimonial, Articles, Insta sont importés mais JAMAIS rendus, à supprimer.
- Hero : H1 « Des systèmes d'acquisition IA, conçus pour les PME. » ; CTA « Audit IA Gratuit » vers /audit et « Découvrir notre approche » vers /approche. Badge 5 étoiles « depuis 2021 » SANS aucun avis réel.
- Dedicated : viewer 3D Spline + citation « Les systèmes que nous construisons fonctionnent sans nous. — Théo S. ».
- Digital : « L'IA appliquée à l'acquisition. Pas au marketing de contenu. »
- Beliefs : « Nous construisons des systèmes, pas des campagnes. » (CTA vers /resultats).
- Work : « 30 à 60 Jours. » + effet Lightning WebGL. BUG : id="Team" alors que la vraie section Team utilise id="team" (collision d'ancre).
- Team : « L'expertise qui construit ce qui fonctionne. » mais n'affiche QU'UNE personne (Théo S.). Le sous-titre laisse croire à une équipe.
- TechStack : « Nos langages de programmation préférés » (Python/TS/JS/SQL), HORS-SUJET pour un acheteur B2B (parle au dev, pas au client).
- UniverseGallery : « Nos Univers Spécialisés » (Restaurant/Immobilier/Coach) vers /universe/*.html (pages probablement manquantes).
- FAQ (home) : titre EN ANGLAIS « Frequently asked questions. » (3 questions).
- Join (Joinus) : champs nom + e-mail NON câblés (pas de onSubmit) ; le bouton est un lien vers /audit. Téléphone « 06 18 03 41 35 ».

### Footer (app/components/Layout/Footer/index.tsx)
- Tagline « Intégrateur IA pour PME. » ; téléphone « 06 18 03 41 35 » ; AUCUN e-mail affiché.
- Réseaux : LinkedIn (theo-s-782851350), GitHub (onllytap), X (onllytap). Colonnes Navigation/Services/Ressources/Légal. Crédit « Fondateur Théo S. ».

### Pages (route, puis H1 actuel, puis note)
- /approche : « Une architecture d'acquisition. / Pas de magie. » (annonce « 4 phases » mais n'en montre que 3).
- /expertise : « Le pouvoir que vos concurrents n'ont pas. » (globe Three.js ; FAUX témoignage « Ils comprennent mon business mieux que moi. » ; typo « le leade »).
- /audit : « Audit IA pour PME. / Validez le potentiel. » (composant client, PAS de metadata ; widget Cal.com = SEULE capture qui marche).
- /oracle : « Plus qu'un CRM... » (souveraineté, « Chiffrement Militaire », ROI +40%/-15h/x3 ; CTA vers /contact qui N'EXISTE PAS ; src logo cassé /images/logo/three.js ; typo « Tallwind » ; pas de metadata).
- /ai-revenue-partner : « Votre pipeline de revenus, piloté par l'IA. » (CHIFFRES INVENTÉS « +40 entreprises », « ROI moyen x3.2 », 3 études de cas avec drapeaux).
- /programmatic : « Le programmatique ne devrait pas produire des pages... des opportunités commerciales. »
- /seo : QUASI-DOUBLON de /ai-revenue-partner (même H1), cannibalisation SEO (ironique pour une page « SEO ») ; pas de metadata.
- /company : ENTIÈREMENT EN ANGLAIS « Join a global team building the future of revenue systems. » ; prétend une ÉQUIPE SUR 3 CONTINENTS (San Francisco, New York, Toronto, Londres, Paris, Berlin, Amsterdam, Singapour, Tokyo, Dubaï), CONTREDIT le fondateur solo ; marque « AI Revenue Partner ».
- /pourquoi-nous : « Le problème n'est pas l'IA. / C'est ce que vous en faites. »
- /resultats : « Nos Résultats. » GRAPHIQUES ET CHIFFRES FABRIQUÉS EN DUR : +217% (CA 120k vers 380k EUR), +216% (leads 45 vers 142), précision 32% vers 73%, « Cabinet RH x3.2 », « PME BTP +210% », note « Revenu directement attribué aux pipelines OracleSentinel ». AUCUN client réel. Pas de metadata.
- /deploiement : « Architecture IA. » (des « langages » trainent des CITATIONS DE RECHERCHE résiduelles type « Source: Che IT Group... »).
- /faq : « Questions fréquentes. » (10 Q/R en FR, SOLIDES et honnêtes, + JSON-LD FAQPage = bon point ; mais dit « formulaire d'audit » alors que /audit est un calendrier).
- /docs : « Documentation Technique. OracleSentinel. » (révèle le produit : Oracle = CRM basé sur Twenty CRM ; Sentinel = widget IA multi-modèles ; pas de metadata).
- /documentation (route séparée app/(site)/documentation) : TITRE RÉSIDUEL DE TEMPLATE, metadata.title = "Featurs | Desgy".
- /mentions-legales : ne cite que l'hébergeur Vercel ; renvoie à un e-mail « plus haut » INEXISTANT ; PAS d'éditeur (raison sociale, SIRET, directeur de publication).
- /confidentialite : BOILERPLATE E-COMMERCE générique (« carte de crédit », « expédier une commande », « concours »), INADAPTÉ à une prestation SaaS/B2B.

### API & données
- SEULE route API : GET /api/data renvoie un JSON statique (headerData, Aboutdata, WorkData, PlansData, TestimonialsData, ArticlesData, FooterLinksData), NON consommé par le site rendu, et truffé de PLACEHOLDERS :
 - PlansData = tarifs d'un PLANIFICATEUR DE RÉSEAUX SOCIAUX (19/29/59 dollars, « Social Profiles », « Scheduled Posts ») = vestige de template.
 - TestimonialsData = 4 témoignages aux NOMS VIDES, note 5/5. ArticlesData = 6 FAUX articles de blog (pages inexistantes). WorkData = 6 membres SANS NOM. FooterLinksData = liens href vers /.
- AUCUNE route de capture de lead (POST). Les formulaires ne POSTent nulle part (voir P0-2).

### Formulaire de contact (components/portable-contact-form/index.tsx)
- Champs : nom complet, e-mail pro, site web, défi d'acquisition. Bouton « Confirmer la demande ».
- onSubmit ne fait que console.log + setTimeout 1,5s (commentaire « Simulated API Call ») puis affiche « Demande envoyée ! » : LE SUCCÈS EST FAUX, rien n'est envoyé.
- Affiche de FAUSSES certifications (SOC2 / RGPD / ISO 27001) et des LOGOS EMPRUNTÉS (type Mindvalley / Retool) comme preuve sociale. Composant probablement orphelin (/contactform n'a pas de page.tsx).

### SEO (état)
- app/layout.tsx : title « OracleSentinel », description « Intégrateur IA pour PME ». PAS de metadataBase, PAS d'openGraph, PAS de twitter, PAS de canonical, PAS d'image OG.
- metadata présent : home, /approche, /expertise, /deploiement, /faq, pages légales, /documentation (« Featurs | Desgy »), + via layout pour /ai-revenue-partner, /programmatic, /pourquoi-nous.
- MANQUANT (pages en composant client, retombent sur le titre générique) : /audit, /oracle, /resultats, /seo, /company, /docs. PAS de sitemap.ts, PAS de robots.ts.

### Performance (signaux)
- next/image bien utilisé (bon). Mais charge LOURDE : globe Three.js (/expertise), viewer Spline + script externe unpkg (home), effet Lightning WebGL (home), vidéos autoplay (/approche, /audit, /oracle, /docs), framer-motion + recharts + gsap + aos + Lenis + Preloader partout, 5 familles de polices Google.

---

## 5. CE QU'IL FAUT CHANGER — PAR PRIORITÉ

### P0 — CRÉDIBILITÉ, LÉGAL & TECHNIQUE BLOQUANT (à faire dans TOUS les cas)

P0-1. ÉLIMINER TOUT CONTENU FABRIQUÉ (priorité absolue).
- /resultats : supprimer ou remplacer TOUS les chiffres en dur (+217%, +216%, 32 vers 73%, x3.2, +210%, courbes mensuelles, « clients CA 1M-5M EUR »). Options honnêtes : (a) si le propriétaire a de VRAIS chiffres, les saisir + préciser source/période ; (b) sinon, transformer en explication QUALITATIVE de la méthode, ou retirer la page du menu.
- /expertise : retirer le faux témoignage « Ils comprennent mon business mieux que moi. ».
- portable-contact-form : retirer les FAUSSES certifications (SOC2/RGPD/ISO 27001) et les LOGOS clients empruntés.
- /ai-revenue-partner et /seo : retirer « +40 entreprises », « ROI moyen x3.2 » et les études de cas inventées.
- /company : supprimer le récit « équipe mondiale / 3 continents » (faux). Soit page « À propos » honnête (fondateur solo + vision), soit retirer la page.
- app/api/data/route.ts : purger les placeholders (faux articles, faux staff, faux témoignages, tarifs scheduler) ou supprimer la route si non utilisée.
- Badge home « 5 étoiles / depuis 2021 » : retirer les étoiles tant qu'il n'y a pas d'avis réels.
- Critère d'acceptation : plus AUCUN chiffre, logo, témoignage, certification ou effectif non vérifiable sur tout le site.

P0-2. RÉPARER LA CAPTURE DE LEADS (sinon le site ne sert à rien).
- Aujourd'hui SEUL le calendrier Cal.com de /audit fonctionne ; le formulaire de contact simule l'envoi ; le bloc Joinus n'est pas câblé.
- Choisir UNE stratégie et l'appliquer partout : (a) TOUT vers Cal.com (le plus simple, zéro back-end) en supprimant les faux formulaires ; OU (b) créer une VRAIE route POST /api/lead qui valide et envoie le lead (e-mail via Resend/Brevo et/ou push CRM), avec gestion d'erreur réelle, message de succès VRAI, anti-spam (honeypot + rate-limit) et consentement RGPD (case + lien politique).
- Câbler ou retirer le formulaire Joinus.
- Critère d'acceptation : tout CTA mène à une capture qui aboutit réellement (RDV pris OU lead reçu côté serveur), testé de bout en bout.

P0-3. PAGES LÉGALES CONFORMES (France).
- /confidentialite : RÉÉCRIRE une vraie politique RGPD pour une prestation SaaS/B2B (responsable de traitement, données réellement collectées via formulaire/RDV, finalités, base légale, durée de conservation, sous-traitants réels = Cal.com + hébergeur + e-mailing + CRM, droits RGPD + e-mail de contact). Supprimer tout vocabulaire e-commerce (« carte de crédit », « expédier une commande », « concours »).
- /mentions-legales : ajouter l'ÉDITEUR (dénomination/nom, statut, SIRET si existant, adresse, directeur de publication, e-mail), l'HÉBERGEUR (Vercel + coordonnées), la propriété intellectuelle. DEMANDER ces infos au propriétaire, ne pas inventer de SIRET.
- Critère d'acceptation : les deux pages reflètent l'activité réelle, avec un e-mail de contact qui existe.

P0-4. NETTOYER LES VESTIGES DE TEMPLATE.
- app/(site)/documentation/page.tsx : remplacer title "Featurs | Desgy" par un vrai titre. Décider de FUSIONNER /documentation et /docs (deux routes de doc concurrentes) en une seule.
- Retirer les imports morts de app/page.tsx (Featured, Testimonial, Articles, Insta).
- Retirer les composants de nav inutilisés (Nav.tsx, HeaderMenu.tsx) ou leurs liens morts.

P0-5. COHÉRENCE DE MARQUE, TÉLÉPHONE ET E-MAIL.
- UNE seule marque : choisir « OracleSentinel » (nom du logo et du domaine) et éliminer « AI Revenue Partner » et « TS Industry » des pages où ils traînent (/company, /ai-revenue-partner, /seo).
- Téléphone : conserver le VRAI « 06 18 03 41 35 » partout. (Un ancien numéro fictif « +33 1 23 45 67 89 » existe dans des configs externes : ne jamais l'afficher.)
- Afficher un E-MAIL DE CONTACT RÉEL (footer + pages légales). Aujourd'hui aucun e-mail visible.

P0-6. RÉPARER LES LIENS CASSÉS.
- /oracle : CTA vers /contact (route inexistante), rediriger vers /audit.
- UniverseGallery : liens vers /universe/*.html (pages absentes), créer les pages OU retirer les liens.
- Nav inutilisée : « Témoignages » vers ancre #testimonial-section cassée ; « Automation » et « Chatbots » sans href.
- app/api/data FooterLinksData : liens href vers /.
- Corriger la collision d'ancre : Work utilise id="Team" au lieu d'un id propre (ex. id="process").
- Corriger les typos : « le leade » (/expertise), « Tallwind » (/oracle), « Featurs » (/documentation), et les citations de recherche résiduelles dans /deploiement.

### P1 — ALIGNEMENT ÉDITORIAL IMMOBILIER (si Voie A retenue, section 3)

Objectif : que n'importe quel gérant d'agence immobilière comprenne en quelques secondes ce qu'il gagne. Conserver strictement le design system (section 6).

P1-1. Hero (home). Réécrire H1 + sous-titre + CTA pour l'immobilier (sans chiffre inventé). Direction possible :
- H1 : « La machine à mandats pour votre agence. »
- Sous-titre : « Un assistant qui estime les biens en ligne, qualifie les vendeurs et vous alerte des mandats à fort potentiel, 24h/24, depuis votre site. »
- CTA principal « Voir une démo » (ou « Réserver 15 min ») vers /audit ; CTA secondaire « Comment ça marche » vers /approche.

P1-2. Sections home. Réorienter AboutUs/portable-hero, Digital, Beliefs, Work, Team, FAQ vers les bénéfices agence (plus de mandats rentrés, moins d'estimations « curieux », réactivité sur les vendeurs chauds, image moderne). Remplacer TechStack (« nos langages préférés ») par une section orientée bénéfice client (« Ce que l'assistant fait pour vous »). UniverseGallery : assumer le multi-secteur OU recentrer sur l'immobilier (recommandé).

P1-3. Mettre en avant les VRAIES fonctionnalités (voir section 2), avec preuves de valeur honnêtes : estimation en ligne + capture vendeur ; alerte mandat chaud ; angle DPE (AVEC réserve légale systématique) ; récap mensuel ; widget embarquable ; tableau de bord.

P1-4. Pages. Adapter /approche (parcours visiteur vers estimation vers lead vendeur vers mandat vers RDV), /expertise (ce que sait faire l'assistant), /audit (« réservez une démo pour votre agence »), /oracle (le CRM/QG de l'agence). Aligner les metadata (titres/descriptions) sur le vocabulaire immobilier.

P1-5. FAQ. Adapter au gérant d'agence (intégration sur mon site ? mes données ? délai d'installation ? que voient mes vendeurs ? RGPD ?). Garder le JSON-LD.

### P2 — SEO
- app/layout.tsx : ajouter metadataBase = new URL(domaine réel), un bloc openGraph (titre, description, image, locale fr_FR, type website) et twitter (summary_large_image). Créer au moins une image OG par défaut.
- Convertir les pages "use client" qui ont besoin de metadata en composant serveur (extraire l'interactivité dans un sous-composant client) OU ajouter un layout.tsx exportant metadata pour : /audit, /oracle, /resultats, /seo, /company, /docs. Aujourd'hui elles retombent sur le titre générique.
- Créer app/sitemap.ts et app/robots.ts.
- Résoudre la cannibalisation /seo proche de /ai-revenue-partner : différencier réellement les deux, ou fusionner + redirection.
- Passer le titre de la FAQ home en français. Ajouter des alt descriptifs partout où ils manquent.

### P3 — PERFORMANCE & QUALITÉ DE CODE
- Alléger le poids visuel : charger en dynamic import (ssr:false) + lazy/intersection les éléments lourds (globe Three.js, viewer Spline + son script externe, effet Lightning WebGL). Évaluer s'ils valent leur coût (LCP/TBT).
- Vidéos autoplay : preload="none", poster, lancer seulement à l'entrée dans le viewport ; image de repli mobile.
- Polices : ne garder que celles utilisées (Instrument Serif + Outfit, et Manrope si c'est la police de corps) ; retirer Oswald/Poppins si inutiles.
- Supprimer le code mort (imports non rendus, composants nav inutilisés, route /api/data si non consommée, dossier data/ vide).
- Accessibilité de base : contrastes sur #281950, focus visibles, aria-label des boutons icônes, hiérarchie h1/h2.
- Lancer Biome (npm run lint) et corriger les avertissements introduits.

---

## 6. DESIGN SYSTEM À RESPECTER (ne pas casser)
- Palette : #281950 (violet profond), #FF8963 vers #FF5A25 (orange CTA), neutres clairs #F6F6F7 et #f3f4f6, footer noir.
- Typo : titres font-instrument (Instrument Serif), corps font-outfit (Outfit). Conserver l'association.
- CTA : boutons orange en dégradé avec ombrage interne (déjà stylés dans le Hero) ; arrondis généreux (rounded-2xl/3xl) ; cartes sobres.
- Animations : AOS (fade-up/down/left/right) déjà en place ; rester sobre et cohérent.
- Ton : « cabinet premium », direct, sans jargon inutile ni superlatifs creux. La page /faq actuelle est un bon étalon de ton honnête.

---

## 7. DEFINITION OF DONE (checklist de fin)
- [ ] `npm run build` passe sans erreur ; `npm run lint` propre sur les fichiers touchés.
- [ ] ZÉRO chiffre/logo/témoignage/certification/effectif fictif sur tout le site.
- [ ] Tous les CTA mènent à une capture FONCTIONNELLE (RDV ou lead serveur), testée.
- [ ] /confidentialite et /mentions-legales conformes et reflétant l'activité réelle (e-mail valide, éditeur renseigné par le propriétaire).
- [ ] 100% du contenu en français ; aucune page en anglais ; typos corrigées.
- [ ] Une seule marque cohérente ; téléphone + e-mail cohérents partout.
- [ ] Aucun lien cassé ; collision d'ancre Work/Team corrigée ; vestiges de template supprimés (« Featurs | Desgy », tarifs scheduler, faux articles).
- [ ] SEO de base : metadataBase + OpenGraph/Twitter + image OG, sitemap.ts, robots.ts, metadata sur les pages clés, cannibalisation /seo vs /ai-revenue-partner résolue.
- [ ] (Voie A) Le message « machine à mandats » est clair dès le Hero ; réserve légale DPE présente partout où le DPE est mentionné.
- [ ] Éléments lourds lazy-loadés ; polices inutiles retirées.

---

## 8. GARDE-FOUS (rappel final)
- N'invente rien. En cas de doute sur un chiffre, une identité légale, un témoignage : DEMANDE au propriétaire ou reformule sans l'affirmer.
- DPE / loi Climat : toujours une réserve « selon la réglementation en vigueur, à confirmer ADEME/Légifrance », jamais de conseil juridique.
- RGPD : tout formulaire = consentement explicite + lien politique de confidentialité + e-mail de contact.
- Teste le build ET les parcours de conversion avant de considérer la tâche terminée.
- Procède par priorité : livre d'abord un P0 complet (site honnête, fonctionnel, conforme) avant P1/P2/P3.

---

## Annexe — Démarrage rapide
```
# depuis la racine du dépôt
cd src
npm install
npm run dev (http://localhost:3000)
npm run build (build de production, à faire passer avant de livrer)
npm run lint (Biome)
```
Le code éditable est dans src/src/ (alias @/). Les assets (images, vidéos, logo) sont dans src/public/.
