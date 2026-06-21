// ============================================================================
// billing.service.ts — Billing & quotas (Stripe) — R18, Wave 1 / T2
// ============================================================================
// ADDITIVE. The whole feature is inert unless BILLING_ENABLED=true:
//   - recordUsage()  → NO-OP (never writes, never throws)
//   - isOverQuota()  → always false (never blocks a request)
// so enabling/disabling billing is a single env flip with zero behaviour change
// for the chat hot path when it is off.
//
// Stripe webhook signatures are verified MANUALLY with node:crypto (HMAC-SHA256)
// — we deliberately avoid the Stripe SDK here so there is no new dependency and
// no risk of pulling secrets into logs. The PUBLIC raw-body webhook route lives
// in index.ts and lazy-requires stripeWebhookHandler() exported below.
//
// SECURITY:
//   - No secret key (STRIPE_*_SECRET) is ever returned by an API or logged.
//   - The raw webhook body is never logged.
//   - getSubscription() exposes ONLY public, non-secret fields.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db/pool";

// ── Public types ─────────────────────────────────────────────────────────────

export type PlanId = "starter" | "pro" | "scale";
export type UsageKind = "message" | "lead" | "conversation";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "none";

export interface PlanDef {
  id: PlanId;
  priceEur: number;
  quotas: Record<UsageKind, number>;
  stripePriceId?: string;
}

export interface QuotaStatus {
  plan: PlanId;
  status: SubscriptionStatus;
  usage: Record<UsageKind, number>;
  quota: Record<UsageKind, number>;
  overQuota: boolean;
}

export interface SubscriptionPublic {
  tenantId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

// ── Feature flag ─────────────────────────────────────────────────────────────

/**
 * Load-time snapshot of the flag (matches the documented public contract).
 * Runtime functions use billingEnabled() instead so the flag can be toggled in
 * tests / at runtime without re-importing the module. In production the env is
 * fixed at boot, so the two are always identical.
 */
export const BILLING_ENABLED: boolean = readBillingEnabled();

function readBillingEnabled(): boolean {
  return (process.env.BILLING_ENABLED || "").toLowerCase() === "true";
}

/** Dynamic read so a NO-OP/disabled path is honoured even if env changes. */
function billingEnabled(): boolean {
  return readBillingEnabled();
}

// ── Constants / small helpers ────────────────────────────────────────────────

const PLAN_IDS: readonly PlanId[] = ["starter", "pro", "scale"];
const USAGE_KINDS: readonly UsageKind[] = ["message", "lead", "conversation"];
const STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "none",
];

const TENANT_ID_RE = /^[a-zA-Z0-9_.-]{1,100}$/;
const SIGNATURE_TOLERANCE_SEC = 300; // 5 minutes

function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}
function isUsageKind(v: unknown): v is UsageKind {
  return typeof v === "string" && (USAGE_KINDS as readonly string[]).includes(v);
}
function normalizePlanId(v: unknown): PlanId | null {
  return isPlanId(v) ? v : null;
}
function normalizeStatus(v: unknown): SubscriptionStatus | null {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v)
    ? (v as SubscriptionStatus)
    : null;
}
function isValidTenantId(id: unknown): id is string {
  return typeof id === "string" && TENANT_ID_RE.test(id);
}

/** Non-negative integer env override with a default. */
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}
/** Trimmed non-empty env string, else undefined. */
function envStr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function emptyUsage(): Record<UsageKind, number> {
  return { message: 0, lead: 0, conversation: 0 };
}

/** Current calendar month [from, to) in UTC. Quotas are billed monthly. */
function currentMonthRange(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { from, to };
}

// ── Plans (quotas + price configurable via env, sensible defaults) ───────────

