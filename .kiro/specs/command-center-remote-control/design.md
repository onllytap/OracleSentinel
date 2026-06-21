# Design Document — Command Center v2.1 (R17/R18/R19 + R1–R16)

> Conception **additive** pour OracleSentinel. Le runtime chatbot, le widget, la logique
> LLM/Groq, la qualification et les payloads CRM existants **ne changent pas**. On étend.
> Source de vérité du code : `server/src/**`, `src/dashboard/**`. Aligné avec
> `requirements.md` (R1–R19), `bibliotheque/ROADMAP_QG_REMOTE_CONTROL.md`,
> `bibliotheque/decisions/ADR_0002`/`ADR_0003`. Sous-module `Chatbot/` = **ignoré**.

---

## 1. Principes de conception (non négociables)

1. **Additif uniquement.** Aucune réécriture, aucun changement de framework. On branche dans les
   points d'extension existants.
2. **Réutiliser l'existant.** Tout ce qui est déjà livré (§2) est réutilisé tel quel ; on ne
   duplique pas une logique métier.
3. **Zéro secret exposé.** Aucun secret n'est renvoyé par une API, loggé, ni stocké en clair.
   Les credentials CRM par agence et le secret TOTP sont **chiffrés au repos** (AES-256-GCM).
4. **Jamais de 500 sur entrée valide ou hostile.** Tout nouveau service intercepte ses erreurs et
   **dégrade proprement**. Le hot-path chat ne lève jamais à cause d'une nouveauté.
5. **Désactivable et rétrocompatible.** Facturation off par défaut (`BILLING_ENABLED=false`),
   tenants sans config = comportement actuel inchangé, absence de clé de chiffrement = refus de
   manipuler des secrets (pas de stockage en clair).
6. **Gating + CSRF systématiques.** Toute mutation : `requireAdminSession()` + `requireCSRF()`.
7. **Audit append-only** de toutes les actions sensibles, sans PII ni secret.

---

## 2. Code DÉJÀ livré — à réutiliser, NE PAS dupliquer

Inventaire vérifié dans le code. Ces briques sont le socle ; les nouveaux modules s'y branchent.

| Brique livrée | Fichier | Ce qu'elle fournit | Réutilisé par |
|---|---|---|---|
| **Session admin + CSRF** | `server/src/middleware/admin-session.ts` | `requireAdminSession()`, `requireCSRF()`, `resolveAdminSessionSecret()`, `generateCSRFToken()`, `verifyAdminSessionFromRequest()` | Toutes les routes `/api/priv` + login TOTP |
| **Clé API admin** | `server/src/middleware/admin-api-key.ts` | `requireAdminApiKey()` (header) | Break-glass / compat |
| **Login Access_Key** | `server/src/routes/admin.routes.ts` → `POST /api/admin/session` | compare `ADMIN_API_KEY` (temps constant) → `signAdminSessionToken()` → cookies `admin_session` + `csrf_token` | **Étendu** par TOTP (T7) |
| **Login passkey** | `server/src/services/passkey.service.ts` + `admin.routes.ts` `/passkey/*` | WebAuthn (UV requis), émet les **mêmes** cookies | Auth unifiée (T7) — inchangé |
| **Better Auth (2FA/multi-user)** | `server/src/auth/auth.ts` (`/api/auth/*`, plugin `twoFactor`) | chemin multi-utilisateur **optionnel** | R15 (option) |
| **Config par tenant (Store)** | `server/src/services/tenant-config.service.ts` | `getTenantConfig`, `saveTenantOverride` (versionné), `getTenantConfigVersions`, `rollbackTenantConfig`, `getEffectiveIdentityPromptBlock`, `seedTenantConfigsFromFactory` | **R1/R2 déjà couverts** ; étendu par redeploy (T9) |
| **Routes QG config** | `server/src/routes/command-center.routes.ts` | `GET/PUT /tenants/:id/config`, `/versions`, `/rollback`, clients CRUD, `/workers`, `/infra`, `/overview`, `/surveillance` | base d'intégration |
| **Clients / propriété bots** | `server/src/services/client.service.ts` (+ tables `clients`, `client_tenants`) | CRUD clients, assign/unassign tenant, `getTenantOwners()` | Provisioning (T3), QG (T10/T12) |
| **CRM multi-provider** | `server/src/services/crm/*` | `CRMConnector`, `CdmLead`, `CrmPushResult`, `new AirtableConnector(cfg)`, `new TwentyConnector(cfg)`, `getCRMConnector()` | **tenant-crm (T1)** instancie les connecteurs avec une config par tenant |
| **Hook prompt par tenant** | `chat.service.ts` → `getEffectiveIdentityPromptBlock()` | déjà appelé dans `processMessage` (try/catch, fallback "") | modèle pour le hook lead→CRM (T6) |
| **Push lead (global)** | `chat.service.ts` étape 8 → `getCRMConnector().pushLead(lead, sessionId)` | comportement CRM global actuel | **fallback** de tenant-crm (T6) |
| **Infra / flotte / surveillance** | `infra-monitor.service.ts`, `fleet.service.ts`, `surveillance.service.ts` | snapshots santé (secrets masqués) | métriques réelles (T5) |
| **Workers Cloudflare (RO)** | `cloudflare.service.ts` | `collectWorkersSnapshot`, `getWorkerDetail`, `pingWorker` (latence HTTP réelle, `AbortSignal.timeout`), `classifyWorkerStatus` | patron de sonde latence (T5) |
| **Schéma idempotent** | `server/src/db/ensure-db.ts` | `ENSURE_DB_SQL` (un seul template, `CREATE TABLE IF NOT EXISTS` + `ALTER … ADD COLUMN IF NOT EXISTS`) | 5 tables additives (T0) |
| **QG React** | `src/dashboard/CommandCenter.tsx` (2957 l.), `api.ts` (254 l.), `components/` | UI QG servie à `/qg` | étendu par vues (T10–T13) |
| **Harness pré-prod** | `scripts/qg_preprod_test.py` (stdlib, 335 l.) | tests API QG | étendu (T14) |

