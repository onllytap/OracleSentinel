# VPS_DEPLOYMENT_MAP — Topologie de production réelle

> Découvert et vérifié en session le 2026-06-20 (accès SSH + MCP Cloudflare).
> Ce document décrit **où et comment Sentinel tourne réellement en production**, et
> l'écosystème qui partage le même serveur. À tenir à jour.

> ⚠️ **Le VPS est un hôte MUTUALISÉ** : plusieurs projets indépendants y cohabitent.
> Toute action sur le VPS doit cibler **uniquement** les conteneurs `oraclesentinel-*`
> et le tunnel, sans toucher aux autres projets (AAE, Twenty, n8n, linkedin-farm…).

---

## 1. Le serveur

| | |
|---|---|
| Hébergeur | IONOS (VPS 8-16-480, Europe) |
| IP | `<IP VPS — non publiée (repo public) ; voir gestionnaire de secrets>` |
| OS | Ubuntu 24.04.3 LTS |
| Ressources | 8 vCore · 16 Go RAM · 480 Go NVMe (≈21 % utilisés) |
| Accès | SSH `root` (clé `kiro-sentinel` posée ; alias local `sentinel-vps`) |
| Reverse proxy | **Caddy** sur `:80` / `:443` |
| Tunnel edge | **cloudflared** (service systemd, config locale) |

---

## 2. Chemin d'une requête chatbot (production)

```
Navigateur / site client
        │
        ▼
Cloudflare Worker (edge)            ← façade : oraclesentinel-chatbot, etc.
  binding BACKEND_URL = https://api.oraclesentinel.com
        │
        ▼
Cloudflare (DNS proxied)  api.oraclesentinel.com  (CNAME → tunnel)
        │
        ▼
cloudflared (tunnel "oraclesentinel-backend")
  /etc/cloudflared/config.yml  →  ingress: http://localhost:3001
        │
        ▼
Docker: oraclesentinel-server  (:3001)   ← LE BACKEND SENTINEL (cerveau)
        │
        ▼
Docker: oraclesentinel-db (PostgreSQL :5433→5432)
```

**Le cerveau du bot (prompt, modèle, conversations, leads) vit dans le backend
Sentinel (`:3001`), PAS dans le Worker.** Le Worker n'est qu'un proxy edge.

---

## 3. Conteneurs Docker sur le VPS (2026-06-20)

| Projet | Conteneur | Port (host→cont.) | Rôle |
|---|---|---|---|
| **Sentinel** ✅ | `oraclesentinel-server` | `0.0.0.0:3001→3001` | Backend Express (NOTRE projet) |
| **Sentinel** ✅ | `oraclesentinel-db` | `0.0.0.0:5433→5432` | PostgreSQL Sentinel |
| AAE (Système 2) | `aae-api` | `127.0.0.1:4000→4000` | API Fastify (Auto-Action Engine) |
| AAE | `aae-web` | `127.0.0.1:3000→3000` | Cockpit Next.js |
| AAE | `aae-postgres` | `127.0.0.1:5434→5432` | PostgreSQL AAE |
| AAE | `aae-redis` | `127.0.0.1:6379` | Redis/BullMQ |
| AAE | `aae-documenso` | `127.0.0.1:3500` | Signature électronique |
| AAE | `aae-minio` | `127.0.0.1:9000-9001` | Stockage objets |
| AAE | `aae-prometheus` | `127.0.0.1:9090` | Métriques |
| AAE | `aae-otel` | `127.0.0.1:4317-4318` | OpenTelemetry |
| Twenty CRM | `twenty-server-1` | `127.0.0.1:3002→3000` | CRM (cible des leads) |
| Twenty CRM | `twenty-worker-1` / `twenty-db-1` / `twenty-redis-1` | interne | Workers + DB + cache |
| n8n | `n8n` | `127.0.0.1:5678` | Automatisation |
| linkedin-farm | (hors Docker) `node /opt/linkedin-farm/usine-serveur/server.js` | `:3099` | Projet séparé |
| bulkapply | `bulkapply-factory` | `:3003`, `:49732` | Projet séparé |
| findajob | `findajob-theo-scheduler-1` | `127.0.0.1:8090` | Projet séparé |

> Seuls `oraclesentinel-*` sont dans le périmètre de cette mission. Les autres
> appartiennent à d'autres projets de l'utilisateur — **ne pas toucher**.

---

## 4. Cloudflare

| | |
|---|---|
| Compte | sous-domaine workers.dev = `neverdiscord666` |
| Zone | `oraclesentinel.com` (active) |
| Tunnel | `oraclesentinel-backend` (config **locale** : `/etc/cloudflared/config.yml`) |
| Ingress | `api.oraclesentinel.com` → `http://localhost:3001` (corrigé — voir ADR_0004) |