export function getPlans(): PlanDef[] {
  return [
    {
      id: "starter",
      priceEur: envInt("BILLING_PRICE_STARTER_EUR", 99),
      quotas: {
        message: envInt("BILLING_QUOTA_STARTER_MESSAGE", 5000),
        lead: envInt("BILLING_QUOTA_STARTER_LEAD", 200),
        conversation: envInt("BILLING_QUOTA_STARTER_CONVERSATION", 1000),
      },
      stripePriceId: envStr("STRIPE_PRICE_STARTER"),
    },
    {
      id: "pro",
      priceEur: envInt("BILLING_PRICE_PRO_EUR", 299),
      quotas: {
        message: envInt("BILLING_QUOTA_PRO_MESSAGE", 20000),
        lead: envInt("BILLING_QUOTA_PRO_LEAD", 1000),
        conversation: envInt("BILLING_QUOTA_PRO_CONVERSATION", 5000),
      },
      stripePriceId: envStr("STRIPE_PRICE_PRO"),
    },
    {
      id: "scale",
      priceEur: envInt("BILLING_PRICE_SCALE_EUR", 799),
      quotas: {
        message: envInt("BILLING_QUOTA_SCALE_MESSAGE", 100000),
        lead: envInt("BILLING_QUOTA_SCALE_LEAD", 5000),
        conversation: envInt("BILLING_QUOTA_SCALE_CONVERSATION", 25000),
      },
      stripePriceId: envStr("STRIPE_PRICE_SCALE"),
    },
  ];
}

export function getPlan(id: PlanId): PlanDef {
  const plans = getPlans();
  return plans.find((p) => p.id === id) ?? plans[0];
}

// ── Usage metering ───────────────────────────────────────────────────────────

/**
 * Append a usage event. NO-OP when billing is disabled. NEVER throws — a
 * metering hiccup must never break the chat hot path.
 */
export async function recordUsage(
  tenantId: string,
  kind: UsageKind,
  qty: number = 1,
): Promise<void> {
  if (!billingEnabled()) return;
  try {
    if (!isValidTenantId(tenantId) || !isUsageKind(kind)) return;
    const q = Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : 1;
    await pool.query(
      `INSERT INTO usage_events (tenant_id, kind, qty) VALUES ($1, $2, $3)`,
      [tenantId, kind, q],
    );
  } catch {
    /* best-effort: never throw */
  }
}

/**
 * Sum usage per kind for a period (defaults to the current calendar month).
 * Degrades to zeros on any error so callers never throw.
 */
export async function getTenantUsage(
  tenantId: string,
  period?: { from: Date; to: Date },
): Promise<Record<UsageKind, number>> {
  const usage = emptyUsage();
  if (!isValidTenantId(tenantId)) return usage;
  try {
    const { from, to } = period ?? currentMonthRange();
    const r = await pool.query(
      `SELECT kind, COALESCE(SUM(qty), 0) AS total
         FROM usage_events
        WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
        GROUP BY kind`,
      [tenantId, from, to],
    );
    for (const row of r.rows as Array<{ kind: string; total: unknown }>) {
      if (isUsageKind(row.kind)) {
        const n = Number(row.total);
        usage[row.kind] = Number.isFinite(n) ? n : 0;
      }
    }
  } catch {
    /* degrade to zeros */
  }
  return usage;
}

/**
 * True when the tenant has reached/exceeded its plan quota for `kind`.
 * Always false when billing is disabled. NEVER throws (fails open).
 * A quota of 0 (or non-positive) is treated as "unlimited".
 */
export async function isOverQuota(
  tenantId: string,
  kind: UsageKind,
): Promise<boolean> {
  if (!billingEnabled()) return false;
  try {
    if (!isValidTenantId(tenantId) || !isUsageKind(kind)) return false;
    const row = await getSubscriptionRow(tenantId);
    const planId = normalizePlanId(row?.plan) ?? "starter";
    const limit = getPlan(planId).quotas[kind];
    if (!Number.isFinite(limit) || limit <= 0) return false; // unlimited
    const usage = await getTenantUsage(tenantId);
    return usage[kind] >= limit;
  } catch {
    return false; // never block on an internal error
  }
}

