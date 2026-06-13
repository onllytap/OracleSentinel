# 🚀 Tutoriel One-Shot: Déploiement Chatbot Widget sur VPS Docker (Traefik Existant)

> **Objectif**: Déployer le chatbot widget bulle sur ton VPS Docker existant avec Traefik (0€/mois)
> **Durée**: 10-15 minutes
> **Niveau**: Débutant
> **Prérequis**: Traefik déjà configuré sur ton VPS

---

## 📋 Prérequis

- ✅ VPS avec Docker déjà installé
- ✅ **Traefik déjà configuré** (pas Nginx)
- ✅ Accès SSH au VPS
- ✅ Clés API Groq (ou autre LLM)

---

## 🎯 Architecture Finale

```
Site Client (iframe)
       ↓
https://bot.oraclesentinel.com/embed?widget_id=default
       ↓
Traefik (déjà existant) → Chatbot Backend (:3001)
       ↓
PostgreSQL + Groq API (Llama 3.3) + CRM (Twenty/Airtable)
```

---

## ÉTAPE 1: Préparation Locale (3 min)

### 1.1 Vérifier le projet

```bash
cd d:\Chatbot\server
ls -la
```

Tu dois voir:
- ✅ `Dockerfile`
- ✅ `docker-compose.yml`
- ✅ `.env.example`
- ✅ `src/` (code backend)

### 1.2 Configurer les variables d'environnement

```bash
cp .env.example .env
notepad .env
```

**Variables OBLIGATOIRES à modifier:**

```env
# Base de données (Docker gère ça automatiquement)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=un_mot_de_passe_fort_ici
POSTGRES_DB=chatbot

# LLM (au moins une clé)
GROQ_API_KEY=gsk_ton_vraie_cle_ici

# Sécurité (génère des secrets uniques)
JWT_SECRET=generez_un_hex_64_caracteres_ici
ADMIN_API_KEY=generez_un_hex_32_caracteres_ici

# Environnement
NODE_ENV=production

# Domaine pour CORS
WIDGET_ALLOWED_ORIGINS=https://oraclesentinel.com,https://www.oraclesentinel.com
```

**Générer des secrets sécurisés:**

```bash
# JWT Secret (64 caractères hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Admin API Key (32 caractères hex)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 1.3 Vérifier la configuration

```bash
cat .env | grep -E "POSTGRES_|GROQ_API_KEY|JWT_SECRET|ADMIN_API_KEY"
```

---

## ÉTAPE 2: Transfert sur VPS (2 min)

### 2.1 Copier les fichiers sur le VPS

```bash
# Remplace user@vps par tes identifiants réels
scp -r d:\Chatbot\server user@vps:/opt/chatbot/
```

### 2.2 Se connecter au VPS

```bash
ssh user@vps
```

### 2.3 Vérifier les fichiers

```bash
cd /opt/chatbot/server
ls -la
```

---

## ÉTAPE 3: Configuration Docker Compose pour Traefik (2 min)

### 3.1 Ajouter les labels Traefik

Éditer `docker-compose.yml`:

```bash
nano docker-compose.yml
```

Ajoute ces labels dans la section `factory`:

```yaml
factory:
  build:
    context: .
    dockerfile: Dockerfile
  container_name: agent-factory-server
  restart: unless-stopped
  
  depends_on:
    postgres:
      condition: service_healthy
  
  env_file:
    - .env
  
  environment:
    DATABASE_URL: postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-chatbot}
    NODE_ENV: ${NODE_ENV:-production}
    PORT: 3001
  
  ports:
    - "${FACTORY_PORT:-3001}:3001"
  
  # === TRAEFIK LABELS ===
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.chatbot.rule=Host(`bot.oraclesentinel.com`)"
    - "traefik.http.routers.chatbot.entrypoints=websecure"
    - "traefik.http.routers.chatbot.tls.certresolver=letsencrypt"
    - "traefik.http.services.chatbot.loadbalancer.server.port=3001"
  # ========================
  
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 15s
  
  networks:
    - factory-net
```

⚠️ **IMPORTANT**: Assure-toi que ton Traefik existant utilise:
- Entrypoint `websecure` sur port 443
- Certresolver `letsencrypt` configuré
- Réseau Docker compatible

### 3.2 Sauvegarder et quitter

```bash
Ctrl+O (sauvegarder)
Ctrl+X (quitter)
```

---

## ÉTAPE 4: Lancement Docker (2 min)

### 4.1 Lancer les containers

```bash
docker compose up -d --build
```

### 4.2 Vérifier que tout tourne

```bash
docker compose ps
```

Tu dois voir:
- ✅ `agent-factory-server` - Running
- ✅ `agent-factory-db` - Running

### 4.3 Voir les logs

```bash
docker compose logs -f factory
```

Attendre de voir:
```
Server running on port 3001
```

### 4.4 Tester le health check

```bash
curl http://localhost:3001/health
```

Réponse attendue:
```json
{"status":"ok","timestamp":"..."}
```

---

## ÉTAPE 5: Vérification DNS (1 min)

### 5.1 Configurer le DNS

Va sur ton registreur de domaine (Cloudflare, OVH, etc.):

**Ajouter un enregistrement:**
- **Type**: A
- **Nom**: `bot`
- **Valeur**: IP de ton VPS
- **TTL**: 3600 (ou automatique)

### 5.2 Vérifier la propagation

```bash
nslookup bot.oraclesentinel.com
```

Doit retourner l'IP de ton VPS.

---

## ÉTAPE 6: Test Final (2 min)

### 6.1 Tester l'endpoint /embed

Ouvre dans ton navigateur:
```
https://bot.oraclesentinel.com/embed?widget_id=default
```

Tu dois voir:
- ✅ Page de chat avec le widget
- ✅ Message "Bonjour ! Comment puis-je vous aider ?"
- ✅ Champ de saisie fonctionnel

### 6.2 Tester la conversation

1. Tape un message dans le chat
2. Appuie sur Entrée
3. Vérifie que le bot répond (peut prendre 2-3 secondes)

### 6.3 Vérifier les logs

```bash
docker compose logs factory --tail 50
```

Cherche:
- ✅ `POST /api/chat` - Reçu
- ✅ `LLM response` - Réponse générée
- ✅ `POSTGRES` - Conversation stockée

---

## ÉTAPE 7: Intégration sur Site Client (1 min)

### 7.1 Code iframe à fournir au client

```html
<!-- Copier-coller sur le site du client -->
<iframe 
  src="https://bot.oraclesentinel.com/embed?widget_id=default"
  style="position:fixed;bottom:20px;right:20px;width:400px;height:600px;border:none;border-radius:16px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.3);"
  allow="clipboard-write"