**Conséquence directe** : R1 (voir/éditer la config par agence) et R2 (persistance versionnée par
tenant, isolation, round-trip, rollback) sont **substantiellement livrés** par
`tenant-config.service` + `command-center.routes`. Reste un **écart R1.4/R1.5/R1.6** : l'override
actuel porte branding/personality/contact/messages mais **pas `model` ni `temperature`**. Cet écart
est traité par une extension additive du Store (voir T9 / §4.7), sans casser le round-trip existant.

---

## 3. Architecture cible (additive)

```
                         ┌───────────────────────── /qg (React, servi en prod) ─────────────────────────┐
                         │ CommandCenter.tsx  +  src/dashboard/views/{Crm,Billing,Provisioning,Settings} │
                         └───────────────┬───────────────────────────────────────────────────────────────┘
                                         │ fetch (cookie admin_session + X-CSRF-Token)
                                         ▼
  PUBLIC (raw-body, signé)        ┌──────────────────── Express (server/src/index.ts) ───────────────────┐
  POST /api/billing/webhook ─────►│  headers → cors → [Better Auth] → [Stripe webhook RAW] →             │
   (AVANT express.json)           │  express.json → pino → rateLimit → routes                            │
                                  │                                                                      │
   /api/priv/* (gated)            │  tenantRoutes · tenantCrmRoutes · billingRoutes(mgmt) · rgpdRoutes ·  │
                                  │  metricsRoutes · redeployRoutes   (+ command-center.routes existant) │
                                  │                                                                      │
   /api/chat (widget JWT)         │  ChatService.processMessage  ── garde tenant servable (R19.4)        │
                                  │     + paywall over-quota (R18.4) + hook lead→CRM tenant (R17.6/7/8)   │
                                  └───────────────┬──────────────────────────────────────────────────────┘
                                                  ▼
            Services nouveaux : crypto · tenant-crm · billing · tenant(provisioning) · audit ·
                                metrics · redeploy · totp        (+ services existants réutilisés)
                                                  ▼
            PostgreSQL : 5 tables additives (T0) + tables auto-créées (totp, redeploy)
            Externe   : CRM par tenant (Twenty/Airtable/webhook) · Stripe (webhook signé)
```

---

## 4. Contrats des nouveaux modules (signatures + shapes)

> Toutes les signatures ci-dessous sont des **contrats**. Les implémentations respectent les
> principes §1 (jamais de 500, jamais de secret en sortie, dégradation propre).

### 4.0 `server/src/utils/crypto.ts` — chiffrement AES-256-GCM (T0)

```ts
/** True si APP_ENCRYPTION_KEY est exploitable (64 hex). */
export function isEncryptionConfigured(): boolean;

/** Chiffre un secret. Retour = base64( iv(12) || authTag(16) || ciphertext ). */
export function encryptSecret(plaintext: string): string;

/** Déchiffre un blob produit par encryptSecret. Lève si clé absente/altération. */
export function decryptSecret(blob: string): string;

/** Helpers JSON (sérialise puis chiffre / déchiffre puis parse). */
export function encryptJson(value: unknown): string;
export function decryptJson<T = unknown>(blob: string): T;
```

- **Clé** : `APP_ENCRYPTION_KEY` = 64 hex (32 octets). Algo `aes-256-gcm`, IV aléatoire 12 octets, tag 16 octets.
- **Prod sans clé** → `encryptSecret`/`decryptSecret` **lèvent** (R17.9). Les appelants attrapent et renvoient une erreur non-secrète (« chiffrement non configuré »), **jamais** de stockage en clair.
- **Dev sans clé** → clé dérivée déterministe (constante de dev) + `warn` une fois ; jamais en prod.
- **Jamais** de log du plaintext ni de la clé. Fonctions pures (hors lecture env), testables.

### 4.1 `server/src/services/tenant-crm.service.ts` + `routes/tenant-crm.routes.ts` — CRM par agence (T1, R17)

