import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  Cctv,
  Eye,
  Gauge,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../components/ui/utils";
import { FlipWords } from "./components/flip-words";
import { GradientButton, UtilityButton } from "./components/fancy-buttons";
import { BadgeGroup } from "./components/badge-group";
import { WorldGrid } from "./components/world-grid";
import { Icon8, Icons8Attribution } from "./components/icon8";
import { apiFetch, checkSession, getJSON, login, logout } from "./api";

type View = "overview" | "chatbots" | "surveillance" | "conversations" | "infra";

// ── Reusable: friendly error state ───────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
      <AlertTriangle className="size-6 text-amber-400" />
      <div>
        <p className="text-sm font-medium">Impossible de charger les données</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-4" /> Réessayer
      </Button>
    </div>
  );
}

// ── Login gate ───────────────────────────────────────────────────────────────

function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(key);
      onAuthed();
    } catch (e: any) {
      setErr(e?.message || "Erreur.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">
              OS
            </div>
            <div>
              <CardTitle className="text-lg">OracleSentinel</CardTitle>
              <CardDescription>Command Center · accès restreint</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Clé d'accès super-admin</label>
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="••••••••••••••••"
                autoFocus
              />
            </div>
            <GradientButton type="submit" className="w-full" disabled={busy}>
              {busy ? "Vérification…" : "Déverrouiller le bunker"}
            </GradientButton>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Session HttpOnly signée · protection CSRF · comparaison à temps constant.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

const NAV: { id: View; label: string; icon: React.ComponentType<any> }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "chatbots", label: "Chatbots", icon: Bot },
  { id: "surveillance", label: "Surveillance", icon: Cctv },
  { id: "conversations", label: "Conversations", icon: MessageSquare },
  { id: "infra", label: "Infrastructure", icon: Server },
];

function Sidebar({
  view,
  setView,
  onLogout,
  health,
}: {
  view: View;
  setView: (v: View) => void;
  onLogout: () => void;
  health: number | null;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          OS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-foreground">OracleSentinel</div>
          <div className="text-xs text-muted-foreground">Command Center</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <Button
              key={item.id}
              variant={active ? "secondary" : "ghost"}
              className={cn("justify-start gap-3", active && "font-semibold")}
              onClick={() => setView(item.id)}
            >
              <Icon className="size-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="mt-auto">
        {health != null && (
          <div className="mb-2 rounded-lg border border-sidebar-border bg-card/40 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Santé infra</span>
              <span
                className={cn(
                  "font-semibold",
                  health >= 80 ? "text-emerald-400" : health >= 50 ? "text-amber-400" : "text-red-400",
                )}
              >
                {health}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  health >= 80 ? "bg-emerald-500" : health >= 50 ? "bg-amber-500" : "bg-red-500",
                )}
                style={{ width: `${health}%` }}
              />
            </div>
          </div>
        )}
        <Separator className="my-3" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={onLogout}
        >
          <LogOut className="size-4" />
          Déconnexion
        </Button>
      </div>
    </aside>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ComponentType<any>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription>{label}</CardDescription>
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  operational: "default",
  degraded: "secondary",
  down: "destructive",
  not_configured: "outline",
};

