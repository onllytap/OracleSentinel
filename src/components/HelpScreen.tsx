import React, { useState } from 'react';
import { Search, ChevronRight, ChevronDown, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ArticleModal } from './ArticleModal';

interface HelpScreenProps {
  onBack?: () => void;
}

const articleContents: Record<string, string> = {
  'Featurebase overview': `Découvrez Featurebase :

Featurebase est notre plateforme complète pour gérer vos retours clients et votre roadmap produit.

🎯 Fonctionnalités principales :
- Collecte de feedback utilisateur
- Gestion de roadmap publique
- Système de votes et commentaires
- Intégrations multiples

📊 Avantages :
- Centralisation des retours
- Priorisation intelligente
- Communication transparente
- Engagement utilisateurs

Démarrez dès maintenant et transformez vos retours clients en actions concrètes !`,

  'Explore demos': `Explorez nos démos interactives :

🎬 Démos disponibles :

1. Chatbot IA en action
   - Conversation intelligente
   - Qualification de leads
   - Prise de rendez-vous

2. Automatisation de processus
   - Workflows intelligents
   - Intégrations API
   - Analyses en temps réel

3. Analyse de données
   - Tableaux de bord
   - Rapports personnalisés
   - Prédictions IA

💡 Chaque démo est interactive et vous permet de tester nos solutions en conditions réelles.

Réservez une démo personnalisée avec nos experts !`,

  'Inbox overview': `Vue d'ensemble de la messagerie :

📬 Inbox unifié :
Notre système de messagerie centralisé pour gérer toutes vos conversations clients.

✨ Fonctionnalités :
- Messages en temps réel
- Historique complet
- Réponses automatiques
- Assignation d'équipe
- Tags et filtres
- Recherche avancée

🤖 Intelligence intégrée :
- Détection d'intention
- Suggestions de réponses
- Analyse de sentiment
- Escalade automatique

📊 Analytics :
- Temps de réponse
- Satisfaction client
- Volume de messages
- Performance équipe

Optimisez votre support client avec notre Inbox intelligent !`,

  'Comment créer un compte': `Pour créer votre compte Cabinet IA :

1. Rendez-vous sur notre page d'inscription
2. Remplissez vos informations (nom, email, entreprise)
3. Vérifiez votre email
4. Connectez-vous avec vos identifiants

Votre compte sera activé immédiatement et vous pourrez accéder à toutes nos fonctionnalités IA.`,

  'Configuration initiale': `Après la création de votre compte :

1. Complétez votre profil entreprise
2. Configurez vos préférences
3. Intégrez vos premiers outils
4. Invitez votre équipe

Notre assistant vous guidera pas à pas dans cette configuration.`,

  'Premiers pas avec l\'IA': `Découvrez nos solutions IA :

• Chatbots intelligents
• Automatisation de processus
• Analyse de données
• Génération de contenu

Nos experts sont disponibles pour vous accompagner dans la mise en place de votre premier projet IA.`,

  'Guide de démarrage rapide': `En 5 minutes, démarrez avec Cabinet IA :

1. Créez votre compte
2. Sélectionnez votre offre (Starter/Growth/Premium)
3. Configurez votre premier projet
4. Testez nos outils IA
5. Planifiez avec un expert

C'est aussi simple que ça !`,

  'Formations disponibles': `Nos formations en IA :

📚 Formation de base (2h)
- Introduction à l'IA
- Cas d'usage concrets
- Premiers projets

🎓 Formation avancée (1 jour)
- Deep Learning
- NLP & Computer Vision
- Déploiement en production

👨‍💼 Formation executive (3h)
- Stratégie IA
- ROI et KPIs
- Gouvernance

Toutes nos formations sont certifiantes.`,

  'Certifications': `Obtenez vos certifications Cabinet IA :

🏆 Certification Praticien IA
- Niveau : Débutant
- Durée : 20h
- Examen en ligne

🏆 Certification Expert IA
- Niveau : Avancé
- Durée : 40h
- Projet final

🏆 Certification Architecte IA
- Niveau : Expert
- Durée : 60h
- Cas d'étude complet

Valorisez vos compétences !`,

  'Tutoriels vidéo': `Accédez à notre bibliothèque vidéo :

📹 +50 tutoriels disponibles
- Vidéos courtes (5-10min)
- Cas pratiques
- Tips & tricks

Nouveaux tutoriels chaque semaine !`,

  'Soumettre un feedback': `Partagez vos idées et suggestions :

💡 Comment soumettre un feedback :
1. Décrivez votre idée
2. Ajoutez des détails et captures d'écran
3. Sélectionnez une catégorie
4. Soumettez votre suggestion

🎯 Ce que nous recherchons :
- Nouvelles fonctionnalités
- Améliorations UX
- Corrections de bugs
- Optimisations

Votre voix compte ! Chaque feedback est examiné par notre équipe produit.`,

  'Voir la roadmap produit': `Découvrez notre feuille de route :

🗺️ Roadmap publique :
Suivez l'évolution de notre produit en temps réel.

📅 Trimestre actuel :
- Amélioration du chatbot IA
- Nouvelles intégrations
- Dashboard analytics

📈 Prochains trimestres :
- API publique v2
- Mode multi-agents
- Analyses prédictives avancées

Votez pour les fonctionnalités que vous souhaitez voir en priorité !`,

  'Voter pour des fonctionnalités': `Influencez notre roadmap :

🗳️ Comment voter :
1. Parcourez les suggestions
2. Cliquez sur les fonctionnalités qui vous intéressent
3. Votez et commentez
4. Suivez les mises à jour

⭐ Vos votes nous aident à :
- Prioriser le développement
- Comprendre vos besoins
- Aligner le produit avec vos attentes

Participez à la construction du futur de Cabinet IA !`,

  'Contacter le support': `Besoin d'aide ? Nous sommes là :

📞 Canaux de support :
- Chat en direct (9h-18h)
- Email : support@cabinetia.com
- Téléphone : +33 1 23 45 67 89
- Ticket support (24/7)

⚡ Temps de réponse :
- Chat : < 2 minutes
- Email : < 4 heures
- Ticket : < 24 heures

Notre équipe d'experts est prête à vous aider !`,

  'FAQ générale': `Questions fréquemment posées :

❓ Les plus populaires :

Q: Comment démarrer rapidement ?
R: Suivez notre guide de démarrage rapide en 5 minutes.

Q: Quelles sont les options de tarification ?
R: Nous offrons 3 plans : Starter, Growth et Premium.

Q: Puis-je migrer mes données ?
R: Oui, nous proposons un service de migration gratuit.

Q: Le support est-il inclus ?
R: Support inclus dans tous les plans.

Q: Y a-t-il une période d'essai ?
R: Oui, 14 jours gratuits, sans carte bancaire.`,

  'Résolution de problèmes': `Guide de dépannage :

🔧 Problèmes courants :

1. Le chatbot ne répond pas
   → Vérifiez votre connexion
   → Rafraîchissez la page
   → Videz le cache

2. Problème de connexion
   → Vérifiez vos identifiants
   → Réinitialisez votre mot de passe
   → Contactez le support

3. Erreur d'intégration
   → Vérifiez les permissions
   → Régénérez les clés API
   → Consultez la documentation

📧 Si le problème persiste, contactez notre support technique.`,

  'Documentation complète': `Documentation technique complète :

📚 Ressources disponibles :

- Guide d'installation
- API Reference
- Tutoriels pas à pas
- Exemples de code
- Best practices
- Changelog

🔗 Formats disponibles :
- Documentation en ligne
- PDF téléchargeable
- Vidéos tutoriels

Tout ce dont vous avez besoin pour maîtriser Cabinet IA !`,

  'Guides utilisateur': `Guides détaillés pour tous les niveaux :

👥 Par rôle :
- Guide Administrateur
- Guide Utilisateur
- Guide Développeur
- Guide Manager

📖 Par fonctionnalité :
- Chatbot IA
- Analytics
- Intégrations
- Automatisation

Progressez à votre rythme avec nos guides structurés !`,

  'API Reference': `Documentation API complète :

🔌 API Cabinet IA v1.0

Endpoints principaux :
- /api/chat - Gestion conversations
- /api/leads - Qualification leads
- /api/analytics - Données analytiques
- /api/integrations - Intégrations tierces

🔑 Authentification :
- API Key (Bearer token)
- OAuth 2.0
- JWT

📊 Rate limiting :
- 1000 requêtes/heure (Starter)
- 5000 requêtes/heure (Growth)
- Illimité (Premium)

Exemples de code en Python, JavaScript, PHP disponibles.`,
};

