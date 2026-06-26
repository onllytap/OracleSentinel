# SYSTEM_MAP — Cartographie de l'écosystème OracleSentinel / Sentinel

> Document d'audit — Phase 0. Lecture seule, aucune modification de code effectuée.
> Date : 2026-06-19. Auteur : audit ingénierie senior.
> Objet : comprendre l'écosystème complet AVANT toute amélioration de `D:\Chatbot - Copy`.

---

## 1. Vue d'ensemble

L'écosystème est composé de **trois systèmes complémentaires** mais physiquement séparés. Un seul est la cible de cette mission (`D:\Chatbot - Copy`). Les deux autres sont des **sources de compréhension** à ne pas modifier.

```
ÉCOSYSTÈME OracleSentinel
│
├── Système 1 — SENTINEL (CIBLE)            D:\Chatbot - Copy
│     Chatbot widget + backend + QG Admin (/admin, /factory, /priv)
│
├── Système 2 — SYSTEM 2 VRAI (RÉFÉRENCE)   ...\PROJET\PROJET\SYSTEM 2 VRAI
│     Infrastructure / orchestration / AAE (Auto-Action Engine)
│
└── Système 3 — projet - 3 VRAI (RÉFÉRENCE) ...\PROJET\PROJET\projet - 3 VRAI
      Site vitrine B2B (landing page Next.js)
```

Nom de marque : **Sentinel** = la partie chatbot/widget ; **Oracle** = la partie CRM / infrastructure / orchestration. Domaine produit : qualification et pré-closing de **leads immobiliers**, puis envoi vers le CRM client.

---

## 2. Système 1 — Sentinel (cible principale)

**Chemin** : `D:\Chatbot - Copy`
**Rôle** : produit livrable. Widget conversationnel + backend API + base de données + 3 surfaces d'administration (« QG »).

| Couche | Technologie | Emplacement |
|---|---|---|
| Widget / Frontend | React 18, Vite 6, Tailwind, Radix UI, better-auth, Sentry | `src/` |
| QG Frontend | React (Command Center) | `src/dashboard/` |
| Backend | Node.js + Express + TypeScript | `server/src/` |
| Base de données | PostgreSQL (`pg`), Neon en prod | `server/src/db/` |
| LLM | Groq (principal), OpenRouter, Anthropic SDK présent | `server/src/services/` |
| CRM | Airtable (webhook), Twenty (API) | `server/src/services/crm/` |
| Déploiement | Docker (`Dockerfile.production`, `docker-compose.production.yml`) | racine |

**Surfaces d'administration (le « QG ») :**
- `/admin` — visualisation DB, CRUD catalogue, purge tenant.
- `/factory` — configuration agent, pipeline de build, import knowledge, tests connexions, rollback.
- `/priv` — page légère de supervision infra + flotte (repli).
- `/qg` — **Command Center React** (servi en prod, CSP stricte) : supervision flotte + gestion distante des bots (config par tenant versionnée, redéploiement contrôlé, provisioning, clients, CRM par agence, métriques, 2FA). API sous `/api/priv/*`. _(Ajouté QG v2.1 — voir `architecture/ARCHITECTURE.md` §10.)_

C'est le **seul** système où des modifications de code sont autorisées dans cette mission.

---

## 3. Système 2 — SYSTEM 2 VRAI (référence infra/orchestration)

**Chemin** : `C:\Users\LDO2026\Desktop\01_Mes_Projets\PROJET\PROJET\SYSTEM 2 VRAI`
**Rôle observé sur disque** : plateforme d'infrastructure et d'orchestration (monorepo).

Éléments confirmés par inspection (pas seulement le handoff) :
- Monorepo **Turborepo + pnpm** (`turbo.json`, `pnpm-workspace.yaml`, `apps/`).
- Orchestration conteneurs : `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.vps.yml`.
- Reverse proxy **Caddy** (`Caddyfile`).
- Automatisation **n8n** (`n8n/`), signature électronique **Documenso** (`documenso-2.8.0/`).
- Observabilité : **OpenTelemetry** (`otel-collector.yaml`), **Prometheus** (`prometheus.yml`).
- Gestion process **PM2** (`ecosystem.config.cjs`).
- Déploiement VPS : `deploy-to-vps.bat`, `restart-vps.bat`.
- Documentation : `docs/`, `AUDIT.md`, `00_AUDIT_ENTREPRISE_DOCS/`.

> Cohérence avec le handoff : décrit comme la plateforme **AAE (Auto-Action Engine)**, human-in-the-loop, Fastify/Node 20, Next.js 14 cockpit, PostgreSQL 16, Drizzle, Redis/BullMQ, RGPD. L'inspection disque confirme la nature infra/orchestration.