```ts
export type TenantCrmProvider = 'none' | 'twenty' | 'airtable' | 'webhook';

/** Mapping champs canoniques → champs provider (R17.4). */
export interface TenantCrmFieldMapping {
  firstName?: string; lastName?: string; phone?: string; email?: string;
  need?: string; qualification?: string; notes?: string;
}

/** Shape PUBLIC renvoyé par l'API — AUCUN secret (R17.3). */
export interface TenantCrmConfigPublic {
  tenantId: string;
  provider: TenantCrmProvider;
  enabled: boolean;
  hasCredentials: boolean;          // booléen seulement, jamais la valeur
  fieldMappings: TenantCrmFieldMapping;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Secrets en clair UNIQUEMENT en mémoire (entrée de save). Chiffrés au repos. */
export interface TenantCrmSecretsInput {
  // twenty:   { apiUrl, apiKey }
  // airtable: { webhookUrl }
  // webhook:  { url, secret?, headerName? }
  [k: string]: string | undefined;
}

export async function getTenantCrmConfig(tenantId: string): Promise<TenantCrmConfigPublic>;

export async function saveTenantCrmConfig(
  tenantId: string,
  input: { provider: TenantCrmProvider; enabled: boolean;
           fieldMappings?: TenantCrmFieldMapping; secrets?: TenantCrmSecretsInput },
  updatedBy: string | null,
): Promise<TenantCrmConfigPublic>;

/** Test connexion → succès/échec + message NON secret (R17.5). */
export async function testTenantCrmConnection(
  tenantId: string,
): Promise<{ ok: boolean; message: string }>;

/**
 * Point d'entrée du hook runtime (T6). 
 *  - handled=false  → pas de config tenant active → l'appelant garde le push GLOBAL (inchangé, R17.7)
 *  - handled=true   → ce tenant pilote son CRM ; result = issue du push (jamais de double push)
 * Ne lève JAMAIS : toute erreur est attrapée, auditée (PII-safe, R17.8), et renvoyée dans result.
 */
export async function pushLeadForTenant(
  tenantId: string, lead: CdmLead, sessionId: string,
): Promise<{ handled: boolean; result?: CrmPushResult }>;

/** Construit un connecteur par tenant en RÉUTILISANT les classes existantes. */
export function buildTenantConnector(
  provider: TenantCrmProvider,
  secrets: TenantCrmSecretsInput,
  fieldMappings: TenantCrmFieldMapping,
): CRMConnector | null;
```

- **Réutilisation sans duplication** : `buildTenantConnector` mappe les creds déchiffrés vers un
  `CrmProviderConfig` puis instancie `new TwentyConnector(cfg)` / `new AirtableConnector(cfg)`
  (constructeurs existants). Le provider **`webhook`** = nouvelle classe **fine** `WebhookConnector`
  (implémente `CRMConnector`) : `pushLead` POST le payload mappé en JSON vers `url`, avec en-tête
  secret optionnel ; opérations granulaires non supportées (comme Airtable webhook).
- **Stockage** : table `tenant_crm_configs` ; `config_encrypted` = `encryptJson(secrets)` ;
  `field_mappings` JSONB ; `provider`, `enabled`. **Jamais** de secret en clair.
- **Routes** (`/api/priv`, gated) :
  - `GET  /tenants/:tenantId/crm` → `TenantCrmConfigPublic`
  - `PUT  /tenants/:tenantId/crm` (CSRF) → `saveTenantCrmConfig`
  - `POST /tenants/:tenantId/crm/test` (CSRF) → `testTenantCrmConnection`
  - Pas de collision avec `command-center.routes` (`/config`) : chemins distincts (`/crm`).

### 4.2 `server/src/services/billing.service.ts` (+ `routes/billing.routes.ts`, `middleware/quota.middleware.ts`) — Facturation & quotas (T2, R18)

```ts
export const BILLING_ENABLED: boolean;                 // env, défaut false (R18.2)
export type PlanId = 'starter' | 'pro' | 'scale';
export type UsageKind = 'message' | 'lead' | 'conversation';
export type SubscriptionStatus =
  'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none';

export interface PlanDef {
  id: PlanId; priceEur: number;
  quotas: Record<UsageKind, number>;                   // configurable
  stripePriceId?: string;
}
export function getPlans(): PlanDef[];                  // starter 99 / pro 299 / scale 799 (défauts)
export function getPlan(id: PlanId): PlanDef;

/** No-op si !BILLING_ENABLED ; ne lève JAMAIS (best-effort). */
export async function recordUsage(tenantId: string, kind: UsageKind, qty?: number): Promise<void>;

export async function getTenantUsage(
  tenantId: string, period?: { from: Date; to: Date },
): Promise<Record<UsageKind, number>>;

/** false si !BILLING_ENABLED. */
export async function isOverQuota(tenantId: string, kind: UsageKind): Promise<boolean>;

export interface QuotaStatus {
  plan: PlanId; status: SubscriptionStatus;
  usage: Record<UsageKind, number>; quota: Record<UsageKind, number>;
  overQuota: boolean;
}
export async function getQuotaStatus(tenantId: string): Promise<QuotaStatus>;

export interface SubscriptionPublic {                  // sans secret (R18.7)
  tenantId: string; plan: PlanId; status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;                     // id non secret ; clés API jamais exposées
}
export async function getSubscription(tenantId: string): Promise<SubscriptionPublic | null>;

/** Vérifie la signature Stripe (HMAC) et met à jour l'abonnement (R18.5). */
export async function handleStripeWebhook(
  rawBody: Buffer, signatureHeader: string,
): Promise<{ ok: boolean; type?: string }>;

/** Handler Express PUBLIC exporté — monté AVANT express.json avec express.raw. */
export function stripeWebhookHandler(req: Request, res: Response): Promise<void>;
```

```ts
// middleware/quota.middleware.ts — pour endpoints REST éventuels (optionnel)
export function enforceQuota(kind: UsageKind): RequestHandler; // 402 si over-quota & BILLING_ENABLED, sinon next()
```

- **Vérification Stripe SANS nouvelle dépendance** : la signature `Stripe-Signature`
  (`t=…,v1=…`) est validée par HMAC-SHA256 (`node:crypto`) sur `${t}.${payload}` avec
  `STRIPE_WEBHOOK_SECRET`, avec tolérance d'horloge. Évite d'ajouter le SDK `stripe` et la contention
  sur `package.json`. (Si des appels API Stripe sortants deviennent nécessaires plus tard, le SDK
  sera ajouté via la tâche dépendances — hors scope « désactivé par défaut ».)