const helpSections = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Best steps on getting started with Featurebase.',
    articles: 10,
    items: [
      'Featurebase overview',
      'Explore demos',
      'Inbox overview',
      'Comment créer un compte',
      'Configuration initiale',
      'Premiers pas avec l\'IA',
      'Guide de démarrage rapide',
    ]
  },
  {
    id: 'academy',
    title: 'Academy',
    description: 'Get familiar with Featurebase',
    articles: 5,
    items: [
      'Formations disponibles',
      'Certifications',
      'Tutoriels vidéo',
    ]
  },
  {
    id: 'feedback',
    title: 'Feedback & Roadmaps',
    description: 'Set up your Feedback Portal & Roadmaps to collect feedback and show users what you\'re...',
    articles: 71,
    items: [
      'Soumettre un feedback',
      'Voir la roadmap produit',
      'Voter pour des fonctionnalités',
    ]
  },
  {
    id: 'support',
    title: 'Support Platform',
    description: 'Support your customers from anywhere with a unified Inbox and automate support with powerf...',
    articles: 53,
    items: [
      'Contacter le support',
      'FAQ générale',
      'Résolution de problèmes',
    ]
  },
  {
    id: 'help-center',
    title: 'Help Center',
    description: 'Toutes les ressources pour vous aider',
    articles: 32,
    items: [
      'Documentation complète',
      'Guides utilisateur',
      'API Reference',
    ]
  },
];