export async function getQuotaStatus(tenantId: string): Promise<QuotaStatus> {
  const row = await getSubscriptionRow(tenantId).catch(() => null);
  const plan = normalizePlanId(row?.plan) ?? "starter";
  const status = normalizeStatus(row?.status) ?? "none";
  const quota = getPlan(plan).quotas;
  const usage = await getTenantUsage(tenantId);
  const overQuota = billingEnabled()
    ? USAGE_KINDS.some((k) => quota[k] > 0 && usage[k] >= quota[k])
    : false;
  return { plan, status, usage, quota, overQuota };
}

// ── Subscriptions ────────────────────────────────────────────────────────────

interface SubscriptionRow {
  tenant_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  current_period_end: Date | string | null;
  updated_at: Date | string | null;
}

async function getSubscriptionRow(
  tenantId: string,
): Promise<SubscriptionRow | null> {
  if (!isValidTenantId(tenantId)) return null;
  const r = await pool.query(
    `SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
            plan, status, current_period_end, updated_at
       FROM tenant_subscriptions
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return (r.rows[0] as SubscriptionRow | undefined) ?? null;
}

/** Public (non-secret) subscription view. Returns null when none / on error. */
export async function getSubscription(
  tenantId: string,
): Promise<SubscriptionPublic | null> {
  try {
    const row = await getSubscriptionRow(tenantId);
    if (!row) return null;
    return {
      tenantId,
      plan: normalizePlanId(row.plan) ?? "starter",
      status: normalizeStatus(row.status) ?? "none",
      currentPeriodEnd: row.current_period_end
        ? new Date(row.current_period_end).toISOString()
        : null,
      stripeCustomerId: row.stripe_customer_id ?? null,
    };
  } catch {
    return null;
  }
}

// ── Stripe webhook signature (manual HMAC-SHA256, node:crypto) ───────────────

interface ParsedSignature {
  t: number;
  v1: string[];
}

/** Parse a `Stripe-Signature` header of form `t=TS,v1=SIG[,v1=SIG2...]`. */
function parseStripeSignature(header: string): ParsedSignature | null {
  if (!header || typeof header !== "string") return null;
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t") {
      t = Number(val);
    } else if (key === "v1" && val) {
      v1.push(val);
    }
  }
  if (!Number.isFinite(t) || v1.length === 0) return null;
  return { t, v1 };
}

/**
 * Verify a Stripe webhook signature. Computes
 *   expected = HMAC_SHA256(secret, `${t}.${rawBody}`) (hex)
 * and accepts when ANY provided v1 matches (constant-time, equal-length only).
 * Rejects when the timestamp is outside the tolerance window.
 */
function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  toleranceSec: number = SIGNATURE_TOLERANCE_SEC,
): boolean {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.t) > toleranceSec) return false;

  const signedPayload = `${parsed.t}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const sig of parsed.v1) {
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// ── Stripe event → subscription mapping (best-effort) ────────────────────────

function mapStripeStatus(raw: unknown): SubscriptionStatus {
  switch (String(raw)) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return "none";
  }
}

function extractTenantId(obj: any): string | null {
  const meta = obj?.metadata ?? {};
  const candidates = [meta.tenant_id, meta.tenantId, obj?.client_reference_id];
  for (const c of candidates) {
    if (isValidTenantId(c)) return c;
  }
  return null;
}

function mapPlanFromObject(obj: any): PlanId | null {
  const meta = obj?.metadata ?? {};
  const fromMeta = normalizePlanId(meta.plan ?? meta.plan_id);
  if (fromMeta) return fromMeta;
  const priceId =
    obj?.items?.data?.[0]?.price?.id ?? obj?.plan?.id ?? obj?.price?.id ?? null;
  if (typeof priceId === "string" && priceId) {
    const match = getPlans().find((p) => p.stripePriceId === priceId);
    if (match) return match.id;
  }
  return null;
}

/**
 * Best-effort UPSERT of tenant_subscriptions from a verified Stripe event.
 * Only fills columns we can map; COALESCE keeps existing values otherwise.
 * Skips silently when no tenant id can be resolved from the event metadata.
 */
async function upsertSubscriptionFromEvent(event: any): Promise<void> {
  const type: string = typeof event?.type === "string" ? event.type : "";
  const obj = event?.data?.object ?? {};

  const tenantId = extractTenantId(obj);
  if (!tenantId) return;

  const stripeCustomerId =
    typeof obj?.customer === "string"
      ? obj.customer
      : typeof obj?.customer?.id === "string"
        ? obj.customer.id
        : null;

  const stripeSubscriptionId =
    typeof obj?.subscription === "string"
      ? obj.subscription
      : type.startsWith("customer.subscription.") && typeof obj?.id === "string"
        ? obj.id
        : null;

  const plan = mapPlanFromObject(obj); // may be null → keep existing

  let status: SubscriptionStatus = mapStripeStatus(obj?.status);
  if (type === "checkout.session.completed") {
    // A completed checkout means the plan is paid for; treat as active unless
    // the session explicitly says otherwise.
    if (obj?.payment_status === "paid" || obj?.status === "complete") {
      status = "active";
    }
  }

  const cpe = obj?.current_period_end;
  const currentPeriodEnd =
    typeof cpe === "number" && Number.isFinite(cpe) ? new Date(cpe * 1000) : null;

  // status 'none' must not clobber a real existing status → pass null instead.
  const statusParam = status === "none" ? null : status;

  await pool.query(
    `INSERT INTO tenant_subscriptions
       (tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, 'starter'), COALESCE($5, 'none'), $6, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id, tenant_subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, tenant_subscriptions.stripe_subscription_id),
       plan                   = COALESCE($4, tenant_subscriptions.plan),
       status                 = COALESCE($5, tenant_subscriptions.status),
       current_period_end     = COALESCE(EXCLUDED.current_period_end, tenant_subscriptions.current_period_end),
       updated_at             = NOW()`,
    [tenantId, stripeCustomerId, stripeSubscriptionId, plan, statusParam, currentPeriodEnd],
  );
}

/**
 * Verify + handle a Stripe webhook. Returns { ok:false } (never throws) when
 * the secret is missing, the signature is invalid/stale, or the body is not
 * JSON. On a valid relevant event, best-effort upserts the subscription.
 * NEVER logs the secret or the raw body.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<{ ok: boolean; type?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) return { ok: false };

  const buf = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === "string" ? rawBody : "", "utf8");

  if (!verifyStripeSignature(buf, signatureHeader || "", secret)) {
    return { ok: false };
  }

  let event: any;
  try {
    event = JSON.parse(buf.toString("utf8"));
  } catch {
    return { ok: false };
  }

  const type: string = typeof event?.type === "string" ? event.type : "";

  if (type.startsWith("customer.subscription.") || type === "checkout.session.completed") {
    try {
      await upsertSubscriptionFromEvent(event);
    } catch {
      /* best-effort persistence; the event was still authentic */
    }
  }

  return { ok: true, type: type || undefined };
}

/**
 * Express handler for the PUBLIC raw-body webhook route (mounted in index.ts
 * BEFORE express.json). Reads the raw Buffer body + the `stripe-signature`
 * header. Always answers 200 (valid) or 400 (invalid) — NEVER 500.
 */
export async function stripeWebhookHandler(req: any, res: any): Promise<void> {
  try {
    const rawBody: Buffer = Buffer.isBuffer(req?.body)
      ? req.body
      : Buffer.from(typeof req?.body === "string" ? req.body : "", "utf8");
    const sigHeader = req?.headers?.["stripe-signature"];
    const signature = Array.isArray(sigHeader)
      ? sigHeader[0] || ""
      : typeof sigHeader === "string"
        ? sigHeader
        : "";

    const result = await handleStripeWebhook(rawBody, signature);
    if (result.ok) {
      res.status(200).json({ received: true, type: result.type });
    } else {
      res.status(400).json({ error: "invalid_signature" });
    }
  } catch {
    // Defensive: a webhook must never 500 (Stripe would retry-storm). 400 is safe.
    try {
      res.status(400).json({ error: "invalid_request" });
    } catch {
      /* response already sent */
    }
  }
}