function fmtDate(v: any): string {
  return v ? new Date(v).toLocaleString("fr-FR") : "—";
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ nonce }: { nonce: number }) {
  const [data, setData] = useState<any>(null);
  const [infra, setInfra] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    Promise.all([
      getJSON("/api/admin/db/overview"),
      getJSON("/api/priv/infra").catch(() => null),
    ])
      .then(([o, i]) => {
        setData(o);
        setInfra(i);
      })
      .catch((e) => setErr(e?.message || "Erreur"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  if (err) return <ErrorState message={err} onRetry={load} />;

  const health = infra?.summary?.healthScore ?? 0;
  const chartData = (data?.tenantBreakdown || []).slice(0, 12).map((t: any) => ({
    name: t.tenant_id,
    biens: t.count,
  }));

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden border-primary/20">
        <div className="pointer-events-none absolute inset-0 text-primary/40">
          <WorldGrid className="h-full w-full opacity-70" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
        <CardContent className="relative z-10 py-8">
          <BadgeGroup addonText="Live" size="md">
            Réseau de chatbots en supervision temps réel
          </BadgeGroup>
          <h1 className="mt-4 max-w-xl text-3xl font-bold leading-tight tracking-tight">
            Le QG qui pilote vos{" "}
            <FlipWords words={["agences", "chatbots", "leads", "déploiements"]} />
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Visualisez, contrôlez et sécurisez l'ensemble de la flotte OracleSentinel depuis un seul écran.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Agences pilotées" value={data?.tenants ?? "—"} sub="tenants actifs" icon={Building2} />
        <Kpi label="Messages traités" value={data?.messages ?? "—"} sub="total cumulé" icon={MessageSquare} />
        <Kpi label="Leads générés" value={data?.leads ?? "—"} sub="capturés par les bots" icon={Users} />
        <Kpi
          label="Santé infrastructure"
          value={`${health}%`}
          sub={`${infra?.summary?.operational ?? 0}/${infra?.summary?.total ?? 0} services up`}
          icon={Activity}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Biens par agence</CardTitle>
            <CardDescription>Top 12 des chatbots par volume de catalogue</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Aucune donnée de catalogue pour le moment.
              </p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8b93a7" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#8b93a7" }} allowDecimals={false} />
                    <RTooltip
                      contentStyle={{
                        background: "#16182a",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="biens" fill="oklch(0.62 0.2 277.2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activité globale</CardTitle>
            <CardDescription>Tous tenants confondus</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat label="Conversations" value={data?.conversations ?? 0} />
            <Stat label="Biens" value={data?.properties ?? 0} />
            <Stat label="Imports" value={data?.imports ?? 0} />
            <Stat label="Incidents infra" value={(infra?.summary?.down ?? 0) + (infra?.summary?.degraded ?? 0)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Bot detail dialog ────────────────────────────────────────────────────────

function BotDetail({
  bot,
  onClose,
  onDeleted,
}: {
  bot: any | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!bot) return null;

  const conv = bot.conversation_count ?? 0;
  const leads = bot.lead_count ?? 0;
  const rate = conv > 0 ? Math.round((leads / conv) * 100) : 0;

  const purge = async () => {
    if (!window.confirm(`Purger TOUTES les données du chatbot "${bot.tenant_id}" ? Action irréversible.`)) return;
    setBusy(true);
    setErr("");
    const res = await apiFetch(`/api/admin/db/tenant/${encodeURIComponent(bot.tenant_id)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      onDeleted();
      onClose();
    } else {
      setErr(`Échec de la purge (${res.status})`);
    }
  };

  return (
    <Dialog open={!!bot} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Bot className="size-4" />
            </span>
            {bot.tenant_id}
          </DialogTitle>
          <DialogDescription>Fiche chatbot · données live</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Conversations" value={conv} />
          <Stat label="Leads" value={leads} />
          <Stat label="Taux de conversion" value={`${rate}%`} />
          <Stat label="Biens en catalogue" value={bot.property_count ?? 0} />
          <Stat label="Disponibles" value={bot.available ?? 0} />
          <Stat label="Retirés" value={bot.retired ?? 0} />
        </div>

        <div className="space-y-1.5 rounded-lg border bg-card/40 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Widgets</span>
            <span className="flex flex-wrap justify-end gap-1">
              {(bot.widgetIds || []).length ? (
                (bot.widgetIds || []).map((w: string) => (
                  <Badge key={w} variant="outline" className="font-mono text-[10px]">
                    {w}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dernier import</span>
            <span>{fmtDate(bot.last_import)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dernière activité</span>
            <span>{fmtDate(bot.last_updated)}</span>
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="destructive" onClick={purge} disabled={busy}>
            <Trash2 className="size-4" />
            {busy ? "Purge…" : "Purger les données"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Chatbots ─────────────────────────────────────────────────────────────────

function ChatbotsView({ nonce }: { nonce: number }) {
  const [tenants, setTenants] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  const load = useCallback(() => {
    setErr("");
    setTenants(null);
    getJSON("/api/admin/db/tenants")
      .then((d: any) => setTenants(d.tenants || []))
      .catch((e) => setErr(e?.message || "Erreur"));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const removeBot = async (id: string) => {
    if (!window.confirm(`Supprimer définitivement le chatbot "${id}" et toutes ses données ?`)) return;
    const res = await apiFetch(`/api/admin/db/tenant/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load();
    else setErr(`Suppression échouée (${res.status})`);
  };

  const filtered = useMemo(() => {
    if (!tenants) return [];
    const s = q.trim().toLowerCase();
    if (!s) return tenants;
    return tenants.filter(
      (t: any) =>
        String(t.tenant_id).toLowerCase().includes(s) ||
        (t.widgetIds || []).some((w: string) => w.toLowerCase().includes(s)),
    );
  }, [tenants, q]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Chatbots déployés</CardTitle>
            <CardDescription>Une ligne par agence — stats live depuis Neon</CardDescription>
          </div>
          <div className="relative w-64 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un bot / widget…"
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {err ? (
          <ErrorState message={err} onRetry={load} />
        ) : !tenants ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun chatbot trouvé.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chatbot / Agence</TableHead>
                <TableHead>Widgets</TableHead>
                <TableHead className="text-right">Biens</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Conv. %</TableHead>
                <TableHead>Dernière activité</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t: any) => {
                const conv = t.conversation_count ?? 0;
                const rate = conv > 0 ? Math.round(((t.lead_count ?? 0) / conv) * 100) : 0;
                return (
                  <TableRow
                    key={t.tenant_id}
                    className="cursor-pointer"
                    onClick={() => setSelected(t)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                          <Bot className="size-4" />
                        </span>
                        {t.tenant_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(t.widgetIds || []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          (t.widgetIds || []).slice(0, 3).map((w: string) => (
                            <Badge key={w} variant="outline" className="font-mono text-[10px]">
                              {w}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.property_count ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{conv}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lead_count ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={cn(rate >= 20 ? "text-emerald-400" : rate > 0 ? "text-amber-400" : "text-muted-foreground")}>
                        {rate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(t.last_updated)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <UtilityButton icon={Eye} tooltip="Voir la fiche" onClick={() => setSelected(t)} />
                        <UtilityButton icon={Trash2} tooltip="Supprimer" tone="danger" onClick={() => removeBot(t.tenant_id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <BotDetail bot={selected} onClose={() => setSelected(null)} onDeleted={load} />
    </Card>
  );
}

// ── Conversations ────────────────────────────────────────────────────────────

function ConversationsView({ nonce }: { nonce: number }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr("");
    setData(null);
    getJSON("/api/admin/db/conversations")
      .then(setData)
      .catch((e) => setErr(e?.message || "Erreur"));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!data) return <Skeleton className="h-64 w-full rounded-xl" />;

  const conversations = data.conversations || [];
  const leads = data.leads || [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversations récentes</CardTitle>
          <CardDescription>{conversations.length} dernières sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune conversation.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agence</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.tenant_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {String(c.session_id || "").slice(0, 14)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.message_count ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status || "—"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leads récents</CardTitle>
          <CardDescription>{leads.length} derniers leads captés</CardDescription>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lead.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agence</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Échéance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.tenant_id}</TableCell>
                    <TableCell className="text-xs">
                      {l.email || l.phone || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.timeline || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Surveillance (camera wall) ───────────────────────────────────────────────

function isOnline(lastUpdated: any): boolean {
  if (!lastUpdated) return false;
  const t = new Date(lastUpdated).getTime();
  return Date.now() - t < 7 * 24 * 60 * 60 * 1000; // active in last 7 days
}

function SurvTile({ bot, index, onSelect }: { bot: any; index: number; onSelect: (b: any) => void }) {
  const online = isOnline(bot.last_updated);
  const conv = bot.conversation_count ?? 0;
  const leads = bot.lead_count ?? 0;
  const cam = String(index + 1).padStart(2, "0");
  // Pseudo ping derived from id hash — stable per bot, purely indicative.
  const ping = 20 + (String(bot.tenant_id).length * 7 + index * 13) % 90;

  return (
    <button
      onClick={() => onSelect(bot)}
      className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-border bg-gradient-to-br from-slate-900 to-black text-left outline-none transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {/* Feed background */}
      <div className="cam-grain absolute inset-0 opacity-60" />
      <div className="cam-scanline absolute inset-0" />
      <div className="absolute inset-0 flex items-center justify-center opacity-20">
        <Icon8 name="camera" size={56} alt="" className="grayscale" />
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2 text-[10px] font-medium text-white/80">
        <span className="flex items-center gap-1.5">
          {online ? (
            <span className="rec-dot inline-block size-2 rounded-full bg-red-500" />
          ) : (
            <span className="inline-block size-2 rounded-full bg-slate-500" />
          )}
          {online ? "REC" : "OFFLINE"}
        </span>
        <span className="font-mono">CAM {cam}</span>
      </div>

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/90 to-transparent p-2.5">
        <div className="flex items-center justify-between">
          <span className="truncate text-xs font-semibold text-white">{bot.tenant_id}</span>
          <Badge variant={online ? "default" : "secondary"} className="h-4 px-1.5 text-[9px]">
            {online ? "LIVE" : "veille"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="flex items-center gap-1"><MessageSquare className="size-3" />{conv}</span>
          <span className="flex items-center gap-1"><Users className="size-3" />{leads}</span>
          <span className="ml-auto flex items-center gap-1">
            <Radio className="size-3" />
            <span className={online ? "text-emerald-400" : "text-slate-400"}>{online ? `${ping}ms` : "—"}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

function SurveillanceView({ nonce, onSelect }: { nonce: number; onSelect: (b: any) => void }) {
  const [tenants, setTenants] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setErr("");
    setTenants(null);
    getJSON("/api/admin/db/tenants")
      .then((d: any) => setTenants(d.tenants || []))
      .catch((e) => setErr(e?.message || "Erreur"));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const filtered = useMemo(() => {
    if (!tenants) return [];
    const s = q.trim().toLowerCase();
    return s ? tenants.filter((t: any) => String(t.tenant_id).toLowerCase().includes(s)) : tenants;
  }, [tenants, q]);

  const onlineCount = filtered.filter((t: any) => isOnline(t.last_updated)).length;

  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Icon8 name="controlPanel" size={26} alt="" />
          </span>
          <div className="mr-auto">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Mur de surveillance</CardTitle>
              <BadgeGroup addonText="Live">Flux temps réel des agences</BadgeGroup>
            </div>
            <CardDescription className="mt-1">
              {tenants ? `${onlineCount}/${filtered.length} flux actifs` : "Connexion aux flux…"}
            </CardDescription>
          </div>
          <div className="relative w-56 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer une caméra…" className="pl-8" />
          </div>
        </CardContent>
      </Card>

      {err ? (
        <ErrorState message={err} onRetry={load} />
      ) : !tenants ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[16/10] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune caméra / agence à afficher.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((t: any, i: number) => (
              <SurvTile key={t.tenant_id} bot={t} index={i} onSelect={onSelect} />
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <Icons8Attribution />
          </div>
        </>
      )}
    </div>
  );
}

// ── Infrastructure ───────────────────────────────────────────────────────────

function InfraView({ nonce, onHealth }: { nonce: number; onHealth: (h: number) => void }) {
  const [infra, setInfra] = useState<any>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr("");
    setInfra(null);
    getJSON("/api/priv/infra")
      .then((d) => {
        setInfra(d);
        if (d?.summary?.healthScore != null) onHealth(d.summary.healthScore);
      })
      .catch((e) => setErr(e?.message || "Erreur"));
  }, [onHealth]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!infra) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {(infra.services || []).map((s: any) => (
        <Card key={s.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm">{s.name}</CardTitle>
                <CardDescription className="text-[11px] uppercase tracking-wide">{s.category}</CardDescription>
              </div>
              <Badge variant={STATUS_VARIANT[s.status] || "outline"}>{s.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="break-all font-mono text-xs text-muted-foreground">{s.endpoint}</p>
            <p className="text-xs text-muted-foreground">{s.purpose}</p>
            <div className="flex items-center gap-2 text-xs">
              <Gauge className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">latence</span>
              <span className="font-medium">{s.latencyMs == null ? "—" : `${s.latencyMs} ms`}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function CommandCenter() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("overview");
  const [nonce, setNonce] = useState(0);
  const [health, setHealth] = useState<number | null>(null);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    checkSession().then(setAuthed);
  }, []);

  // Keep health badge fresh in the background.
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const fetchHealth = () =>
      getJSON("/api/priv/infra")
        .then((d: any) => alive && d?.summary?.healthScore != null && setHealth(d.summary.healthScore))
        .catch(() => {});
    fetchHealth();
    const t = setInterval(() => {
      setNonce((n) => n + 1);
      fetchHealth();
    }, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [authed]);

  const handleLogout = async () => {
    await logout();
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) return <LoginGate onAuthed={() => setAuthed(true)} />;

  const title =
    view === "overview"
      ? "Vue d'ensemble"
      : view === "chatbots"
        ? "Chatbots déployés"
        : view === "surveillance"
          ? "Mur de surveillance"
          : view === "conversations"
            ? "Conversations & Leads"
            : "Infrastructure";

  return (
    <div className="flex min-h-screen">
      <Sidebar view={view} setView={setView} onLogout={handleLogout} health={health} />
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>OracleSentinel ·</span>
              <FlipWords words={["surveillance", "closing", "monitoring", "automation"]} className="font-semibold" />
              <span>· 350+ agences</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <ShieldCheck className="size-3" /> Session sécurisée
            </Badge>
            <GradientButton onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="size-4" /> Rafraîchir
            </GradientButton>
          </div>
        </header>
        <div className="p-6">
          {view === "overview" && <OverviewView nonce={nonce} />}
          {view === "chatbots" && <ChatbotsView nonce={nonce} />}
          {view === "surveillance" && <SurveillanceView nonce={nonce} onSelect={setSelected} />}
          {view === "conversations" && <ConversationsView nonce={nonce} />}
          {view === "infra" && <InfraView nonce={nonce} onHealth={setHealth} />}
        </div>
      </main>
      <BotDetail bot={selected} onClose={() => setSelected(null)} onDeleted={() => setNonce((n) => n + 1)} />
    </div>
  );
}