export function HelpScreen({ onBack }: HelpScreenProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<{ title: string; content: string } | null>(null);

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

  const handleArticleClick = (title: string) => {
    const content = articleContents[title] || `Contenu de l'article "${title}".\n\nCet article contient des informations détaillées sur le sujet. Notre équipe d'experts a préparé ce guide pour vous aider à mieux comprendre et utiliser nos services.`;
    setSelectedArticle({ title, content });
  };

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A] overflow-hidden">
      {/* Header with Back Button */}
      <div className="bg-gradient-to-b from-[#5B4FDE] to-[#7C6FE8] px-5 py-6 pb-8">
        <div className="flex items-center justify-between mb-4">
          {onBack && (
            <button
              onClick={onBack}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}
          <h1 className="text-white text-2xl flex-1 text-center">Help</h1>
          <div className="w-9"></div> {/* Spacer for centering */}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for help..."
            className="w-full bg-white/20 backdrop-blur-sm text-white placeholder-white/60 rounded-xl pl-11 pr-4 py-3 outline-none border border-white/30 focus:border-white/50 transition-colors"
          />
        </div>
      </div>

      {/* Help Sections */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {helpSections.map((section) => (
          <div key={section.id} className="border-b border-gray-800">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full px-5 py-4 text-left hover:bg-white/5 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h3 className="text-white text-base mb-1">{section.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed mb-1.5">
                    {section.description}
                  </p>
                  <p className="text-gray-500 text-xs">{section.articles} articles</p>
                </div>
                <div className="pt-1">
                  {expandedSection === section.id ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>
            </button>

            {/* Dropdown Content */}
            <AnimatePresence>
              {expandedSection === section.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden bg-[#0F0F0F]"
                >
                  <div className="px-5 py-3 space-y-2">
                    {section.items.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleArticleClick(item)}
                        className="w-full text-left px-4 py-2.5 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* Article Modal */}
      <ArticleModal
        isOpen={!!selectedArticle}
        onClose={() => setSelectedArticle(null)}
        title={selectedArticle?.title || ''}
        content={selectedArticle?.content || ''}
      />
    </div>
  );
}