- **Paywall (R18.4)** : pour le widget, le paywall est rendu **côté chat** (T6) — le bot répond un
  message clair sans appeler le LLM quand `BILLING_ENABLED && isOverQuota`. `quota.middleware` sert
  les futurs endpoints REST.
- **Tables** : `usage_events` (append, par tenant), `tenant_subscriptions` (1 ligne/tenant).
- **Routes mgmt** (`/api/priv`, gated) : `GET /billing/plans`, `GET /tenants/:id/billing`
  (`QuotaStatus` + `SubscriptionPublic`), `PUT /tenants/:id/billing/plan` (CSRF, audité R18.7).
  Le **webhook n'est PAS ici** (route publique séparée, §6).

### 4.3 `server/src/services/tenant.service.ts` + `routes/tenant.routes.ts` — Provisioning (T3, R19)

```ts
export type TenantStatus = 'active' | 'suspended' | 'archived';

export interface TenantRecord {
  tenantId: string; name: string; widgetId: string;
  status: TenantStatus; plan: PlanId;
  createdAt: string; updatedAt: string;
}

export async function listTenants(): Promise<TenantRecord[]>;            // (R19.6) sans secret
export async function getTenant(tenantId: string): Promise<TenantRecord | null>;
export async function getTenantByWidgetId(widgetId: string): Promise<TenantRecord | null>;

export function generateWidgetId(): string;                             // crypto.randomBytes, url-safe, unique
export function buildEmbedSnippet(widgetId: string, baseUrl: string): string;

/** Crée le Tenant + widget_id + snippet (R19.1/19.2). */
export async function provisionTenant(input: {
  name: string; plan?: PlanId; tenantId?: string;
}): Promise<{ tenant: TenantRecord; embedSnippet: string }>;

/** suspend / réactive / archive (R19.3/19.5) — audité par l'appelant. */
export async function setTenantStatus(
  tenantId: string, status: TenantStatus, actor: string | null,
): Promise<TenantRecord>;

/**
 * Garde de service (R19.4). FAIL-OPEN :
 *  - ligne absente (tenant historique non provisionné) → true (comportement actuel préservé)
 *  - erreur DB → true (le chat ne casse jamais)
 *  - SEULS status 'suspended'/'archived' explicites → false
 * Caché (TTL court).
 */
export async function isTenantServable(tenantId: string): Promise<boolean>;
```

- **Table** : `tenants` (`widget_id` UNIQUE).
- **Résolution widget→tenant (R19.2)** : `widget-auth.ts` est **étendu additivement** pour, lorsque
  `widget_id` n'est pas dans `WIDGET_TENANT_MAP`, consulter `getTenantByWidgetId()` (la map env
  garde la priorité → zéro régression). C'est le **seul** fichier partagé touché par T3 ; changement
  minimal et additif.
- **Snippet** : `buildEmbedSnippet` retourne un `<script>`/`<iframe>` pointant
  `"/embed?widget_id=…"` (page `/embed` existante), paramétré par `widgetId`.
- **Routes** (`/api/priv`, gated) : `GET /tenants`, `POST /tenants/provision` (CSRF),
  `POST /tenants/:id/status` (CSRF), `GET /tenants/:id`. Super-admin uniquement (R19.7).

### 4.4 `server/src/services/audit.service.ts` + `routes/rgpd.routes.ts` — Audit & RGPD (T4, R5 + RGPD)

```ts
export type AuditAction =
  | 'tenant_config.save' | 'redeploy.init' | 'redeploy.result' | 'config.rollback'
  | 'auth.login' | 'auth.key_fail' | 'auth.totp_fail' | 'auth.totp_enroll'
  | 'auth.totp_reset' | 'auth.break_glass'
  | 'crm.config_save' | 'crm.push_fail'
  | 'billing.change' | 'tenant.provision' | 'tenant.status'
  | 'rgpd.export' | 'rgpd.delete' | (string & {});

export interface AuditEntryInput {
  actor: string | null; action: AuditAction;
  targetType?: string; targetId?: string;
  meta?: Record<string, unknown>;        // nettoyé : clés sensibles supprimées, valeurs tronquées
}

/** Append-only ; ne lève JAMAIS (R5.4/R5.5). */
export async function appendAudit(input: AuditEntryInput): Promise<void>;

export interface AuditEntry extends Required<Pick<AuditEntryInput,'action'>> {
  id: string; actor: string | null; targetType: string | null;
  targetId: string | null; meta: Record<string, unknown>; createdAt: string;
}
export async function listAudit(
  opts?: { limit?: number; action?: AuditAction; targetId?: string },
): Promise<AuditEntry[]>;
```