### Workers déployés (4)
| Worker | URL publique | Notes |
|---|---|---|
| `oraclesentinel-chatbot` | `oraclesentinel-chatbot.neverdiscord666.workers.dev` | binding `BACKEND_URL=https://api.oraclesentinel.com` ; proxy `/api/*` |
| `chatbot-21c265f0` | `chatbot-21c265f0.neverdiscord666.workers.dev` | aucun binding (façade test) |
| `chatbot-4e4206e0` | idem | aucun binding |
| `my-worker` | idem | test |

---

## 5. Runbook — vérifier / dépanner le backend public

```bash
# Le backend public répond-il ?  (doit renvoyer {"status":"ok","database":"ok"})
curl -s https://api.oraclesentinel.com/health

# Sur le VPS : qui écoute, état des conteneurs Sentinel, état du tunnel
ssh sentinel-vps "ss -tlnp | grep -E ':3001|:4000'"
ssh sentinel-vps "docker ps --filter name=oraclesentinel --format '{{.Names}} {{.Status}}'"
ssh sentinel-vps "systemctl is-active cloudflared && journalctl -u cloudflared -n 20 --no-pager"

# Config du tunnel (l'ingress DOIT pointer vers :3001)
ssh sentinel-vps "cat /etc/cloudflared/config.yml"
```

Pièges connus :
- L'ingress doit pointer vers **`:3001`** (Sentinel), **pas `:4000`** (= `aae-api`). Cf. ADR_0004.
- Le tunnel est en **config locale** (`config.yml`) : la config du dashboard Cloudflare est ignorée. Modifier le fichier puis `systemctl restart cloudflared`.

---

## 6. Sécurité / accès (rappels)

- Accès SSH par **clé** (`kiro-sentinel`). Le mot de passe root initial doit être
  **changé** (il a circulé en clair) ; idéalement `PasswordAuthentication no`.
- Clé révocable : retirer la ligne `kiro-sentinel` de `~/.ssh/authorized_keys`.
- Ne jamais committer d'identifiants VPS / tokens / mots de passe dans le repo.

---

## 7. Déploiement du backend (runbook)

> `/opt/oraclesentinel` est désormais un **dépôt git** (remote `github` =
> OracleSentinel). Déploiement = mettre le code à jour vers `main` puis rebuild.

### Déploiement standard (futur)
```bash
ssh sentinel-vps
cd /opt/oraclesentinel
git fetch github main && git reset --hard github/main   # server/.env (gitignoré) préservé
docker compose up -d --build oraclesentinel              # build image + recreate conteneur
# Vérifier :
curl -s https://api.oraclesentinel.com/health            # {"status":"ok","database":"ok"}
docker compose ps oraclesentinel                         # STATUS = Up (healthy)
docker logs oraclesentinel-server --tail 20              # "Server started"
```

### Config VPS-LOCALE (PAS dans le dépôt — à préserver)
Ces éléments vivent uniquement sur le VPS et ne doivent jamais être écrasés :
- **`/opt/oraclesentinel/docker-compose.yml`** : compose VPS-local (le dépôt fournit
  `docker-compose.production.yml`, non utilisé ici). Son `DATABASE_URL` pointe vers
  `oraclesentinel-db` et **doit finir par `?sslmode=disable`** (la DB locale Docker
  ne parle pas TLS ; le code n'active TLS que sinon).
- **`/opt/oraclesentinel/server/.env`** (gitignoré) : doit contenir, en plus des
  secrets habituels :
  - `ADMIN_SESSION_SECRET=<aléatoire ≥32, DISTINCT de ADMIN_API_KEY>` — **requis en
    prod** (durcissement F9 : le backend refuse de démarrer sinon).
  - `CLOUDFLARE_WORKERS_SUBDOMAIN=neverdiscord666` — pour l'onglet Workers du QG.

### Pré-requis du build (corrigés dans le dépôt — pour mémoire)
Le `Dockerfile.production` build frontend (Vite) + backend (esbuild ESM). Points qui
avaient cassé le 1er déploiement (désormais corrigés sur `main`) :
- Le build frontend doit copier **`dashboard.html`** (entrée Vite du QG).
- `server/package.json` doit déclarer **better-auth, helmet, multer, stripe** (le bundle
  esbuild les laisse `external` → ils doivent exister dans l'image).
- Le banner esbuild ESM définit `require`/`__dirname`/`__filename` via imports namespace.

### Rollback
```bash
ssh sentinel-vps
cd /opt/oraclesentinel
# 1. Restaurer le code + .env depuis la sauvegarde horodatée
tar xzf /root/os-backup-<TS>.tgz -C /opt
cp /root/os-server-env-<TS>.bak server/.env
# 2. Repartir sur l'image précédente
docker tag oraclesentinel-oraclesentinel:rollback-<TS> oraclesentinel-oraclesentinel:latest
docker compose up -d oraclesentinel
```
(Les sauvegardes `/root/os-backup-*.tgz`, `/root/os-server-env-*.bak` et les images
`:rollback-*` sont créées avant chaque déploiement.)
