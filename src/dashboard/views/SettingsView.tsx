// ============================================================================
// SettingsView — operations & security (R6/R7, R11–R14, RGPD, R3/R4).
// Sections:
//   1. Sécurité (TOTP) — enroll / activate (recovery codes) / disable. Passkey &
//      ADMIN_API_KEY remain valid entries; TOTP is an optional second factor.
//   2. Métriques de la flotte — measured latency / response rate / last activity.
//   3. Opérations par agence — redeploy (config reload, R3/R4) + RGPD export &
//      anonymisation. No secret value is ever displayed.
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
  getFleetMetrics,
  totpStatus,
  totpBegin,
  totpActivate,
  totpDisable,
  getRedeploy,
  triggerRedeploy,
  rgpdExport,
  rgpdAnonymize,
  type TenantRecord,
  type BotMetrics,
  type TotpStatusInfo,
  type RedeployState,
} from "../api";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR");
}

// ── TOTP section ─────────────────────────────────────────────────────────────
function TotpSection() {
  const [status, setStatus] = useState<TotpStatusInfo | null>(null);
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(() => {
    totpStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const begin = async () => {
    setBusy(true); setErr(""); setMsg(""); setRecovery(null);
    try { setEnroll(await totpBegin()); } catch (e: any) { setErr(e?.message || "Erreur"); } finally { setBusy(false); }
  };
  const activate = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const codes = await totpActivate(code.trim());
      setRecovery(codes);
      setEnroll(null);
      setCode("");
      setMsg("TOTP activé. Conservez les codes de récupération ci-dessous (affichés une seule fois).");
      refresh();
    } catch (e: any) { setErr(e?.message || "Code invalide"); } finally { setBusy(false); }
  };
  const disable = async () => {
    if (!window.confirm("Désactiver le TOTP ? La connexion par clé/passkey restera possible.")) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await totpDisable({ code: disableCode.trim() || undefined, recoveryCode: disableCode.trim() || undefined });
      setDisableCode("");
      setMsg("TOTP désactivé.");
      refresh();
    } catch (e: any) { setErr(e?.message || "Désactivation refusée"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sécurité — Double authentification (TOTP)</CardTitle>
        <CardDescription>
          Second facteur optionnel pour la connexion par clé. La passkey et la clé d'API admin restent des
          moyens d'accès valides — l'admin n'est jamais verrouillé dehors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">État :</span>
          {status == null ? (
            <Badge variant="outline" className="text-muted-foreground">…</Badge>
          ) : status.activated ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Activé</Badge>
          ) : status.enrolled ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-400">Enrôlement en cours</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Non configuré</Badge>
          )}
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}

        {!status?.activated && !enroll && (
          <Button onClick={begin} disabled={busy}>Configurer le TOTP</Button>
        )}

        {enroll && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Ajoutez ce compte dans votre application d'authentification, puis saisissez le code à 6 chiffres.
            </p>
            <p className="break-all font-mono text-xs">Secret : {enroll.secret}</p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{enroll.otpauthUri}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" className="h-9 w-32" />
              <Button onClick={activate} disabled={busy || code.trim().length < 6}>Activer</Button>
              <Button variant="ghost" onClick={() => setEnroll(null)} disabled={busy}>Annuler</Button>
            </div>
          </div>
        )}

        {recovery && (
          <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
            <p className="text-xs font-medium text-amber-400">Codes de récupération (à usage unique — copiez-les maintenant) :</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-3">
              {recovery.map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        )}

        {status?.activated && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="Code TOTP ou de récupération"
              className="h-9 w-56"
            />
            <Button variant="outline" onClick={disable} disabled={busy}>Désactiver le TOTP</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Fleet metrics section ───────────────────────────────────────────────────────
function MetricsSection({ nonce }: { nonce: number }) {
  const [rows, setRows] = useState<BotMetrics[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr(""); setRows(null);
    getFleetMetrics().then(setRows).catch((e) => setErr(e?.message || "Erreur"));
  }, []);
  useEffect(() => { load(); }, [load, nonce]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Métriques de la flotte</CardTitle>
        <CardDescription>Latence mesurée (sonde réelle), taux de réponse et dernière activité par agence.</CardDescription>
      </CardHeader>
      <CardContent>
        {err ? (
          <p className="text-sm text-red-400">{err}</p>
        ) : !rows ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune métrique disponible.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agence</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Latence</TableHead>
                  <TableHead className="text-right">Taux réponse</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  <TableHead>Hébergement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.tenantId}>
                    <TableCell className="font-mono text-xs">{m.tenantId}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.messageCount.toLocaleString("fr-FR")}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.measuredLatencyMs == null ? <span className="text-muted-foreground">—</span> : `${m.measuredLatencyMs} ms`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.responseRate}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(m.lastActivityAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.hostingLocation}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Per-tenant operations: redeploy + RGPD ───────────────────────────────────────
function TenantOpsSection({ nonce }: { nonce: number }) {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [redeploy, setRedeploy] = useState<{ state: RedeployState; latestVersion: number | null; outOfDate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    listTenants()
      .then((t) => { setTenants(t); setTenantId((cur) => cur || (t[0]?.tenantId ?? "default")); })
      .catch(() => setTenants([]));
  }, [nonce]);

  const loadRedeploy = useCallback((id: string) => {
    if (!id) return;
    setRedeploy(null); setErr("");
    getRedeploy(id).then(setRedeploy).catch((e) => setErr(e?.message || "Erreur"));
  }, []);
  useEffect(() => { if (tenantId) loadRedeploy(tenantId); }, [tenantId, loadRedeploy]);

  const onRedeploy = async () => {
    if (!window.confirm(`Redéployer la configuration de « ${tenantId} » ?`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const state = await triggerRedeploy(tenantId);
      setMsg(`Redéploiement : ${state.status}`);
      loadRedeploy(tenantId);
    } catch (e: any) { setErr(e?.message || "Échec du redéploiement"); } finally { setBusy(false); }
  };

  const onExport = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const data = await rgpdExport(tenantId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgpd-export-${tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Export RGPD téléchargé.");
    } catch (e: any) { setErr(e?.message || "Export impossible"); } finally { setBusy(false); }
  };

  const onAnonymize = async () => {
    if (!window.confirm(`Anonymiser (email/téléphone) les leads de « ${tenantId} » ? Action irréversible.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const { anonymized } = await rgpdAnonymize(tenantId);
      setMsg(`${anonymized} lead(s) anonymisé(s).`);
    } catch (e: any) { setErr(e?.message || "Anonymisation impossible"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Opérations par agence</CardTitle>
        <CardDescription>Redéploiement de la configuration (rechargement à chaud) et conformité RGPD.</CardDescription>
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
              {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name} — {t.tenantId}</option>)}
            </select>
          </label>
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="ou saisir un tenant_id" className="h-9 w-44" />
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}

        {/* Redeploy */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <span className="text-muted-foreground">Redéploiement :</span>
          {redeploy ? (
            <>
              <Badge variant="outline" className="capitalize">{redeploy.state.status}</Badge>
              <span className="text-xs text-muted-foreground">
                version active {redeploy.state.activeVersion ?? "—"} / dernière {redeploy.latestVersion ?? "—"}
              </span>
              {redeploy.outOfDate && <Badge variant="outline" className="border-amber-500/40 text-amber-400">Obsolète</Badge>}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">…</span>
          )}
          <Button size="sm" className="ml-auto" onClick={onRedeploy} disabled={busy || !tenantId}>Redéployer</Button>
        </div>

        {/* RGPD */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <span className="text-muted-foreground">RGPD :</span>
          <Button size="sm" variant="outline" onClick={onExport} disabled={busy || !tenantId}>Exporter les données</Button>
          <Button size="sm" variant="outline" className="border-red-500/40 text-red-400" onClick={onAnonymize} disabled={busy || !tenantId}>
            Anonymiser les leads
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsView({ nonce }: { nonce: number }) {
  return (
    <div className="space-y-4">
      <TotpSection />
      <MetricsSection nonce={nonce} />
      <TenantOpsSection nonce={nonce} />
    </div>
  );
}
