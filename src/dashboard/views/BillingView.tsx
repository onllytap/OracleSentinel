// ============================================================================
// BillingView — billing & quotas per agency (R18).
// Shows the plan catalogue, and per-tenant: plan, subscription status, and
// usage vs quota. Billing may be disabled server-side (BILLING_ENABLED=false) —
// in that case usage stays at 0 and nothing is blocked. No secret keys shown.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import {
  listTenants,
  getPlans,
  getTenantBilling,
  setTenantPlan,
  type TenantRecord,
  type PlanDef,
  type PlanId,
  type TenantBilling,
  type UsageKind,
} from "../api";

const KIND_LABEL: Record<UsageKind, string> = {
  message: "Messages",
  lead: "Leads",
  conversation: "Conversations",
};

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  // limit 0 = unlimited.
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="tabular-nums">{used.toLocaleString("fr-FR")}</span>
        <span className="text-muted-foreground">{limit > 0 ? limit.toLocaleString("fr-FR") : "illimité"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {limit > 0 && <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

export default function BillingView({ nonce }: { nonce: number }) {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [billing, setBilling] = useState<TenantBilling | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
    listTenants()
      .then((t) => {
        setTenants(t);
        setTenantId((cur) => cur || (t[0]?.tenantId ?? "default"));
      })
      .catch(() => setTenants([]));
  }, [nonce]);

  const load = useCallback((id: string) => {
    if (!id) return;
    setLoading(true);
    setErr("");
    getTenantBilling(id)
      .then(setBilling)
      .catch((e) => setErr(e?.message || "Erreur de chargement"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tenantId) load(tenantId);
  }, [tenantId, load]);

  const changePlan = async (plan: PlanId) => {
    setBusy(true);
    setErr("");
    try {
      setBilling(await setTenantPlan(tenantId, plan));
    } catch (e: any) {
      setErr(e?.message || "Changement de plan impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Plan catalogue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
          <CardDescription>Tarifs mensuels par agence et quotas inclus (configurables côté serveur).</CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {plans.map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold capitalize">{p.id}</span>
                    <span className="text-lg font-bold">{p.priceEur}€<span className="text-xs font-normal text-muted-foreground">/mois</span></span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {(Object.keys(p.quotas) as UsageKind[]).map((k) => (
                      <li key={k}>
                        {KIND_LABEL[k]} : {p.quotas[k] > 0 ? p.quotas[k].toLocaleString("fr-FR") : "illimité"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-tenant billing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facturation de l'agence</CardTitle>
          <CardDescription>Plan, abonnement et usage du mois en cours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Agence (tenant)
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="h-9 min-w-[200px] rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {tenants.length === 0 && <option value="default">default</option>}
                {tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>{t.name} — {t.tenantId}</option>
                ))}
              </select>
            </label>
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="ou saisir un tenant_id"
              className="h-9 w-44"
            />
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}

          {loading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : billing ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="capitalize">Plan : {billing.plan}</Badge>
                <Badge variant="outline">Abonnement : {billing.subscription?.status ?? billing.status}</Badge>
                {billing.overQuota && (
                  <Badge variant="outline" className="border-red-500/40 text-red-400">Quota dépassé</Badge>
                )}
                {billing.subscription?.currentPeriodEnd && (
                  <span className="text-xs text-muted-foreground">
                    fin de période : {new Date(billing.subscription.currentPeriodEnd).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(Object.keys(billing.usage) as UsageKind[]).map((k) => (
                  <div key={k} className="rounded-lg border border-border p-3">
                    <p className="mb-1 text-xs font-medium">{KIND_LABEL[k]}</p>
                    <QuotaBar used={billing.usage[k] ?? 0} limit={billing.quota[k] ?? 0} />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Changer de plan :</span>
                {(["starter", "pro", "scale"] as PlanId[]).map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={billing.plan === p ? "default" : "outline"}
                    disabled={busy || billing.plan === p}
                    onClick={() => changePlan(p)}
                    className="capitalize"
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sélectionnez une agence.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
