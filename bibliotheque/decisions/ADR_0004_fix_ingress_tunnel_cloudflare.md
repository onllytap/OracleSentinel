# ADR_0004 — Correction de l'ingress du tunnel Cloudflare (4000 → 3001)

- **Statut** : Accepté — **appliqué** le 2026-06-20 (correctif de production urgent, validé par le propriétaire, réversible).
- **Date** : 2026-06-20
- **Décideurs** : propriétaire + ingénierie (accès SSH/MCP fournis en session)
- **Références** : `bibliotheque/architecture/VPS_DEPLOYMENT_MAP.md`

> Note : contrairement aux ADR « Proposé » (non implémentés tant que non validés),
> celui-ci documente un **correctif d'infrastructure déjà appliqué**, car le backend
> public était cassé et le propriétaire a explicitement demandé la résolution.

---

## Contexte

Les chatbots déployés en Cloudflare Workers proxifient vers `https://api.oraclesentinel.com`
(binding `BACKEND_URL`). En ouvrant un Worker, la page renvoyait
**« api.oraclesentinel.com n'autorise pas la connexion »** / 404.

Diagnostic (SSH VPS + MCP Cloudflare) :
- `api.oraclesentinel.com` = CNAME proxied → tunnel `oraclesentinel-backend`.
- Tunnel en **config locale** `/etc/cloudflared/config.yml`, ingress → `http://localhost:4000`.
- Or **`:4000` = conteneur `aae-api`** (projet System 2 / AAE), qui renvoie 404 (`/health` inconnu).
- Le **backend Sentinel** (`oraclesentinel-server`) écoute sur **`:3001`** et répond `/health` → `200 {"status":"ok","database":"ok"}`.

Cause racine : l'ingress pointait vers le **mauvais projet** (AAE au lieu de Sentinel),
probablement une erreur de copie depuis la config AAE. Le domaine `api.oraclesentinel.com`
appartient pourtant au produit Sentinel.

## Décision

Corriger l'ingress du tunnel pour pointer vers le backend Sentinel :

```yaml
# /etc/cloudflared/config.yml
ingress:
  - hostname: api.oraclesentinel.com
    service: http://localhost:3001   # était http://localhost:4000
  - service: http_status:404
```

Procédure appliquée (réversible) :
1. **Backup** : `cp config.yml config.yml.bak.<ts>`.
2. `sed -i 's#http://localhost:4000#http://localhost:3001#' config.yml`.
3. `cloudflared tunnel ingress validate` → **OK**.
4. `systemctl restart cloudflared` → tunnel reconnecté (fra03/08/18).
5. Vérification externe : `curl https://api.oraclesentinel.com/health` → **200** + JSON Sentinel.
   Worker : `oraclesentinel-chatbot…workers.dev/api/health` → **200**.

## Conséquences

**Positives**
- Le backend Sentinel est de nouveau **joignable publiquement** ; les Workers fonctionnent.
- Aucune modification de code applicatif ; changement de config infra, réversible.

**Négatives / vigilance**
- Le VPS est mutualisé : ce tunnel ne sert qu'`api.oraclesentinel.com`. L'API AAE
  (`:4000`) reste accessible par ses propres voies (Caddy/domaine dédié) — vérifier
  qu'aucun autre service ne comptait sur cet ingress (a priori non : nommage Sentinel).

**Rollback**
```bash
ssh sentinel-vps "cp /etc/cloudflared/config.yml.bak.* /etc/cloudflared/config.yml && systemctl restart cloudflared"
```

## Suivi
- À terme, fiabiliser : surveiller `api.oraclesentinel.com/health` depuis le QG
  (la future Phase 1 « Workers » + un check backend public). Cf. `ROADMAP_QG_REMOTE_CONTROL.md`.