- **Table** : `audit_log` (BIGSERIAL, append-only — le service n'expose **ni UPDATE ni DELETE**).
- **PII/secret-safe** : `appendAudit` filtre les clés `meta` qui matchent un regex sensible
  (`secret|token|key|password|…`) et tronque les longues valeurs.
- **RGPD routes** (`/api/priv`, gated) : `GET /tenants/:id/rgpd/export` (export JSON leads +
  conversations du tenant, audité) ; `DELETE /tenants/:id/rgpd` (CSRF + double confirmation,
  soft-anonymisation par défaut, audité).

### 4.5 `server/src/services/metrics.service.ts` — Métriques réelles & latence (T5, R6/R7)

```ts
export interface BotMetrics {
  tenantId: string;
  messageCount: number;            // depuis messages partitionné par tenant_id (R6.2)
  measuredLatencyMs: number | null;// sonde active ; null si timeout (R6.4/R6.5/R7.4)
  responseRate: number;            // % réponses bot / messages user dans la fenêtre, borné 0..100 (R6.3)
  lastActivityAt: string | null;   // MAX(messages.created_at) ; null si aucune (R6.6)
  hostingLocation: string;         // métadonnée infra, sans secret (R6.7)
}

export async function getBotMetrics(tenantId: string): Promise<BotMetrics>;
export async function getFleetMetrics(tenantIds?: string[]): Promise<BotMetrics[]>;

/** Sonde HTTP réelle, time-boxée (réutilise le patron de cloudflare.service.pingWorker). */
export async function probeLatency(url: string, timeoutMs?: number): Promise<number | null>;
```

- **Lecture seule** sur tables existantes + ping réseau borné (`AbortSignal.timeout`).
- **Intégration (R7)** : `surveillance.service.ts` est **étendu additivement** pour remplacer le
  pseudo-ping (dérivé du nom) par `metrics.probeLatency`, et exposer `BotMetrics` dans le snapshot
  `/api/priv/surveillance` (déjà servi). Un endpoint dédié `GET /api/priv/tenants/:id/metrics` est
  ajouté via `routes/metrics.routes.ts` (T5) pour R6.1.

### 4.6 `server/src/services/redeploy.service.ts` (+ `routes/redeploy.routes.ts`) — Redéploiement contrôlé (T9, R3/R4)

```ts
export type RedeployStatus = 'pending'|'in_progress'|'succeeded'|'failed'|'rolled_back';

export interface RedeployState {
  tenantId: string; status: RedeployStatus;
  configVersion: number | null;     // version visée
  activeVersion: number | null;     // version réellement active/servie (R4.2)
  startedAt: string | null; finishedAt: string | null; error?: string;
}

export async function getActiveConfigVersion(tenantId: string): Promise<number | null>;
export async function getRedeployState(tenantId: string): Promise<RedeployState>;
export function isOutOfDate(active: number | null, latest: number | null): boolean; // R4.3

/**
 * Applique la dernière version sauvegardée comme Effective_Config (R3.1) :
 *  - single-flight par tenant : 2e appel concurrent rejeté (R3.3)
 *  - in_progress → succeeded (R3.2/3.4) ; échec → restore version précédente → rolled_back (R3.6)
 *  - n'affecte QUE ce tenant (R3.5) ; audité à l'init et au résultat (R5.2)
 *  - "appliquer" = invalider le cache tenant-config (1 process partagé ⇒ reload, pas restart) — cf. ADR_0002
 */
export async function requestRedeploy(tenantId: string, actor: string | null): Promise<RedeployState>;
```

- **Stockage** : table `tenant_redeploys` **auto-créée** par le service (`CREATE TABLE IF NOT EXISTS`,
  patron `crm_pushed_leads`) → pas de dépendance au fichier `ensure-db.ts` (T0) ni à
  `tenant-config.service` (évite la contention).
- **Reload runtime** : appelle un `resetTenantConfigCache()` ciblé (à exposer additivement dans
  `tenant-config.service`) → le prochain message recharge l'override (le hook
  `getEffectiveIdentityPromptBlock` est déjà en place).
- **Routes** : `POST /api/priv/tenants/:id/redeploy` (CSRF + confirmation R3.8), `GET …/redeploy`.

### 4.7 Écart R1 (model/temperature) — extension additive du Store

