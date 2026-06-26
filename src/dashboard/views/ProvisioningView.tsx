// ============================================================================
// ProvisioningView — agency provisioning & lifecycle (R19).
// Creates an agency (tenant) in one click → unique widget_id + copyable embed
// snippet. Lists the agency registry with status/plan, the owning client, and
// the tenant_id ↔ widget_id linkage (so the operator sees which bot belongs to
// which agency). Lifecycle: active / suspended / archived (suspend cuts the bot).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  listTenants,
  provisionTenant,
  setTenantStatusApi,
  getTenantOwners,
  type TenantRecord,
  type TenantStatus,
  type TenantOwner,
} from "../api";

const STATUS_TONE: Record<TenantStatus, string> = {
  active: "border-emerald-500/40 text-emerald-400",
  suspended: "border-amber-500/40 text-amber-400",
  archived: "border-muted text-muted-foreground",
};

export default function ProvisioningView({ nonce }: { nonce: number }) {
  const [rows, setRows] = useState<TenantRecord[] | null>(null);
  const [owners, setOwners] = useState<Record<string, TenantOwner>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Create form
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("starter");
  const [snippet, setSnippet] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [createdWidgetId, setCreatedWidgetId] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState("");

  const load = useCallback(() => {
    setErr("");
    setRows(null);
    Promise.all([listTenants(), getTenantOwners().catch(() => ({} as Record<string, TenantOwner>))])
      .then(([t, ow]) => {
        setRows(t);
        setOwners(ow);
      })
      .catch((e) => setErr(e?.message || "Erreur de chargement"));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const onProvision = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    setSnippet("");
    try {
      const { tenant, embedSnippet } = await provisionTenant({ name: name.trim(), plan });
      setSnippet(embedSnippet);
      setCreatedId(tenant.tenantId);
      setCreatedWidgetId(tenant.widgetId);
      setName("");
      load();
    } catch (e: any) {
      setErr(e?.message || "Provisioning impossible");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (tenantId: string, status: TenantStatus) => {
    setBusy(true);
    setErr("");
    try {
      await setTenantStatusApi(tenantId, status);
      load();
    } catch (e: any) {
      setErr(e?.message || "Changement de statut impossible");
    } finally {
      setBusy(false);
    }
  };

  const estimationUrl = (widgetId: string) =>
    `${window.location.origin}/estimer?w=${encodeURIComponent(widgetId)}`;

  const copyUrl = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(key);
      setTimeout(() => setCopiedUrl(""), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked — the snippet is selectable in the textarea */
    }
  };

  return (
    <div className="space-y-4">
      {/* Create agency */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provisionner une agence</CardTitle>
          <CardDescription>
            Crée une agence (tenant) avec un widget_id unique et renvoie le snippet d'intégration à coller
            sur le site de l'agence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground" style={{ minWidth: 200 }}>
              Nom de l'agence
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Agence Dupont Immobilier" className="h-9" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Plan
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="scale">scale</option>
              </select>
            </label>
            <Button onClick={onProvision} disabled={busy || !name.trim()}>Créer l'agence</Button>
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}

          {snippet && (
            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
              <p className="text-xs font-medium text-emerald-400">
                Agence « {createdId} » créée — snippet à coller avant &lt;/body&gt; :
              </p>
              <textarea
                readOnly
                value={snippet}
                onFocus={(e) => e.currentTarget.select()}
                rows={4}
                className="w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-[11px] text-foreground"
              />
              <Button size="sm" variant="outline" onClick={copySnippet}>
                {copied ? "Copié ✅" : "Copier le snippet"}
              </Button>
              {createdWidgetId && (
                <div className="mt-2 border-t border-emerald-500/20 pt-2">
                  <p className="text-xs font-medium text-emerald-400">
                    Lien « Estimez votre bien » à donner à l'agence (capte les vendeurs / mandats) :
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-background px-2 py-1 text-[11px]">
                      {estimationUrl(createdWidgetId)}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyUrl(estimationUrl(createdWidgetId), "created")}
                    >
                      {copiedUrl === "created" ? "Copié ✅" : "Copier"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Registry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agences provisionnées</CardTitle>
          <CardDescription>Statut, plan, client propriétaire et liaison tenant_id ↔ widget_id (sans secret).</CardDescription>
        </CardHeader>
        <CardContent>
          {err && !rows ? (
            <p className="text-sm text-red-400">{err}</p>
          ) : !rows ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucune agence provisionnée pour l'instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agence</TableHead>
                    <TableHead>tenant_id</TableHead>
                    <TableHead>widget_id</TableHead>
                    <TableHead>Estimation</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Cycle de vie</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.tenantId}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs">{t.tenantId}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{t.widgetId}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => copyUrl(estimationUrl(t.widgetId), t.tenantId)}
                        >
                          {copiedUrl === t.tenantId ? "Copié ✅" : "Copier le lien"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {owners[t.tenantId] ? (
                          <span className="text-xs">{owners[t.tenantId].clientName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{t.plan}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize ${STATUS_TONE[t.status]}`}>{t.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {t.status !== "active" && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus(t.tenantId, "active")}>
                              Réactiver
                            </Button>
                          )}
                          {t.status === "active" && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus(t.tenantId, "suspended")}>
                              Suspendre
                            </Button>
                          )}
                          {t.status !== "archived" && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus(t.tenantId, "archived")}>
                              Archiver
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
