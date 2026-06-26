// ============================================================================
// MandatesView — Inbox "Mandats" : les vendeurs captés via l'estimation.
// Affiche, par agence (tenant_id), les propriétaires à rappeler : contact,
// bien, fourchette d'estimation, DPE, date. Données via /api/priv/mandates.
// Aucune donnée secrète. Lecture seule pour le MVP.
// ============================================================================

import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { getMandates, type Mandate } from "../api";

function euro(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-FR").format(n) + " €";
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function dpeBadge(dpe: string | null) {
  if (!dpe) return <Badge variant="outline">DPE ?</Badge>;
  const e = dpe.toUpperCase();
  const danger = e === "F" || e === "G";
  return (
    <Badge variant={danger ? "destructive" : "secondary"}>
      DPE {e}
      {danger ? " ⚠️" : ""}
    </Badge>
  );
}

export default function MandatesView({ nonce }: { nonce: number }) {
  const [mandates, setMandates] = useState<Mandate[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setErr("");
    setMandates(null);
    getMandates()
      .then(setMandates)
      .catch(() => {
        setErr("Impossible de charger les mandats.");
        setMandates([]);
      });
  }, [nonce]);

  const total = mandates?.length ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🔥 Mandats — vendeurs à rappeler
            {mandates && (
              <Badge variant="outline" className="ml-1">
                {total}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Propriétaires ayant demandé une estimation sur le site d'une agence. Rappelez-les vite —
            un vendeur chaud part au premier qui décroche.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {err && <p className="text-sm text-destructive">{err}</p>}

          {!mandates && !err && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {mandates && total === 0 && !err && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Aucun mandat capté pour l'instant. Dès qu'un vendeur utilise l'estimateur sur un site
              d'agence, il apparaît ici en temps réel.
            </div>
          )}

          {mandates && total > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Vendeur</th>
                    <th className="py-2 pr-3 font-medium">Contact</th>
                    <th className="py-2 pr-3 font-medium">Bien</th>
                    <th className="py-2 pr-3 font-medium">Estimation</th>
                    <th className="py-2 pr-3 font-medium">DPE</th>
                    <th className="py-2 pr-3 font-medium">Agence</th>
                    <th className="py-2 pr-3 font-medium">Reçu</th>
                  </tr>
                </thead>
                <tbody>
                  {mandates.map((m) => (
                    <tr key={m.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 font-medium">
                        {[m.prenom, m.nom].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col">
                          {m.telephone && (
                            <a href={`tel:${m.telephone}`} className="text-primary hover:underline">
                              {m.telephone}
                            </a>
                          )}
                          {m.email && <span className="text-muted-foreground">{m.email}</span>}
                          {!m.telephone && !m.email && "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {m.type_local || "—"}
                        {m.surface ? ` · ${m.surface} m²` : ""}
                        {m.address ? (
                          <div className="text-xs text-muted-foreground">{m.address}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{euro(m.estimate_mid)}</td>
                      <td className="py-2 pr-3">{dpeBadge(m.dpe)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{m.tenant_id}</Badge>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(m.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