`tenant-config.service` est étendu (additif, rétrocompatible) pour accepter dans l'override un sous-
objet **non secret** `runtime?: { model?: string; temperature?: number }` :
- `sanitizeOverride` valide `temperature ∈ [0,2]` (R1.5) et `model ∈ provider models` (R1.6) ; sinon
  champ **droppé** (jamais d'injection).
- Round-trip (R2.5) préservé : les champs existants ne bougent pas ; `runtime` est purement additif.
- Effective_Config (R1.1/R2.6) : le QG superpose `runtime` sur `Global_Config` (défauts `.env`).

### 4.8 `server/src/services/totp.service.ts` + extension login — TOTP / 2-step (T7, R11–R14)

```ts
export interface TotpStatus { enrolled: boolean; }
export async function getTotpStatus(): Promise<TotpStatus>;

/** Démarre l'enrôlement : secret + otpauth URI rendus UNE fois (R12.2/R14.2). */
export async function beginEnrollment(): Promise<{ secret: string; otpauthUri: string }>;

/** Active si le code correspond ; émet des recovery codes une seule fois (R12.3/12.5). */
export async function activateEnrollment(
  code: string,
): Promise<{ ok: boolean; recoveryCodes?: string[]; error?: string }>;

export async function verifyTotp(code: string): Promise<boolean>;        // fenêtre RFC6238 (R11.4)
export async function consumeRecoveryCode(code: string): Promise<boolean>;// usage unique (R14.3/14.6)
export async function resetTotp(reverify: { code?: string; recoveryCode?: string }): Promise<{ ok: boolean }>;

export function isBreakGlass(value: string): boolean;                     // compare ADMIN_BREAK_GLASS (temps constant, R14.4)
export async function recordFailedAttempt(): Promise<void>;               // verrouillage (R11.7)
export async function isLockedOut(): Promise<boolean>;
```

- **Aucune nouvelle dépendance** : TOTP implémenté avec `node:crypto` (HMAC-SHA1, RFC 6238) + décodage
  base32 ; recovery codes **hachés** (sha256) au repos ; **secret TOTP chiffré** via `crypto.ts`
  (`APP_ENCRYPTION_KEY`) et **stocké côté serveur uniquement** (R14.1).
- **Tables auto-créées** par le service : `admin_totp` (1 ligne) + `admin_recovery_codes` (patron
  `crm_pushed_leads`) → pas de modif de `ensure-db.ts` (T0), ownership disjoint.
- **Intégration login** (modif additive de `routes/admin.routes.ts`, owner T7) :
  - `POST /api/admin/session` : étape 1 `ADMIN_API_KEY` (inchangée) → si TOTP enrôlé, **exiger** un
    code TOTP **avant** `signAdminSessionToken()` (R11.2/11.3). Si non enrôlé → diriger vers
    l'enrôlement (R12.1).
  - Nouveaux endpoints `POST /api/admin/totp/{begin,activate,verify,reset}` (gated/CSRF selon étape).
  - Audit des événements auth (R5.6).

### 4.9 Hook runtime `chat.service.ts` (T6, R17.6/7/8 + R18.3/4 + R19.4)

Modifications **strictement additives**, toutes gardées (try/catch, fail-open) — **la logique de
compréhension/qualification/LLM n'est pas touchée**.

1. **Début de `processMessage`** (avant tout traitement) :
   ```ts
   // R19.4 — tenant suspendu/archivé : réponse désactivée (fail-open si absent/erreur)
   if (!(await isTenantServable(effectiveTenantId))) return disabledResponse(sessionId);
   // R18.4 — paywall over-quota (no-op si billing off)
   if (BILLING_ENABLED && (await isOverQuota(effectiveTenantId, 'message')))
     return paywallResponse(sessionId);
   ```
2. **Au point de push existant** (étape 8, `isComplete && score >= minScore`) :
   ```ts
   const { handled, result } = await pushLeadForTenant(effectiveTenantId, cdmLead, sessionId);
   if (!handled) { /* push GLOBAL existant inchangé : getCRMConnector().pushLead(...) */ }
   pushedToCRM = handled ? !!result?.success : pushedToCRM;
   await recordUsage(effectiveTenantId, 'lead');   // no-op si billing off
   ```
3. `recordUsage(tenantId, 'message' | 'conversation')` après traitement réussi.

`disabledResponse`/`paywallResponse` sont des `ChatResponse` déterministes (pas d'appel LLM, pas de
500). Toute exception des nouveaux appels est avalée → le chat continue comme aujourd'hui.

---

## 5. Modèle d'authentification unifié (passkey + TOTP + break-glass)

Aujourd'hui, **deux** chemins de login émettent les **mêmes** cookies (`admin_session` HS256 30 min +
`csrf_token` double-submit) via `signAdminSessionToken()` :

```
(1) POST /api/admin/session         : ADMIN_API_KEY (compare temps constant)        ─┐
(2) POST /api/admin/passkey/auth/*  : WebAuthn (userVerification: 'required')        ─┤→ admin_session + csrf
                                                                                      │
better-auth /api/auth/* (twoFactor) : multi-utilisateur OPTIONNEL (R15)              ─┘ (séparé, guardé)
```

**Décision de réconciliation (sans casser le login actuel)** :

| Chemin | Facteurs | Politique v2.1 |
|---|---|---|
| **Access_Key** `POST /session` | possession clé partagée | **+ TOTP obligatoire** dès qu'un secret TOTP est enrôlé (R11). Sans TOTP enrôlé → flux d'enrôlement (R12.1). |
| **Passkey** | possession appareil + **vérification utilisateur** (biométrie/PIN) | **Auth forte équivalente** (phishing-resistant) — **inchangé**. Reste le chemin recommandé. |
| **Break-glass** | `ADMIN_BREAK_GLASS` (env dédié, ≠ ADMIN_API_KEY) | autorise une session **sans TOTP** uniquement si présenté (R14.4), **audité**. |
| **Recovery code** | code usage unique | substitut au TOTP (R14.3). |
| **Multi-user (R15)** | identité/passe + TOTP | via better-auth si activé (option, hors baseline). |

- Le secret de session, sa résolution (`resolveAdminSessionSecret`) et le CSRF **ne changent pas**.
- TOTP s'insère **avant** l'émission de session sur le chemin Access_Key, sans toucher le chemin
  passkey (qui satisfait déjà « 2 facteurs » par possession + inhérence).
- `Settings_Area` (R13) côté QG : statut TOTP, enrôlement/reset (CSRF + ré-vérif), allowlist IP en
  vigueur, timeout session, accès Audit_Log, guidance rotation clé — **sans jamais** rendre un secret.

---

## 6. Montage des routes (`server/src/index.ts`, T0)

Ordre **impératif** (le webhook Stripe a besoin du corps brut) :

```ts
// … headers → cors → (Better Auth déjà monté ici, avant express.json) …

// ⬇️ AVANT express.json : webhook Stripe PUBLIC, corps brut, signature vérifiée (R18.5)
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => stripeWebhookHandler(req, res),   // import gardé (try/catch) comme Better Auth
);

app.use(express.json({ limit: '1mb' }));          // (existant, inchangé)
// … pino → rateLimit('/api/') …

// ⬇️ APRÈS express.json : routers de gestion, gated comme l'existant (adminIpAllowlist + requireAdminSession par route)
app.use('/api/priv', adminIpAllowlist(), tenantRoutes);
app.use('/api/priv', adminIpAllowlist(), tenantCrmRoutes);
app.use('/api/priv', adminIpAllowlist(), billingRoutes);   // mgmt seulement (pas le webhook)
app.use('/api/priv', adminIpAllowlist(), rgpdRoutes);
app.use('/api/priv', adminIpAllowlist(), metricsRoutes);
app.use('/api/priv', adminIpAllowlist(), redeployRoutes);
// command-center.routes (existant) reste monté ; plusieurs routers sur /api/priv = OK
```

