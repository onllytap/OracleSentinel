// ============================================================================
// billing.service.test.ts — unit tests (vitest, NO live DB)
// ============================================================================
// The pg pool is mocked so nothing touches a real database. We cover:
//   - the disabled-by-default contract (recordUsage no-op / isOverQuota false)
//   - the plan catalogue defaults
//   - manual Stripe webhook signature verification (valid / tampered / stale /
//     missing-secret) using the SAME HMAC scheme the service uses.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// ── Mock the DB pool (no real connection) ───────────────────────────────────
vi.mock("../../db/pool", () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return {
    pool: { query, connect: vi.fn() },
    query,
    isDatabaseConfigured: false,
    assertDatabaseConnection: vi.fn(async () => false),
    resolveDbSslConfig: vi.fn(() => undefined),
  };
});

import {
  recordUsage,
  isOverQuota,
  getPlans,
  getPlan,
  handleStripeWebhook,
} from "../billing.service";
import { pool } from "../../db/pool";

// Build a valid `Stripe-Signature` header for a payload using the documented
// scheme: HMAC_SHA256(secret, `${t}.${rawBody}`) as hex.
function signHeader(secret: string, payload: Buffer, t: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${t}.${payload.toString("utf8")}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${sig}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as any).mockImplementation(async () => ({ rows: [], rowCount: 0 }));

  // Deterministic, billing OFF by default. Remove any ambient overrides.
  process.env.BILLING_ENABLED = "false";
  delete process.env.STRIPE_WEBHOOK_SECRET;
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith("BILLING_PRICE_") ||
      k.startsWith("BILLING_QUOTA_") ||
      k.startsWith("STRIPE_PRICE_")
    ) {
      delete process.env[k];
    }
  }
});

describe("feature flag (disabled by default)", () => {
  it("recordUsage is a NO-OP and never touches the DB when billing is off", async () => {
    process.env.BILLING_ENABLED = "false";
    await expect(recordUsage("agency1", "message", 5)).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("isOverQuota returns false (never blocks) when billing is off", async () => {
    process.env.BILLING_ENABLED = "false";
    await expect(isOverQuota("agency1", "message")).resolves.toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("plan catalogue", () => {
  it("exposes starter/pro/scale with the expected prices and positive quotas", () => {
    const plans = getPlans();
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(["pro", "scale", "starter"]);
    expect(byId.starter.priceEur).toBe(99);
    expect(byId.pro.priceEur).toBe(299);
    expect(byId.scale.priceEur).toBe(799);
    for (const p of plans) {
      expect(p.quotas.message).toBeGreaterThan(0);
      expect(p.quotas.lead).toBeGreaterThan(0);
      expect(p.quotas.conversation).toBeGreaterThan(0);
    }
  });

  it("getPlan resolves a known plan", () => {
    expect(getPlan("pro").priceEur).toBe(299);
  });
});

describe("handleStripeWebhook — signature verification", () => {
  const SECRET = "whsec_test_abc123";

  it("accepts a valid signature and returns the event type", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const payload = Buffer.from(
      JSON.stringify({ id: "evt_1", type: "ping" }),
      "utf8",
    );
    const header = signHeader(SECRET, payload, nowSec());

    const res = await handleStripeWebhook(payload, header);
    expect(res).toEqual({ ok: true, type: "ping" });
  });

  it("upserts the subscription on a valid customer.subscription.updated event", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const event = {
      id: "evt_sub",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          current_period_end: nowSec() + 86400,
          metadata: { tenant_id: "agency1", plan: "pro" },
          items: { data: [{ price: { id: "price_x" } }] },
        },
      },
    };
    const payload = Buffer.from(JSON.stringify(event), "utf8");
    const header = signHeader(SECRET, payload, nowSec());

    const res = await handleStripeWebhook(payload, header);
    expect(res.ok).toBe(true);
    expect(res.type).toBe("customer.subscription.updated");
    // Subscription state is persisted regardless of BILLING_ENABLED.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const original = Buffer.from(
      JSON.stringify({ id: "evt_2", type: "ping" }),
      "utf8",
    );
    const header = signHeader(SECRET, original, nowSec());
    const tampered = Buffer.from(
      JSON.stringify({ id: "evt_2", type: "ping", injected: true }),
      "utf8",
    );

    const res = await handleStripeWebhook(tampered, header);
    expect(res).toEqual({ ok: false });
  });

  it("rejects a stale timestamp (outside the 5 min tolerance)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const payload = Buffer.from(
      JSON.stringify({ id: "evt_3", type: "ping" }),
      "utf8",
    );
    const staleT = nowSec() - 3600; // 1 hour ago
    const header = signHeader(SECRET, payload, staleT);

    const res = await handleStripeWebhook(payload, header);
    expect(res).toEqual({ ok: false });
  });

  it("rejects a malformed signature header", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const payload = Buffer.from(JSON.stringify({ type: "ping" }), "utf8");
    const res = await handleStripeWebhook(payload, "not-a-valid-header");
    expect(res).toEqual({ ok: false });
  });

  it("returns ok:false (does not throw) when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = Buffer.from(JSON.stringify({ type: "ping" }), "utf8");
    const t = nowSec();
    const res = await handleStripeWebhook(payload, `t=${t},v1=deadbeef`);
    expect(res).toEqual({ ok: false });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("metering & quota (billing ON)", () => {
  it("recordUsage inserts a usage event when billing is on", async () => {
    process.env.BILLING_ENABLED = "true";
    await recordUsage("agency1", "message", 3);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO usage_events");
    expect(params).toEqual(["agency1", "message", 3]);
  });

  it("isOverQuota is true once usage reaches the plan quota", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.BILLING_QUOTA_STARTER_MESSAGE = "2"; // tiny quota for the test

    (pool.query as any)
      // 1) getSubscriptionRow → starter plan
      .mockImplementationOnce(async () => ({
        rows: [
          {
            tenant_id: "agency1",
            stripe_customer_id: null,
            stripe_subscription_id: null,
            plan: "starter",
            status: "active",
            current_period_end: null,
            updated_at: null,
          },
        ],
        rowCount: 1,
      }))
      // 2) getTenantUsage → 2 messages used (== quota)
      .mockImplementationOnce(async () => ({
        rows: [{ kind: "message", total: 2 }],
        rowCount: 1,
      }));

    await expect(isOverQuota("agency1", "message")).resolves.toBe(true);
  });

  it("isOverQuota is false while usage is below the plan quota", async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.BILLING_QUOTA_STARTER_MESSAGE = "10";

    (pool.query as any)
      .mockImplementationOnce(async () => ({
        rows: [{ tenant_id: "agency1", plan: "starter", status: "active" }],
        rowCount: 1,
      }))
      .mockImplementationOnce(async () => ({
        rows: [{ kind: "message", total: 3 }],
        rowCount: 1,
      }));

    await expect(isOverQuota("agency1", "message")).resolves.toBe(false);
  });
});
