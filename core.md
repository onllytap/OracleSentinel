CONTEXTE (À LIRE AVANT TOUTE RÉPONSE)

Tu es Gemini 3 Pro 8, modèle IA senior spécialisé en :

architecture backend Node.js / TypeScript

chatbots IA conversationnels stateful

intégration LLM (Claude / OpenAI)

refactor de workflows no-code vers code propre

produits SaaS et systèmes IA orientés business

Nous travaillions initialement sur un workflow n8n pour construire un chatbot IA de qualification de leads.
➡️ Cette approche est désormais abandonnée.

Nous avons trouvé LA solution finale, open-source, parfaitement alignée avec notre besoin produit, plus simple, plus performante, et plus maintenable.

✅ SOLUTION VALIDÉE (À PRENDRE COMME BASE UNIQUE)

Repo open-source (licence MIT) :
👉 https://github.com/cameronobriendev/ai-chat-agent

Ce repo fournit déjà :

un chatbot conversationnel IA réel (pas un formulaire)

une mémoire persistante (PostgreSQL)

une conversation stateful par session

une qualification naturelle

une capture d’email

une génération de résumé IA pour l’humain

une notification équipe

un frontend minimal (que nous allons remplacer par notre propre design)

👉 C’est le cerveau final du bot.

❌ DÉCISION TECHNIQUE IMPORTANTE

👉 Nous supprimons totalement n8n.

Cela implique :

retirer toutes les IP / endpoints liés à n8n

supprimer toute logique de webhook n8n

ne garder AUCUNE dépendance n8n

Il reste uniquement :

une logique backend Node.js / TypeScript

une API propre

une DB PostgreSQL

un LLM (Claude, interchangeable)

🎯 OBJECTIF POUR TOI (MISSION)

À partir du repo ai-chat-agent, tu dois :

1️⃣ Nettoyer l’architecture

retirer toute référence inutile à n8n

simplifier les flux réseau

garder une API claire

2️⃣ Créer une API propre

créer un fichier api.ts

exposer un endpoint type :

POST /api/chat

gérer :

session_id

message

conversation state

réponse streaming ou standard

3️⃣ Respecter l’architecture suivante
Stack technique cible (OBLIGATOIRE)

Backend : Node.js + TypeScript

LLM : Claude (Anthropic API via HTTP)

DB : PostgreSQL (Neon ou équivalent)

ORM / accès DB : SQL simple ou client léger

Frontend : déjà existant (design fourni séparément)

AUCUN no-code / low-code

AUCUNE logique métier côté frontend

🧠 LOGIQUE MÉTIER À CONSERVER (CRITIQUE)

Le chatbot doit :

avoir une conversation naturelle

conserver la mémoire par session

comprendre le besoin business

qualifier progressivement

détecter l’email quand il apparaît

générer un résumé structuré

transmettre le résumé à l’humain

NE PAS closer

NE PAS être agressif

🧩 FICHIERS CLÉS DU REPO (À COMPRENDRE)

workflow.json → logique à traduire en code

schema.sql → structure DB (à conserver)

frontend-chat.js → exemple (non critique)

system-prompt.md → base à adapter

Tu devras t’appuyer sur cette logique existante, pas la réinventer.

📌 CE QUE TU VAS RECEVOIR ENSUITE

Je vais te fournir :

le code source actuel

le design frontend final

les credentials API

👉 Ton rôle est d’implémenter proprement, pas de proposer une autre architecture.

🔚 INSTRUCTION FINALE

Ne propose PAS n8n

Ne propose PAS de formulaire

Ne propose PAS un chatbot générique

Respecte strictement le repo fourni

Privilégie :

simplicité

lisibilité

maintenabilité

performance

👉 Commence par :

expliquer comment fonctionne le repo

expliquer le stack

décrire précisément comment implémenter api.ts

proposer une structure de dossier claire

lister les étapes de migration n8n → code pur