- Chaque nouveau router applique `requireAdminSession()` (lecture) et `+ requireCSRF()` (mutation)
  **par route**, comme `command-center.routes`.
- Le webhook public ne porte aucune session : sa sécurité = **signature** (échec → 400, aucun effet).
- Import gardé : si un module billing/tenant est absent au boot, on log et on continue (jamais de
  crash de démarrage — patron Better Auth existant).

---

## 7. Schéma de base de données (additif)

**T0** ajoute 5 tables business à `ENSURE_DB_SQL` (idempotent, `CREATE TABLE IF NOT EXISTS`) :

```sql
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id   VARCHAR(100) PRIMARY KEY,
  name        VARCHAR(160) NOT NULL,
  widget_id   VARCHAR(128) UNIQUE NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','suspended','archived')),
  plan        VARCHAR(20)  NOT NULL DEFAULT 'starter',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_crm_configs (
  tenant_id        VARCHAR(100) PRIMARY KEY,
  provider         VARCHAR(20) NOT NULL DEFAULT 'none'
                   CHECK (provider IN ('none','twenty','airtable','webhook')),
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  config_encrypted TEXT,                  -- encryptJson(secrets) — JAMAIS en clair
  field_mappings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_by       VARCHAR(120)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id            VARCHAR(100) PRIMARY KEY,
  stripe_customer_id   VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan                 VARCHAR(20) NOT NULL DEFAULT 'starter',
  status               VARCHAR(30) NOT NULL DEFAULT 'none',
  current_period_end   TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  VARCHAR(100) NOT NULL,
  kind       VARCHAR(20)  NOT NULL,        -- message | lead | conversation
  qty        INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created ON usage_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       VARCHAR(160),
  action      VARCHAR(80) NOT NULL,
  target_type VARCHAR(60),
  target_id   VARCHAR(160),
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- PII/secret-free
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
```

**Auto-créées par leur service** (patron `crm_pushed_leads`, hors `ensure-db.ts`) : `admin_totp`,
`admin_recovery_codes` (T7), `tenant_redeploys` (T9). Rationale : garder l'ownership disjoint pour le
parallélisme et respecter le « 5 tables » du PLAN pour T0.

---

## 8. Modèle de sécurité (synthèse)

| Surface | Contrôle |
|---|---|
| Mutations `/api/priv/*` | `requireAdminSession()` + `requireCSRF()` (double-submit) |
| Lectures `/api/priv/*` | `requireAdminSession()`, `Cache-Control: no-store` |
| Webhook Stripe | **public**, corps brut, **signature HMAC** vérifiée ; échec → 400 sans effet |
| Secrets CRM par tenant | **AES-256-GCM** (`crypto.ts`) ; jamais en clair, jamais en réponse (`hasCredentials`) |
| Secret TOTP | chiffré au repos, **jamais** renvoyé après activation (R14.1) ; recovery codes hachés |
| Réponses API | shapes **publics** sans secret ; masquage déjà en place côté infra |
| Audit | append-only, `meta` filtrée (PII/secret), sans valeurs d'auth (R5.5/5.6) |
| Chat hot-path | gardes fail-open ; **jamais de 500** ; logique LLM/qualif intacte |
| Prod sans `APP_ENCRYPTION_KEY` | refus de manipuler les secrets CRM (R17.9) |
| Webhook tester (R9) | garde SSRF existante (`utils/ssrf-guard`) + scheme http/https + no-redirect cross-host + `.snyk` justifié/allowlist |

---

## 9. Décision sur `CommandCenter.tsx` (2957 lignes) — avec évaluation du risque

**Contexte** : `src/dashboard/CommandCenter.tsx` fait **2957 lignes**. C'est le point de contention
des tâches UI (T10 CRM, T11 Billing, T12 Provisioning, T13 Settings/métriques).

**Options évaluées** :

| Option | Risque | Verdict |
|---|---|---|
| A. Extraction big-bang des vues existantes en `views/*.tsx` en Vague 0 | **ÉLEVÉ** : refactor massif d'un fichier de 2957 l. avant toute feature → casse probable du build / état / props, viole « ne rien casser » | ❌ rejeté |
| B. Plusieurs agents éditent `CommandCenter.tsx` en parallèle | **ÉLEVÉ** : conflits de merge garantis sur un seul gros fichier | ❌ rejeté |
| **C. Hybride (retenu)** | **FAIBLE** | ✅ **choisi** |

**Décision C (hybride)** :
1. **Un seul propriétaire sérialisé** (« QG-front ») touche `CommandCenter.tsx` ; T10→T13 sont
   **sérialisées** pour ce fichier précis.
2. Chaque feature UI est écrite dans un **nouveau fichier disjoint** sous
   `src/dashboard/views/` : `CrmView.tsx`, `BillingView.tsx`, `ProvisioningView.tsx`,
   `SettingsView.tsx`. Ces fichiers sont **parallélisables** (ownership disjoint).
