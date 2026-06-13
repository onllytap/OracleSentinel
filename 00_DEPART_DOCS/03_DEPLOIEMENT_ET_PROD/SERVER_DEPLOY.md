# 🚀 AI Agent Factory — Guide de Déploiement

> **Pour agences IA** : Ce guide vous permet de déployer un agent IA configuré
> et personnalisé en production en moins de 15 minutes.

---

## Table des Matières

1. [Prérequis](#1-prérequis)
2. [Déploiement Local (Dev)](#2-déploiement-local-dev)
3. [Déploiement Docker (Production)](#3-déploiement-docker-production)
4. [Déploiement Cloud (VPS / VM)](#4-déploiement-cloud-vps--vm)
5. [Configuration de l'Agent](#5-configuration-de-lagent)
6. [Sécurité Production](#6-sécurité-production)
7. [Monitoring & Maintenance](#7-monitoring--maintenance)
8. [Troubleshooting](#8-troubleshooting)
9. [Architecture Résumée](#9-architecture-résumée)

---

## 1. Prérequis

| Composant        | Version Min. | Obligatoire | Notes                                |
|------------------|-------------|-------------|--------------------------------------|
| Node.js          | 18+         | ✅          | 20 LTS recommandé                   |
| PostgreSQL       | 14+         | ✅          | 16 recommandé                       |
| Docker           | 24+         | ⬜          | Seulement pour déploiement Docker    |
| Docker Compose   | 2.20+       | ⬜          | Inclus avec Docker Desktop           |
| Git              | 2.30+       | ✅          | Pour cloner le repo                  |

### Clés API nécessaires (au moins une)

- **Groq** — [console.groq.com](https://console.groq.com) (gratuit, recommandé pour démarrer)
- **OpenRouter** — [openrouter.ai](https://openrouter.ai) (multi-modèle)
- **OpenAI** — [platform.openai.com](https://platform.openai.com)
- **Anthropic** — [console.anthropic.com](https://console.anthropic.com)

### Optionnel

- **Twenty CRM** — Pour la synchronisation CRM automatique
- **Airtable** — Alternative CRM via webhooks
- **Slack** — Pour les notifications de build

---

## 2. Déploiement Local (Dev)

### 2.1 Cloner et installer

```bash
git clone <votre-repo> chatbot
cd chatbot/server
npm install
```

### 2.2 Configurer l'environnement

```bash
# Copier le template de configuration
cp .env.example .env

# Créer le fichier de secrets (JAMAIS commité)
cp .env.example .env.secrets
```

Éditez `.env.secrets` avec vos vraies clés API :

```env
# Obligatoire : Au moins une clé LLM
GROQ_API_KEY=gsk_votre_vraie_cle_ici
GROQ_API_KEY_1=gsk_deuxieme_cle_optionnelle

# Obligatoire : Secret JWT (générez-en un unique)
JWT_SECRET=votre_secret_jwt_64_caracteres_hex

# Obligatoire : Clé admin pour accéder au Factory
ADMIN_API_KEY=votre_cle_admin_secrete

# Obligatoire : URL de la base de données
DATABASE_URL=postgres://postgres:votre_mot_de_passe@localhost:5432/chatbot

# Optionnel : OpenRouter
OPENROUTER_API_KEY=sk-or-v1-votre_cle

# Optionnel : CRM Twenty
TWENTY_API_KEY=votre_cle_twenty_crm

# Optionnel : Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Optionnel : Airtable
AIRTABLE_WEBHOOK_URL=https://hooks.airtable.com/workflows/...
```

### 2.3 Préparer la base de données

```bash
# Créer la base de données PostgreSQL (si pas encore fait)
createdb chatbot

# Initialiser le schéma
npm run ensure-db
npm run init-db
```

### 2.4 Lancer le serveur

```bash
# Mode développement (hot-reload)
npm run dev

# Le serveur démarre sur http://localhost:3001
# Le Factory UI est accessible sur http://localhost:3001/factory
```

### 2.5 Vérifier que tout fonctionne

```bash
# Health check
curl http://localhost:3001/health

# Smoke test complet (lance le serveur, teste tout, arrête)
npm run factory:smoke

# Smoke test avec CRM activé
npm run factory:smoke:full
```

---

## 3. Déploiement Docker (Production)

> **Recommandé** pour la production. Un seul `docker compose up` et tout tourne.

### 3.1 Préparer l'environnement

```bash
cd server

# Copier le template
cp .env.example .env

# Éditer .env avec vos valeurs réelles
# IMPORTANT : Remplacez TOUS les placeholders <...>
nano .env
```

**Variables critiques à configurer dans `.env` :**

```env
# Base de données (Docker gère PostgreSQL automatiquement)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=un_mot_de_passe_fort_ici
POSTGRES_DB=chatbot

# Pas besoin de DATABASE_URL — docker-compose l'override automatiquement

# LLM (au moins une clé)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_votre_vraie_cle

# Sécurité
JWT_SECRET=generez_un_hex_64_chars
ADMIN_API_KEY=generez_un_hex_32_chars
NODE_ENV=production

# Domaine (pour CORS et cookies)
WIDGET_ALLOWED_ORIGINS=https://votre-site.com,https://www.votre-site.com
```

> **Astuce — Générer des secrets sécurisés :**
> ```bash
> # JWT Secret (64 caractères hex)
> openssl rand -hex 32
>
> # Admin API Key (32 caractères hex)
> openssl rand -hex 16
> ```

### 3.2 Builder et lancer

```bash
# Builder l'image et démarrer tout le stack
docker compose up -d --build

# Vérifier que tout tourne
docker compose ps

# Voir les logs
docker compose logs -f factory

# Vérifier la santé
curl http://localhost:3001/health
```

### 3.3 Accéder au Factory

Ouvrez votre navigateur :

- **Factory UI** : `http://votre-serveur:3001/factory`
- **Widget Embed** : `http://votre-serveur:3001/embed?widget_id=default`
- **Health Check** : `http://votre-serveur:3001/health`

Connectez-vous avec votre `ADMIN_API_KEY`.

### 3.4 Commandes Docker utiles

```bash
# Arrêter tout
docker compose down

# Arrêter + supprimer les données (reset complet)
docker compose down -v

# Rebuilder après modification du code
docker compose up -d --build

# Voir les logs en temps réel
docker compose logs -f factory

# Entrer dans le container
docker compose exec factory sh

# Backup de la base de données
docker compose exec postgres pg_dump -U postgres chatbot > backup.sql
```

---

## 4. Déploiement Cloud (VPS / VM)

### Option A : Docker sur VPS (Recommandé)

Fonctionne sur n'importe quel VPS (Hetzner, OVH, DigitalOcean, AWS EC2, etc.)

```bash
# 1. Se connecter au VPS
ssh user@votre-serveur

# 2. Installer Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Déconnectez-vous et reconnectez-vous

# 3. Cloner le repo
git clone <votre-repo> chatbot
cd chatbot/server

# 4. Configurer (voir section 3.1)
cp .env.example .env
nano .env

# 5. Lancer
docker compose up -d --build
```

### Option B : Node.js natif avec PM2

```bash
# 1. Installer Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Installer PM2
sudo npm install -g pm2

# 3. Installer PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createuser --superuser $USER
createdb chatbot

# 4. Configurer
cd chatbot/server
npm install
npm run build
cp .env.example .env
nano .env

# 5. Lancer avec PM2
pm2 start dist/index.js --name agent-factory
pm2 save
pm2 startup  # Redémarrage automatique au boot
```

### Reverse Proxy (Nginx)

Configuration recommandée pour HTTPS :

```nginx
server {
    listen 80;
    server_name factory.votre-domaine.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name factory.votre-domaine.com;

    ssl_certificate /etc/letsencrypt/live/factory.votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/factory.votre-domaine.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }

    # Allow embedding widget in iframes from any origin
    location /embed {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Override X-Frame-Options for embed route
        proxy_hide_header X-Frame-Options;
    }
}
```

Installer le certificat SSL avec Let's Encrypt :

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d factory.votre-domaine.com
```

---

## 5. Configuration de l'Agent

### 5.1 Via le Factory UI (Recommandé)

1. Ouvrez `http://votre-serveur:3001/factory`
2. Connectez-vous avec votre `ADMIN_API_KEY`
3. Configurez chaque section dans la sidebar :

| Section | Ce que vous configurez |
|---------|----------------------|
| **Identity** | Nom de l'agent, nom de l'agence, couleurs, logo |
| **Personality** | Style d'écriture, ton, langue, prompts systèmes |
| **LLM Provider** | Fournisseur IA, modèle, clés API |
| **CRM Engine** | CRM (Twenty/Airtable), politique de push, champs |
| **API Secrets** | Toutes les clés API sensibles |
| **Knowledge / XML** | Base de connaissances, catalogue XML |
| **Build & Deploy** | Lancer le build, voir les résultats |

4. Cliquez **"Construire l'Agent"** dans la section Build & Deploy
5. Si le build réussit, copiez le code embed affiché

### 5.2 Embed du Widget sur votre site

Après un build réussi, le Factory vous donne un snippet iframe :

```html
<iframe
  src="https://factory.votre-domaine.com/embed?widget_id=default"
  width="420"
  height="650"
  style="border:none; border-radius:16px;"
  allow="clipboard-write"
></iframe>
```

Collez ce code dans votre site HTML, WordPress, Webflow, ou n'importe quel CMS.

### 5.3 Personnalisation avancée

**Plusieurs agents pour différents clients :**

Chaque agent est une instance complète avec son propre `.env`. Pour déployer
plusieurs agents :

```bash
# Agent 1 — Agence Immobilière Paris
cd agent-paris/server
cp .env.example .env
# Configurer avec nom, clés, CRM du client...
docker compose -p agent-paris up -d

# Agent 2 — Agence Immobilière Lyon
cd agent-lyon/server
cp .env.example .env
# Configurer différemment...
FACTORY_PORT=3002 docker compose -p agent-lyon up -d
```

**Variables dynamiques :**

Ajoutez des variables personnalisées dans l'UI (section Identity > Dynamic Variables) :

| Variable | Exemple | Utilisation dans le prompt |
|----------|---------|---------------------------|
| `AGENCY_PHONE` | `01 23 45 67 89` | "Appelez-nous au {AGENCY_PHONE}" |
| `AGENCY_ADDRESS` | `12 rue de Paris` | "Visitez-nous au {AGENCY_ADDRESS}" |
| `AGENCY_HOURS` | `Lun-Ven 9h-18h` | "Nous sommes ouverts {AGENCY_HOURS}" |

---

## 6. Sécurité Production

### Checklist obligatoire avant mise en production

- [ ] `NODE_ENV=production` dans `.env`
- [ ] `ADMIN_API_KEY` est un hash aléatoire unique (pas le défaut)
- [ ] `JWT_SECRET` est un hex de 64 caractères aléatoires
- [ ] HTTPS activé (via Nginx + Let's Encrypt)
- [ ] `WIDGET_ALLOWED_ORIGINS` contient uniquement vos domaines
- [ ] `.env` et `.env.secrets` ne sont **JAMAIS** commités dans Git
- [ ] Le port 5432 (PostgreSQL) n'est **PAS** exposé publiquement
- [ ] Backups PostgreSQL configurés (cron job quotidien)
- [ ] Rate limiting actif (configuré par défaut : 100 req/15min)

### Générer des secrets sécurisés

```bash
# JWT Secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Admin API Key
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# Mot de passe PostgreSQL
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### Backup automatique

Ajoutez ce cron job pour des backups quotidiens :

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne (backup à 3h du matin)
0 3 * * * docker compose -f /chemin/vers/server/docker-compose.yml exec -T postgres pg_dump -U postgres chatbot | gzip > /backups/chatbot_$(date +\%Y\%m\%d).sql.gz
```

---

## 7. Monitoring & Maintenance

### Health Checks

```bash
# Vérification rapide
curl -s http://localhost:3001/health | python3 -m json.tool

# Réponse attendue :
# {
#   "status": "ok",
#   "timestamp": "2026-02-08T10:30:00.000Z"
# }
```

### Endpoints de monitoring

| Endpoint | Méthode | Auth | Description |
|----------|---------|------|-------------|
| `/health` | GET | ❌ | Health check basique |
| `/api/factory/observability` | GET | ✅ | Métriques système + CRM |
| `/api/factory/readiness` | GET | ✅ | Checks de production |
| `/api/factory/logs` | GET | ✅ | Logs structurés récents |
| `/api/factory/builds` | GET | ✅ | Historique des builds |
| `/api/factory/builds/stats` | GET | ✅ | Statistiques de build |

### Mise à jour

```bash
# Docker
cd server
git pull
docker compose up -d --build

# PM2
cd server
git pull
npm install
npm run build
pm2 restart agent-factory
```

### Nettoyage

```bash
# Supprimer les vieux backups .env (garde les 5 derniers)
ls -t server/.env.backup.* | tail -n +6 | xargs rm -f

# Docker : nettoyer les images non utilisées
docker image prune -f
```

---

## 8. Troubleshooting

### Le serveur ne démarre pas

| Symptôme | Cause probable | Solution |
|----------|---------------|----------|
| `ECONNREFUSED :5432` | PostgreSQL n'est pas lancé | `docker compose up postgres -d` ou `sudo systemctl start postgresql` |
| `JWT_SECRET required` | `.env` mal configuré | Vérifiez que `.env` contient `JWT_SECRET=...` |
| `EADDRINUSE :3001` | Port déjà utilisé | `lsof -i :3001` puis `kill <PID>`, ou changez `PORT` dans `.env` |
| `MODULE_NOT_FOUND` | Dépendances manquantes | `npm install` |
| TypeScript errors | Build corrompu | `rm -rf dist && npm run build` |

### Le Factory UI ne charge pas

| Symptôme | Cause probable | Solution |
|----------|---------------|----------|
| Page blanche | `factory.html` manquant | `npm run build` (copie les views dans dist/) |
| "Error loading" | Le fichier HTML n'existe pas | Vérifiez `src/views/factory.html` |
| 401 Unauthorized | Session expirée | Rechargez la page et reconnectez-vous |
| CSRF error | Cookies bloqués | Vérifiez que les cookies tiers sont autorisés |

### Le build échoue

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Database Connection: FAIL` | PostgreSQL inaccessible | Vérifiez `DATABASE_URL` et que PG tourne |
| `LLM API Key: FAIL` | Pas de clé LLM configurée | Ajoutez au moins une clé dans API Secrets |
| `[STRICT] ...` | Mode strict activé + warnings | Corrigez les warnings ou désactivez le mode strict |
| `Kill Switch: BLOCKED` | Kill switch activé | Désactivez-le dans LLM Provider > Factory Build Controls |
| `Agent Name: FAIL` | Nom d'agent manquant | Remplissez le nom dans Identity |

### Logs

```bash
# Docker
docker compose logs -f factory --tail 100

# PM2
pm2 logs agent-factory --lines 100

# Logs structurés via API (nécessite auth)
curl -s -b cookies.txt http://localhost:3001/api/factory/logs?limit=50
```

---

## 9. Architecture Résumée

```
┌─────────────────────────────────────────────────────────┐
│                    NAVIGATEUR                            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ /factory     │  │ /embed       │  │ /admin       │  │
│  │ (Config UI)  │  │ (Chat Widget)│  │ (Admin Panel)│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
└─────────┼──────────────────┼──────────────────┼─────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│              EXPRESS SERVER (:3001)                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Factory API  │  │ Chat API    │  │ Admin API   │     │
│  │ /api/factory │  │ /api/chat   │  │ /api/admin  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                  │                  │          │
│  ┌──────▼───────┐  ┌──────▼───────┐          │          │
│  │ Build        │  │ LLM Service  │          │          │
│  │ Pipeline     │  │ (Groq/OR/…)  │          │          │
│  │ ┌──────────┐ │  └──────────────┘          │          │
│  │ │ Config   │ │                             │          │
│  │ │ Synth.   │ │  ┌──────────────┐          │          │
│  │ ├──────────┤ │  │ CRM Service  │          │          │
│  │ │ Readiness│ │  │ (Twenty/AT)  │          │          │
│  │ │ Gate     │ │  └──────────────┘          │          │
│  │ ├──────────┤ │                             │          │
│  │ │ Observ.  │ │  ┌──────────────┐          │          │
│  │ │ Metrics  │ │  │ Knowledge    │          │          │
│  │ └──────────┘ │  │ Service      │          │          │
│  └──────────────┘  └──────────────┘          │          │
│                                               │          │
│  ┌────────────────────────────────────────────┘          │
│  │ Middleware: Auth + CSRF + Rate Limit + CORS           │
│  └───────────────────────────────────────────────────────│
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  PostgreSQL   │
              │  ┌──────────┐ │
              │  │ sessions │ │
              │  │ builds   │ │
              │  │ catalog  │ │
              │  │ rate_lim │ │
              │  └──────────┘ │
              └───────────────┘
```

### Fichiers clés

```
server/
├── src/
│   ├── index.ts                 # Point d'entrée Express
│   ├── factory/
│   │   ├── types.ts             # Contrats TypeScript (AgentConfig, Build, etc.)
│   │   ├── build-pipeline.ts    # Pipeline de build en 8 étapes
│   │   ├── config-synthesizer.ts # Conversion AgentConfig ↔ .env
│   │   ├── readiness-gate.ts    # 15 checks de production
│   │   ├── observability.ts     # Métriques et logs
│   │   ├── validation.ts        # Schemas Zod pour validation des inputs
│   │   └── runtime-matrix.ts    # Matrice de comportement strict/permissif
│   ├── routes/
│   │   ├── factory.routes.ts    # API REST du Factory
│   │   └── factory-ui.routes.ts # Handler pour servir factory.html
│   ├── views/
│   │   └── factory.html         # Dashboard UI (1678 lignes HTML/CSS/JS)
│   ├── middleware/
│   │   ├── admin-session.ts     # Auth JWT + CSRF
│   │   └── widget-auth.ts       # Auth des widgets embed
│   └── services/
│       ├── llm.service.ts       # Abstraction LLM multi-provider
│       └── crm/                 # Connecteurs CRM (Twenty, Airtable)
├── scripts/
│   ├── factory-smoke.ts         # Test E2E complet avec self-healing
│   └── test-ui-build.ts         # Test du workflow UI
├── Dockerfile                   # Image Docker multi-stage
├── docker-compose.yml           # Stack complète (PG + Factory)
├── .env.example                 # Template de configuration (sûr à commiter)
└── .env.secrets                 # Vraies clés API (JAMAIS commité)
```

---

## Support

- **Documentation technique** : `docs/HANDOFF_FACTORY_V2.md`
- **Secrets management** : `.env.secrets.README.md`
- **Tests** : `npm run factory:smoke` (test complet E2E)

---

*Dernière mise à jour : Février 2026*
*Version : Factory v2.0*