></iframe>
```

### 7.2 Personnalisation (optionnelle)

**Changer la taille:**
```html
width="350px" height="550px"
```

**Changer la position:**
```html
style="position:fixed;bottom:20px;left:20px;..."
```

---

## ÉTAPE 8: Multi-Tenant (optionnel)

### 8.1 Créer un widget pour un nouveau client

```bash
# Sur le VPS
cd /opt/chatbot/server
nano .env
```

Ajouter:
```env
WIDGET_TENANT_MAP="client1:default,client2:default"
```

### 8.2 URL pour le nouveau client

```html
<iframe 
  src="https://bot.oraclesentinel.com/embed?widget_id=client2"
  ...
/>
```

---

## 🔧 Maintenance

### Voir les logs en temps réel
```bash
docker compose logs -f factory
```

### Redémarrer le service
```bash
docker compose restart factory
```

### Mettre à jour le code
```bash
cd /opt/chatbot/server
git pull
docker compose up -d --build
```

### Backup de la base de données
```bash
docker compose exec postgres pg_dump -U postgres chatbot > backup_$(date +%Y%m%d).sql
```

### Restaurer un backup
```bash
docker compose exec -T postgres psql -U postgres chatbot < backup_20260216.sql
```

---

## 🚨 Résolution de Problèmes

### Problème: Port déjà utilisé
```bash
# Vérifier ce qui utilise le port
lsof -i :3001

# Tuer le processus
kill -9 <PID>
```

### Problème: Container ne démarre pas
```bash
# Voir les logs détaillés
docker compose logs factory

# Recompiler
docker compose up -d --build --force-recreate
```

### Problème: SSL non généré par Traefik
```bash
# Vérifier les logs Traefik
docker compose logs traefik

# Vérifier que Traefik détecte le service
curl -H "Host: bot.oraclesentinel.com" http://localhost:8080/api/http/services
```

### Problème: Widget ne répond pas
```bash
# Vérifier les variables d'environnement
docker compose exec factory env | grep -E "GROQ_API_KEY|DATABASE_URL"

# Tester l'API directement
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"test"}'
```

---

## 📊 Monitoring

### Health Check Automatisé

Ajouter dans le crontab:
```bash
crontab -e
```

```cron
# Vérifier le serveur toutes les 5 minutes
*/5 * * * * curl -f http://localhost:3001/health || docker compose restart factory
```

### Logs Structurés

```bash
# Voir les 100 derniers logs
docker compose logs factory --tail 100

# Filtrer par erreur
docker compose logs factory | grep -i error
```

---

## ✅ Checklist Avant Mise en Production

- [ ] `.env` configuré avec vraies clés API
- [ ] `POSTGRES_PASSWORD` est un mot de passe fort
- [ ] `JWT_SECRET` est un hex aléatoire de 64 caractères
- [ ] `ADMIN_API_KEY` est un hex aléatoire de 32 caractères
- [ ] `NODE_ENV=production`
- [ ] `WIDGET_ALLOWED_ORIGINS` contient les domaines clients
- [ ] DNS `bot.oraclesentinel.com` pointe vers le VPS
- [ ] Traefik labels configurés dans `docker-compose.yml`
- [ ] `docker compose up -d --build` réussi
- [ ] `curl http://localhost:3001/health` retourne `{"status":"ok"}`
- [ ] `https://bot.oraclesentinel.com/embed?widget_id=default` fonctionne
- [ ] Conversation testée avec succès
- [ ] Logs vérifiés (pas d'erreurs)

---

## 🎉 Félicitations !

Ton chatbot widget est maintenant déployé et opérationnel !

**URL finale:**
```
https://bot.oraclesentinel.com/embed?widget_id=default
```

**Pour intégrer sur un site client:**
```html
<iframe 
  src="https://bot.oraclesentinel.com/embed?widget_id=default"
  style="position:fixed;bottom:20px;right:20px;width:400px;height:600px;border:none;border-radius:16px;z-index:9999;"
/>
```

**Coût total: 0€/mois** (tu utilises ton VPS existant)

---

## Support

Si tu as des problèmes:
1. Vérifie les logs: `docker compose logs factory`
2. Consulte ce tutoriel
3. Vérifie la documentation: `d:\Chatbot\DEPLOY.md`

---

*Dernière mise à jour: 16 février 2026*
*Version: 1.0 - Adapté pour Traefik existant*