**À ne pas modifier.** Source pour comprendre : les services infra que `/priv` monitore (Neon, Redis, MinIO, n8n, SMTP/Brevo, Twenty, Sentry, Documenso) correspondent exactement à cette plateforme.

---

## 4. Système 3 — projet - 3 VRAI (référence vitrine)

**Chemin** : `C:\Users\LDO2026\Desktop\01_Mes_Projets\PROJET\PROJET\projet - 3 VRAI`
**Rôle observé sur disque** : site vitrine / présentation produit.

Éléments confirmés :
- `src/`, `bento/` (sections de landing), `biome.json` (lint/format Biome).
- Documentation produit : `SpecificationTechnique.md`, `documentation/`, `Rapport_Creation_Pages.md`, `expertise.md`, `IMPORTANT.md`.

> Cohérence avec le handoff : landing B2B OracleSentinel (Next.js 15, React 19, Tailwind 4, GSAP, Three.js, NextAuth, PostHog).

**À ne pas modifier.** Source pour : cohérence de marque, promesse produit, vocabulaire commercial.

---

## 5. Liens et dépendances entre systèmes

```
[projet - 3 VRAI]            [Sentinel — D:\Chatbot - Copy]         [SYSTEM 2 VRAI]
  Vitrine B2B        ───►      Widget chatbot (Sentinel)    ───►     CRM Twenty
  (acquisition)               Backend API + QG Admin                n8n / Documenso
                              PostgreSQL (Neon)             ◄───     Infra monitorée
                                     │                                 par /priv
                                     └── push leads ──► Airtable / Twenty CRM
```

- **Sentinel → SYSTEM 2 VRAI** : Sentinel pousse les leads qualifiés vers Twenty CRM (hébergé côté SYSTEM 2). `/priv` (Sentinel) **monitore** l'infra de SYSTEM 2 (Neon, Redis, MinIO, n8n, SMTP, Twenty, Sentry, Documenso) via des sondes réseau en lecture seule.
- **projet - 3 VRAI → Sentinel** : la vitrine présente/vend le produit ; le widget Sentinel est ce qui est livré aux agences.
- **Couplage** : faible et par configuration (URLs/clés dans `.env`). Aucun import de code croisé constaté. Les systèmes communiquent par HTTP/API, pas par dépendance partagée.

---

## 6. Éléments utiles pour Sentinel (récupérables comme contexte)

| Besoin Sentinel | Où chercher | Type |
|---|---|---|
| Spéc infra cible (services, ports, RGPD) | `SYSTEM 2 VRAI/docs`, `AUDIT.md`, `00_AUDIT_ENTREPRISE_DOCS` | Documentation |
| Convention déploiement VPS / Docker / Caddy | `SYSTEM 2 VRAI` (compose, Caddyfile, ecosystem.config.cjs) | Référence ops |
| Vocabulaire produit / promesse commerciale | `projet - 3 VRAI` (`SpecificationTechnique.md`, `documentation/`) | Référence produit |
| Audits déjà réalisés sur Sentinel | `bibliotheque/depart_docs/01_AUDIT_ET_ETAT_PROJET` | Historique |
| Passation et contraintes | `bibliotheque/handoff/CHATGPT_LIS_ABSOLUMENT.md` | Contraintes |

---

## 7. Zones à NE PAS toucher (rappel des garde-fous)

| Zone | Raison | Source |
|---|---|---|
| `SYSTEM 2 VRAI/` (tout) | Système de référence, hors périmètre | Brief mission |
| `projet - 3 VRAI/` (tout) | Système de référence, hors périmètre | Brief mission |
| Logique LLM / modèle Groq | Validé par l'utilisateur, ne pas changer | Handoff |
| Design du widget | Ne pas modifier sans demande explicite | Handoff |
| Payloads CRM Airtable / Twenty | Flux fonctionnels, ne pas casser | Handoff |
| `server/src/db/schema.sql` | Legacy destructif (`DROP TABLE`) — ne pas exécuter | Audit |
| Suppression de dossiers/backups | Interdit sans inventaire + validation | Handoff |

---

## 8. Règle d'analyse multi-système

Avant de conclure qu'une fonctionnalité **manque** dans Sentinel, vérifier dans l'ordre :
1. `D:\Chatbot - Copy` (code actif + `bibliotheque/depart_docs`)
2. `SYSTEM 2 VRAI` (infra/factory/orchestration)
3. `projet - 3 VRAI` (vitrine/produit)

Un fichier absent d'un dossier **n'est pas** une preuve d'absence globale. Ces dossiers sont des **sources de compréhension, pas des cibles de migration** : pas de déplacement, fusion, ni suppression entre projets.