3. L'intégration dans `CommandCenter.tsx` se réduit à de **petites lignes additives**
   (import + montage d'un onglet/section) appliquées en **un seul passage sérialisé** par le
   propriétaire QG-front.
4. `src/dashboard/api.ts` (254 l.) : les nouveaux appels sont **découpés** en modules
   `src/dashboard/api/{crm,billing,provisioning,settings}.ts` **ré-exportés** par `api.ts` (une ligne
   chacun, sérialisée) → parallélisme + faible contention.

**Bénéfice** : le gros fichier ne reçoit que des touches minimales (faible risque de casse/merge),
l'essentiel de chaque feature vit dans des fichiers neufs construits en parallèle.

---

## 10. Correspondance Requirement → Composant

| Req | Couverture | Composant(s) | Tâche |
|---|---|---|---|
| **R1** Voir/éditer config agence | Livré (écart model/temp) | `tenant-config.service` (+ extension `runtime`), `command-center.routes` `/config`, vue Chatbots | livré / T9 / T13 |
| **R2** Persistance par tenant (versionnée) | **Livré** | `tenant-config.service` (`saveTenantOverride`, versions, rollback) ; tables `tenant_configs(_versions)` | livré |
| **R3** Redéploiement sûr 1 bot | Nouveau | `redeploy.service` (single-flight, rollback), `routes/redeploy.routes` | T9 |
| **R4** Confirmer version active | Nouveau | `redeploy.service` (`getActiveConfigVersion`, `isOutOfDate`) | T9 |
| **R5** Audit actions | Nouveau | `audit.service` (append-only) ; intégré par T1/T2/T3/T7/T9 | T4 (+ appels) |
| **R6** Métriques réelles | Nouveau | `metrics.service` (`getBotMetrics`) | T5 |
| **R7** Latence mesurée | Nouveau | `metrics.probeLatency` + `surveillance.service` (additif) | T5 |
| **R8** Activity feed / logs | Partiel→étendu | `surveillance.service` (feed PII-free), `audit_log` | T5 (+ T13 UI) |
| **R9** SSRF webhook tester | Durcissement | handler `POST /api/factory/test/webhook` + `utils/ssrf-guard` | T8 |
| **R10** Deps HIGH | Durcissement | `package.json`/lock | T8 |
| **R11** 2-step (clé + TOTP) | Nouveau | `totp.service`, `admin.routes` `/session` (gate), `admin-session` | T7 |
| **R12** Enrôlement TOTP | Nouveau | `totp.service` (begin/activate), `Settings_Area` | T7 (+ T13 UI) |
| **R13** Settings area | Nouveau | `SettingsView.tsx`, endpoints status/reset | T13 (+ T7 API) |
| **R14** Protection secret + recovery | Nouveau | `totp.service` (chiffré, recovery codes), `crypto.ts` | T7 |
| **R15** Multi-user (option) | Existant (option) | `auth/auth.ts` (better-auth twoFactor) | doc / option |
| **R16** UI polish | Nouveau | vues QG (indicateurs in-progress/out-of-date/erreurs) | T10–T13 |
| **R17** CRM par agence chiffré | Nouveau | `crypto.ts`, `tenant-crm.service`, `WebhookConnector`, hook chat | T0/T1/T6 |
| **R18** Facturation & quotas | Nouveau | `billing.service`, webhook Stripe, `quota.middleware`, hook chat | T0/T2/T6 |
| **R19** Provisioning agences | Nouveau | `tenant.service`, `tenant.routes`, garde `widget-auth`/chat | T0/T3/T6 |

---

## 11. Stratégie de test & « definition of done »

- **Unitaire (vitest, `server/src/**/__tests__`)** : `crypto` (round-trip, falsification, sans clé) ;
  `tenant-crm` (sanitize/no-secret-out, fallback global, mapping) ; `billing` (no-op si off, métering,
  quota, **vérif signature** webhook ok/ko) ; `tenant` (`isTenantServable` fail-open, widget_id
  unique, snippet) ; `audit` (append-only, meta filtrée) ; `metrics` (responseRate borné, latence
  null si timeout) ; `redeploy` (single-flight, rollback) ; `totp` (RFC6238, recovery usage unique,
  lockout, break-glass).
- **Harness API (`scripts/qg_preprod_test.py`)** étendu : CRM (GET/PUT/test, **aucun secret** dans la
  réponse), billing (plans, statut tenant), provisioning (provision → snippet, status → 403 widget),
  TOTP (status), webhook Stripe (signature invalide → 400). **Aucun 500.**
- **DoD par tâche** : `cd server && npx tsc --noEmit` (exit 0) ; `npx vitest run <ciblé>` vert ;
  `npm run build` (racine) OK ; si l'API change, harness Python vert. `main` reste déployable.

---

## 12. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Casser le chat en ajoutant les hooks (T6) | Gardes try/catch fail-open ; aucune ligne de la logique LLM/qualif modifiée ; tests de non-régression chat |
| Double push CRM (tenant + global) | `pushLeadForTenant` renvoie `handled` ; un seul chemin pris |
| Régression tenants historiques (provisioning) | `isTenantServable` fail-open (ligne absente = actif) ; `WIDGET_TENANT_MAP` garde la priorité |
| Contention `CommandCenter.tsx` / `api.ts` | Décision §9 (vues neuves + intégration sérialisée) |
| Webhook Stripe + body parser | Monté **avant** `express.json` avec `express.raw` (patron Better Auth) |
| Nouvelle dépendance (Stripe/TOTP) cassant les deps | Implémentations `node:crypto` (HMAC) → **aucune** nouvelle dépendance runtime |
| Contention `ensure-db.ts` (T0) vs T7/T9 | TOTP/redeploy auto-créent leurs tables dans leur service |
| Secret en clair / loggé | `crypto.ts` au repos ; shapes publics ; audit filtré ; prod refuse sans clé |
