import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  Cctv,
  Cloud,
  Eye,
  ExternalLink,
  Fingerprint,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Download,
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
import {
  apiFetch,
  checkSession,
  getJSON,
  login,
  logout,
  passkeyAvailable,
  passkeySupported,
  passkeyLogin,
  passkeyRegister,
  passkeyList,
  passkeyDelete,
  type PasskeyInfo,
} from "./api";

type View = "overview" | "chatbots" | "surveillance" | "workers" | "conversations" | "infra";

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
  const [pkBusy, setPkBusy] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!passkeySupported()) return;
    passkeyAvailable().then((ok) => {
      if (alive) setCanPasskey(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const doPasskey = async () => {
    setErr("");
    setPkBusy(true);
    try {
      await passkeyLogin();
      onAuthed();
    } catch (e: any) {
      // A user-cancelled WebAuthn prompt throws too — keep the message gentle.
      setErr(e?.message || "Connexion par passkey impossible.");
    } finally {
      setPkBusy(false);
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
          {canPasskey && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={doPasskey}
                disabled={pkBusy || busy}
              >
                <Fingerprint className="size-4" />
                {pkBusy ? "Authentification…" : "Se connecter avec une passkey"}
              </Button>
              <div className="my-4 flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">ou</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}
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
            <GradientButton type="submit" className="w-full" disabled={busy || pkBusy}>
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

// ── Passkey manager (enroll / list / remove device passkeys) ─────────────────

function PasskeyManager() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PasskeyInfo[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const supported = passkeySupported();

  const refresh = useCallback(async () => {
    setErr("");
    try {
      setItems(await passkeyList());
    } catch (e: any) {
      setErr(e?.message || "Chargement impossible.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const add = async () => {
    setErr("");
    setBusy(true);
    try {
      await passkeyRegister(label.trim() || undefined);
      setLabel("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Enrôlement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setErr("");
    setBusy(true);
    try {
      await passkeyDelete(id);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        className="w-full justify-start gap-3 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="size-4" />
        Passkeys
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="size-5" /> Passkeys
            </DialogTitle>
            <DialogDescription>
              Connexion sans mot de passe (empreinte, Face ID, téléphone). La clé d'accès
              super-admin reste utilisable en secours.
            </DialogDescription>
          </DialogHeader>

          {!supported && (
            <p className="text-sm text-amber-400">
              Ce navigateur ne supporte pas les passkeys.
            </p>
          )}

          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">
                  Nom de l'appareil (optionnel)
                </label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Pixel 9a"
                  disabled={!supported || busy}
                />
              </div>
              <Button onClick={add} disabled={!supported || busy} className="gap-2">
                <Plus className="size-4" /> Ajouter
              </Button>
            </div>

            {err && <p className="text-sm text-destructive">{err}</p>}

            <div className="space-y-2">
              {items === null ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune passkey enregistrée.</p>
              ) : (
                items.map((p) => (
                  <div
                    key={p.credentialId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Fingerprint className="size-4 text-muted-foreground" />
                        {p.label || "Passkey"}
                        {p.backedUp && (
                          <Badge variant="outline" className="text-[10px]">
                            synchronisée
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Ajoutée le {fmtDate(p.createdAt)}
                        {p.lastUsedAt ? ` · utilisée ${fmtDate(p.lastUsedAt)}` : ""}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(p.credentialId)}
                      disabled={busy}
                      aria-label="Supprimer la passkey"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

const NAV: { id: View; label: string; icon: React.ComponentType<any> }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "chatbots", label: "Chatbots", icon: Bot },
  { id: "surveillance", label: "Surveillance", icon: Cctv },
  { id: "workers", label: "Workers", icon: Cloud },
  { id: "conversations", label: "Conversations", icon: MessageSquare },
  { id: "infra", label: "Infrastructure", icon: Server },
];

function Sidebar({
  view,
  setView,
  onLogout,
  health,
  open = false,
  onClose,
}: {
  view: View;
  setView: (v: View) => void;
  onLogout: () => void;
  health: number | null;
  open?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 md:hidden",
          open ? "block" : "hidden",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
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
              onClick={() => {
                setView(item.id);
                onClose?.();
              }}
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
        <PasskeyManager />
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
    </>
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

// ── Fleet health (per-agency state from /api/priv/overview) ──────────────────

type Health = "healthy" | "idle" | "attention" | "empty";

// Colours per the spec: healthy = vert · attention = orange · idle = gris · empty = neutre.
const HEALTH_CONFIG: Record<Health, { label: string; badge: string; dot: string }> = {
  healthy: {
    label: "Saine",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-500",
  },
  attention: {
    label: "Alerte",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    dot: "bg-amber-500",
  },
  idle: {
    label: "En veille",
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-400",
  },
  empty: {
    label: "Sans catalogue",
    badge: "border-border bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

// "Problèmes d'abord" : alerte, puis sans catalogue, puis veille, puis saine.
const HEALTH_RANK: Record<Health, number> = { attention: 0, empty: 1, idle: 2, healthy: 3 };

const HEALTH_FILTERS: { id: Health | "all"; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "attention", label: "Alerte" },
  { id: "empty", label: "Sans catalogue" },
  { id: "idle", label: "En veille" },
  { id: "healthy", label: "Saines" },
];

function HealthBadge({ health }: { health?: Health }) {
  if (!health || !HEALTH_CONFIG[health]) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const cfg = HEALTH_CONFIG[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        cfg.badge,
      )}
    >
      <span className={cn("size-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

/** Conversion rate (%) — prefers the server-computed value, falls back to local. */
function convRate(row: any): number {
  if (typeof row?.conversionRate === "number") return row.conversionRate;
  const conv = row?.conversation_count ?? 0;
  return conv > 0 ? Math.round(((row?.lead_count ?? 0) / conv) * 100) : 0;
}

/** Most reliable "last activity" timestamp available for a row. */
function lastActivityOf(row: any): any {
  return row?.lastActivityAt ?? row?.last_updated ?? null;
}

type SortState = { key: string; dir: "asc" | "desc" };

/** Sortable, clickable table header cell. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(align === "right" && "text-right")}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Trier par ${label}`}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3.5", active ? "opacity-100" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ nonce }: { nonce: number }) {
  const [data, setData] = useState<any>(null);
  const [infra, setInfra] = useState<any>(null);
  const [fleet, setFleet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    Promise.all([
      getJSON("/api/admin/db/overview"),
      getJSON("/api/priv/infra").catch(() => null),
      getJSON("/api/priv/overview").catch(() => null),
    ])
      .then(([o, i, f]) => {
        setData(o);
        setInfra(i);
        setFleet(f);
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

      {fleet?.summary?.health && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Santé de la flotte</CardTitle>
                <CardDescription>
                  {fleet.summary.activeAgencies ?? 0} agence(s) active(s) sur{" "}
                  {fleet.summary.agencies ?? 0}
                </CardDescription>
              </div>
              {(fleet.summary.health.attention ?? 0) > 0 ? (
                <Badge variant="secondary" className="gap-1">
                  <AlertTriangle className="size-3" />
                  {fleet.summary.health.attention} à surveiller
                </Badge>
              ) : (
                <Badge variant="default" className="gap-1">
                  <ShieldCheck className="size-3" />
                  Flotte saine
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Saines" value={fleet.summary.health.healthy ?? 0} />
            <Stat label="À surveiller" value={fleet.summary.health.attention ?? 0} />
            <Stat label="En veille" value={fleet.summary.health.idle ?? 0} />
            <Stat label="Sans catalogue" value={fleet.summary.health.empty ?? 0} />
          </CardContent>
        </Card>
      )}

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

// ── Per-agency config editor (Phase 2 Option B) ──────────────────────────────

const TC_SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const TC_TEXTAREA =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const WRITING_STYLE_OPTS: [string, string][] = [
  ["", "(défaut global)"],
  ["professional", "Professionnel"],
  ["friendly", "Amical"],
  ["casual", "Décontracté"],
  ["formal", "Formel"],
  ["technical", "Technique"],
];
const TONE_OPTS: [string, string][] = [
  ["", "(défaut global)"],
  ["warm", "Chaleureux"],
  ["neutral", "Neutre"],
  ["authoritative", "Qui fait autorité"],
  ["empathetic", "Empathique"],
  ["direct", "Direct"],
];

function DInfo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right">{value}</span>
    </div>
  );
}

function TenantConfigEditor({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [agentName, setAgentName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [maxWords, setMaxWords] = useState("");
  const [language, setLanguage] = useState("");
  const [modifiers, setModifiers] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr("");
    setSaved(false);
    getJSON(`/api/priv/tenants/${encodeURIComponent(tenantId)}/config`)
      .then((d: any) => {
        if (!alive) return;
        setData(d);
        // Pre-fill from the tenant override when present, else from the REAL
        // deployed (global) config — so the editor shows actual values, never blank.
        const o = d.override || {};
        const def = d.defaults || {};
        const ob = o.branding || {};
        const db = def.branding || {};
        const op = o.personality || {};
        const dp = def.personality || {};
        setAgentName(ob.agentName ?? db.agentName ?? "");
        setAgencyName(ob.agencyName ?? db.agencyName ?? "");
        setWritingStyle(op.writingStyle ?? dp.writingStyle ?? "");
        setToneOfVoice(op.toneOfVoice ?? dp.toneOfVoice ?? "");
        const mw = op.maxResponseWords ?? dp.maxResponseWords;
        setMaxWords(mw != null ? String(mw) : "");
        setLanguage(op.language ?? dp.language ?? "");
        const mods =
          (op.systemPromptModifiers && op.systemPromptModifiers.length
            ? op.systemPromptModifiers
            : dp.systemPromptModifiers) || [];
        setModifiers(mods.join("\n"));
      })
      .catch((e) => alive && setErr(e?.message || "Erreur"));
    return () => {
      alive = false;
    };
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    setErr("");
    setSaved(false);
    const override = {
      branding: {
        agentName: agentName.trim(),
        agencyName: agencyName.trim(),
      },
      personality: {
        writingStyle: writingStyle || undefined,
        toneOfVoice: toneOfVoice || undefined,
        maxResponseWords: maxWords ? Number(maxWords) : undefined,
        language: language.trim() || undefined,
        systemPromptModifiers: modifiers
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
    try {
      const res = await apiFetch(
        `/api/priv/tenants/${encodeURIComponent(tenantId)}/config`,
        { method: "PUT", body: JSON.stringify({ override }) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message || "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const defaults = data?.defaults || {};
  const ph = (v: any) => (v ? `défaut : ${v}` : "défaut global");

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-primary" />
        <span className="text-sm font-medium">Configuration de l'agence</span>
        <Badge variant="outline" className="ml-auto text-[10px]">
          par agence
        </Badge>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      {!data ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Nom de l'agent</span>
              <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder={ph(defaults.branding?.agentName)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Nom de l'agence</span>
              <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder={ph(defaults.branding?.agencyName)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Style d'écriture</span>
              <select className={TC_SELECT} value={writingStyle} onChange={(e) => setWritingStyle(e.target.value)}>
                {WRITING_STYLE_OPTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Ton</span>
              <select className={TC_SELECT} value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)}>
                {TONE_OPTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Max mots / réponse</span>
              <Input type="number" value={maxWords} onChange={(e) => setMaxWords(e.target.value)} placeholder={ph(defaults.personality?.maxResponseWords)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Langue</span>
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder={ph(defaults.personality?.language)} />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Instructions de prompt (une par ligne)</span>
            <textarea
              className={TC_TEXTAREA}
              rows={3}
              value={modifiers}
              onChange={(e) => setModifiers(e.target.value)}
              placeholder="Ex : Mets en avant nos biens neufs. Propose toujours une visite."
            />
          </label>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="size-4" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            {saved && <span className="text-xs text-emerald-400">Enregistré ✓</span>}
            {data.updatedAt && (
              <span className="ml-auto text-[10px] text-muted-foreground">maj {fmtDate(data.updatedAt)}</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Champs vides = valeur globale par défaut. Ces réglages ne concernent que cette agence.
          </p>

          <details className="rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Ce que sait ce bot (config déployée)
            </summary>
            <div className="mt-2 space-y-1.5 text-xs">
              <DInfo label="Domaine" value={defaults.domain || "—"} />
              <DInfo label="Langue" value={defaults.personality?.language || "—"} />
              <DInfo label="CRM" value={defaults.crmProvider || "none"} />
              <DInfo
                label="Sources (knowledge)"
                value={
                  (defaults.knowledgeUrls || []).length
                    ? `${(defaults.knowledgeUrls || []).length} URL(s)`
                    : "—"
                }
              />
              {defaults.variables && Object.keys(defaults.variables).length > 0 && (
                <div className="space-y-1 pt-1">
                  <span className="text-muted-foreground">Variables d'agence</span>
                  <div className="grid gap-1 rounded-md bg-card/60 p-2 font-mono text-[10px]">
                    {Object.entries(defaults.variables).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{k.replace(/^VAR_/, "")}</span>
                        <span className="max-w-[60%] truncate">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>

          <details className="rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Aperçu du prompt effectif (ce que reçoit l'IA)
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-card/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
{(data.effectivePromptBlock || "").trim() ||
  "Aucune personnalisation active : ce bot utilise le prompt global standard de son domaine."}
            </pre>
          </details>
        </>
      )}
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
  const rate = convRate(bot);
  const lastImport = bot.lastImportAt ?? bot.last_import;
  const lastActivity = lastActivityOf(bot);
  const importErrors: number | undefined =
    typeof bot.lastImportErrors === "number" ? bot.lastImportErrors : undefined;

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

        {bot.health && (
          <div className="flex flex-wrap items-center gap-2">
            <HealthBadge health={bot.health} />
            <span className="text-xs text-muted-foreground">
              {bot.active ? "Activité dans les 7 derniers jours" : "Aucune activité récente"}
            </span>
          </div>
        )}

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
          {importErrors !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Erreurs au dernier import</span>
              <span className={cn(importErrors > 0 && "font-medium text-amber-400")}>
                {importErrors}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dernier import</span>
            <span>{fmtDate(lastImport)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dernière activité</span>
            <span>{fmtDate(lastActivity)}</span>
          </div>
        </div>

        <TenantConfigEditor tenantId={bot.tenant_id} />

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

const CHATBOTS_PAGE_SIZES = [25, 50, 100];

function ChatbotsView({ nonce }: { nonce: number }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [healthUnavailable, setHealthUnavailable] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [healthFilter, setHealthFilter] = useState<Health | "all">("all");
  const [sort, setSort] = useState<SortState>({ key: "health", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<any | null>(null);

  const load = useCallback(() => {
    setErr("");
    setRows(null);
    setHealthUnavailable(false);
    // Base list drives the table + purge (by tenant_id). Health overview is
    // optional: if it fails the table still renders (graceful degradation).
    Promise.all([
      getJSON("/api/admin/db/tenants"),
      getJSON("/api/priv/overview").catch(() => null),
    ])
      .then(([t, ov]: any[]) => {
        const tenants: any[] = t?.tenants || [];
        const agencies: any[] = ov?.agencies || [];
        if (!ov || !Array.isArray(ov.agencies)) setHealthUnavailable(true);
        setGeneratedAt(ov?.generatedAt ?? null);
        const byTenant = new Map<string, any>(agencies.map((a: any) => [a.tenantId, a]));
        const merged = tenants.map((tt: any) => {
          const a = byTenant.get(tt.tenant_id);
          return a
            ? {
                ...tt,
                health: a.health as Health,
                conversionRate: a.conversionRate,
                lastImportErrors: a.lastImportErrors,
                lastImportAt: a.lastImportAt,
                lastActivityAt: a.lastActivityAt,
                active: a.active,
              }
            : tt;
        });
        setRows(merged);
      })
      .catch((e) => setErr(e?.message || "Erreur"));
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  // Back to first page whenever search / filter / sort / page size changes.
  useEffect(() => {
    setPage(1);
  }, [q, healthFilter, sort, pageSize]);

  const removeBot = async (id: string) => {
    if (!window.confirm(`Supprimer définitivement le chatbot "${id}" et toutes ses données ?`)) return;
    const res = await apiFetch(`/api/admin/db/tenant/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load();
    else setErr(`Suppression échouée (${res.status})`);
  };

  // Health counts over the whole dataset (drive the filter chips).
  const healthCounts = useMemo(() => {
    const c: Record<Health, number> = { healthy: 0, idle: 0, attention: 0, empty: 0 };
    for (const r of rows || []) {
      const h = r.health as Health | undefined;
      if (h && h in c) c[h]++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows || [];
    if (healthFilter !== "all") list = list.filter((r: any) => r.health === healthFilter);
    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (t: any) =>
          String(t.tenant_id).toLowerCase().includes(s) ||
          (t.widgetIds || []).some((w: string) => w.toLowerCase().includes(s)),
      );
    }
    return list;
  }, [rows, q, healthFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: any): string | number => {
      switch (sort.key) {
        case "health":
          return HEALTH_RANK[r.health as Health] ?? 99;
        case "tenant":
          return String(r.tenant_id).toLowerCase();
        case "properties":
          return r.property_count ?? 0;
        case "conversations":
          return r.conversation_count ?? 0;
        case "leads":
          return r.lead_count ?? 0;
        case "conversion":
          return convRate(r);
        case "activity":
          return new Date(lastActivityOf(r) || 0).getTime();
        default:
          return 0;
      }
    };
    list.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      let cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      if (cmp !== 0) return cmp * dir;
      // Tiebreaker: busier agencies first, then name (stable order).
      const ac = a.conversation_count ?? 0;
      const bc = b.conversation_count ?? 0;
      if (ac !== bc) return bc - ac;
      return String(a.tenant_id).localeCompare(String(b.tenant_id));
    });
    return list;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  const toggleSort = (key: string) =>
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      // Defaults: text & health ascending (problems first), numbers descending.
      const dir: "asc" | "desc" = key === "tenant" || key === "health" ? "asc" : "desc";
      return { key, dir };
    });

  const resetFilters = () => {
    setQ("");
    setHealthFilter("all");
  };

  // Export the currently filtered + sorted list (the full result, not just the page).
  const exportCsv = () => {
    const headers = [
      "tenant_id",
      "etat",
      "widgets",
      "biens",
      "disponibles",
      "retires",
      "conversations",
      "leads",
      "taux_conversion_pct",
      "dernier_import",
      "erreurs_import",
      "derniere_activite",
    ];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of sorted) {
      lines.push(
        [
          r.tenant_id,
          r.health ?? "",
          (r.widgetIds || []).join("|"),
          r.property_count ?? 0,
          r.available ?? 0,
          r.retired ?? 0,
          r.conversation_count ?? 0,
          r.lead_count ?? 0,
          convRate(r),
          r.lastImportAt ?? r.last_import ?? "",
          r.lastImportErrors ?? "",
          lastActivityOf(r) ?? "",
        ]
          .map(esc)
          .join(","),
      );
    }
    // BOM prefix so Excel reads UTF-8 (accents) correctly.
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chatbots-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Chatbots déployés</CardTitle>
            <CardDescription>
              {rows
                ? `${rows.length} agence(s) · santé & stats live${
                    generatedAt ? ` · maj ${new Date(generatedAt).toLocaleTimeString("fr-FR")}` : ""
                  }`
                : "Une ligne par agence — stats live depuis Neon"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un bot / widget…"
                className="pl-8"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!rows || sorted.length === 0}
              title="Exporter la liste filtrée en CSV"
            >
              <Download className="size-4" /> CSV
            </Button>
          </div>
        </div>

        {/* Health filter chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {HEALTH_FILTERS.map((f) => {
            const active = healthFilter === f.id;
            const count = f.id === "all" ? rows?.length ?? 0 : healthCounts[f.id as Health];
            const dot = f.id === "all" ? null : HEALTH_CONFIG[f.id as Health]?.dot;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setHealthFilter(f.id)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
                {f.label}
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent>
        {healthUnavailable && rows && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 text-amber-400" />
            État de santé indisponible (overview hors ligne) — statistiques affichées sans badge.
          </p>
        )}
        {err ? (
          <ErrorState message={err} onRetry={load} />
        ) : !rows ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Bot className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "Aucun chatbot déployé."
                : "Aucun chatbot ne correspond aux filtres."}
            </p>
            {rows.length > 0 && (q || healthFilter !== "all") && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader label="Chatbot / Agence" sortKey="tenant" sort={sort} onSort={toggleSort} />
                    <SortHeader label="État" sortKey="health" sort={sort} onSort={toggleSort} />
                    <TableHead>Widgets</TableHead>
                    <SortHeader label="Biens" sortKey="properties" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Conv." sortKey="conversations" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Leads" sortKey="leads" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Conv. %" sortKey="conversion" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Dernière activité" sortKey="activity" sort={sort} onSort={toggleSort} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((t: any) => {
                    const conv = t.conversation_count ?? 0;
                    const rate = convRate(t);
                    return (
                      <TableRow
                        key={t.tenant_id}
                        className={cn("cursor-pointer", t.health === "attention" && "bg-amber-500/[0.06]")}
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
                          <div className="flex flex-col items-start gap-0.5">
                            <HealthBadge health={t.health} />
                            {t.lastImportErrors > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                                <AlertTriangle className="size-3" />
                                {t.lastImportErrors} err. import
                              </span>
                            )}
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
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(lastActivityOf(t))}</TableCell>
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
            </div>

            {/* Pager — keeps the table fluid at 350+ agencies */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, sorted.length)} sur {sorted.length}
                </p>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Lignes par page"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {CHATBOTS_PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} / page
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft className="size-4" /> Précédent
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  Suivant <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
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

// ── Surveillance (real-time monitoring wall) ─────────────────────────────────

type LiveStatus = "live" | "active" | "idle" | "offline";

const LIVE_CFG: Record<LiveStatus, { label: string; tag: string; dot: string; tone: string }> = {
  live: { label: "REC", tag: "LIVE", dot: "bg-red-500", tone: "text-red-400" },
  active: { label: "ACTIF", tag: "actif", dot: "bg-emerald-500", tone: "text-emerald-400" },
  idle: { label: "VEILLE", tag: "veille", dot: "bg-amber-400", tone: "text-amber-300" },
  offline: { label: "OFFLINE", tag: "offline", dot: "bg-slate-500", tone: "text-slate-400" },
};

const LIVE_FILTERS: { id: LiveStatus | "all"; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "live", label: "En direct" },
  { id: "active", label: "Actifs 24h" },
  { id: "idle", label: "En veille" },
  { id: "offline", label: "Hors ligne" },
];

/** Compact relative time in French: "à l'instant", "il y a 4 min", "il y a 2 h". */
function relTime(v: any): string {
  if (!v) return "jamais";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 0) return "à l'instant";
  if (s < 45) return "à l'instant";
  if (s < 90) return "il y a 1 min";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return fmtDate(v);
}

function KpiPill({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-[96px] flex-1 rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className={cn("text-xl font-bold leading-none tracking-tight", tone)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SurvTile({ bot, index, onSelect }: { bot: any; index: number; onSelect: (b: any) => void }) {
  const status: LiveStatus = (bot.liveStatus as LiveStatus) || "offline";
  const cfg = LIVE_CFG[status] || LIVE_CFG.offline;
  const live = status === "live";
  const conv = bot.conversation_count ?? 0;
  const leads = bot.lead_count ?? 0;
  const msgs24 = bot.messages24h ?? 0;
  const cam = String(index + 1).padStart(2, "0");
  const lastSeen = relTime(bot.lastActivityAt ?? bot.lastMessageAt ?? bot.last_updated);

  return (
    <button
      onClick={() => onSelect(bot)}
      className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-border bg-gradient-to-br from-slate-900 to-black text-left outline-none transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {/* Feed background */}
      <div className="cam-grain absolute inset-0 opacity-60" />
      {live && <div className="cam-scanline absolute inset-0" />}
      <div className="absolute inset-0 flex items-center justify-center opacity-20">
        <Icon8 name="camera" size={56} alt="" className="grayscale" />
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2 text-[10px] font-medium text-white/80">
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block size-2 rounded-full", cfg.dot, live && "rec-dot")} />
          {cfg.label}
        </span>
        <span className="font-mono">CAM {cam}</span>
      </div>

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/90 to-transparent p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-white">{bot.tenant_id}</span>
          <Badge variant={live ? "default" : "secondary"} className="h-4 shrink-0 px-1.5 text-[9px]">
            {cfg.tag}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="flex items-center gap-1"><MessageSquare className="size-3" />{conv}</span>
          <span className="flex items-center gap-1"><Users className="size-3" />{leads}</span>
          <span className="ml-auto flex items-center gap-1">
            <Radio className="size-3" />
            <span className={cn(msgs24 > 0 ? "text-emerald-400" : "text-slate-400")}>{msgs24} msg/24h</span>
          </span>
        </div>
        <div className="truncate text-[9px] text-white/40">vu {lastSeen}</div>
      </div>
    </button>
  );
}

function DeployRow({ d }: { d: any }) {
  const variant: "default" | "secondary" | "destructive" =
    d.status === "success" ? "default" : d.status === "failure" ? "destructive" : "secondary";
  const dotColor =
    d.status === "success" ? "bg-emerald-500" : d.status === "failure" ? "bg-red-500" : "bg-amber-400";
  const providers = [d.crmProvider, d.llmProvider].filter(Boolean).join(" · ") || "—";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
      <span className={cn("size-2 shrink-0 rounded-full", dotColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{d.agentName || "agent"}</span>
          {d.productionReady && (
            <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[9px] text-emerald-400">prod</Badge>
          )}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{providers} · {relTime(d.at)}</div>
      </div>
      <Badge variant={variant} className="h-5 shrink-0 px-1.5 text-[9px]">{d.status}</Badge>
    </div>
  );
}

function SurveillanceView({ nonce, onSelect }: { nonce: number; onSelect: (b: any) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<LiveStatus | "all">("all");

  // Soft refresh keeps the wall on screen while refetching (no skeleton flash);
  // a hard refresh (initial load / manual retry) shows the skeleton grid.
  const refresh = useCallback((soft: boolean) => {
    if (!soft) {
      setErr("");
      setData(null);
    }
    getJSON("/api/priv/surveillance")
      .then((d: any) => setData(d))
      .catch((e) => {
        if (!soft) setErr(e?.message || "Erreur");
      });
  }, []);

  useEffect(() => {
    refresh(false);
  }, [refresh, nonce]);

  // Near-real-time feel: poll every 12s without clearing the wall.
  useEffect(() => {
    const t = setInterval(() => refresh(true), 12000);
    return () => clearInterval(t);
  }, [refresh]);

  const bots: any[] = data?.bots || [];
  const fleet = data?.fleet;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return bots.filter((b: any) => {
      if (filter !== "all" && b.liveStatus !== filter) return false;
      if (s && !String(b.tenant_id).toLowerCase().includes(s)) return false;
      return true;
    });
  }, [bots, q, filter]);

  return (
    <div className="space-y-4">
      {/* Header + fleet KPIs */}
      <Card className="border-primary/20">
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Icon8 name="controlPanel" size={26} alt="" />
            </span>
            <div className="mr-auto">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Mur de surveillance</CardTitle>
                <BadgeGroup addonText="Live">Flux temps réel des agences</BadgeGroup>
              </div>
              <CardDescription className="mt-1">
                {fleet
                  ? `${fleet.live} en direct · ${fleet.active} actifs · ${fleet.agencies} agences supervisées`
                  : "Connexion aux flux…"}
              </CardDescription>
            </div>
            <div className="relative w-56 max-w-full">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer une agence…" className="pl-8" />
            </div>
          </div>
          {fleet && (
            <div className="flex flex-wrap gap-2">
              <KpiPill label="En direct" value={fleet.live} tone="text-red-400" />
              <KpiPill label="Actifs 24h" value={fleet.active} tone="text-emerald-400" />
              <KpiPill label="Messages 24h" value={fleet.messages24h} />
              <KpiPill label="Conversations 24h" value={fleet.conversations24h} />
              <KpiPill label="Leads 24h" value={fleet.leads24h} />
              <KpiPill label="Conversion" value={`${fleet.avgConversion}%`} />
              <KpiPill label="Hors ligne" value={fleet.offline} tone="text-slate-400" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live status filters */}
      <div className="flex flex-wrap items-center gap-2">
        {LIVE_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {err ? (
        <ErrorState message={err} onRetry={() => refresh(false)} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[16/10] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          {/* Camera wall */}
          <div>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune agence ne correspond au filtre.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((b: any, i: number) => (
                  <SurvTile key={b.tenant_id} bot={b} index={i} onSelect={onSelect} />
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Icons8Attribution />
            </div>
          </div>

          {/* Side panels: deployments + live activity */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Server className="size-4 text-primary" /> Déploiements récents
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Via /factory ou l'API — visibles ici en direct
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.deployments || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun déploiement enregistré.</p>
                ) : (
                  data.deployments.slice(0, 6).map((d: any) => <DeployRow key={d.buildId} d={d} />)
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Activity className="size-4 text-primary" /> Activité live
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {(data.activity || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucune activité récente.</p>
                ) : (
                  data.activity.map((a: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span
                        className={cn(
                          "mt-1 size-1.5 shrink-0 rounded-full",
                          a.type === "deploy" ? "bg-sky-400" : "bg-emerald-400",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground/90">{a.label}</div>
                        <div className="text-[10px] text-muted-foreground">{relTime(a.at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Workers (Cloudflare — Phase 1, lecture seule) ────────────────────────────

const WORKER_STATUS_CFG: Record<
  string,
  { label: string; dot: string; badge: "default" | "secondary" | "destructive" | "outline" }
> = {
  online: { label: "ONLINE", dot: "bg-emerald-500", badge: "default" },
  degraded: { label: "DEGRADED", dot: "bg-amber-400", badge: "secondary" },
  down: { label: "DOWN", dot: "bg-red-500", badge: "destructive" },
  unknown: { label: "—", dot: "bg-slate-500", badge: "outline" },
};

function WorkerDetail({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!name) {
      setData(null);
      setErr("");
      return;
    }
    setData(null);
    setErr("");
    getJSON(`/api/priv/workers/${encodeURIComponent(name)}`)
      .then((d) => setData(d))
      .catch((e) => setErr(e?.message || "Erreur"));
  }, [name]);

  const cfg = data ? WORKER_STATUS_CFG[data.status] || WORKER_STATUS_CFG.unknown : WORKER_STATUS_CFG.unknown;

  return (
    <Dialog open={!!name} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Cloud className="size-4" />
            </span>
            <span className="font-mono">{name}</span>
          </DialogTitle>
          <DialogDescription>Worker Cloudflare · lecture seule (Phase 1)</DialogDescription>
        </DialogHeader>

        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : !data ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                <span className={cn("size-1.5 rounded-full", cfg.dot)} />
                {cfg.label}
              </span>
              {data.latencyMs != null && (
                <span className="text-xs text-muted-foreground">{data.latencyMs} ms</span>
              )}
              {data.url && (
                <a
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Ouvrir <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Compat date" value={data.compatibilityDate || "—"} />
              <Stat label="Usage model" value={data.usageModel || "—"} />
            </div>

            <div className="space-y-1.5 rounded-lg border bg-card/40 p-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground">
                Bindings ({(data.bindings || []).length})
              </div>
              {(data.bindings || []).length === 0 ? (
                <span className="text-xs text-muted-foreground">Aucun binding.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.bindings.map((b: any, i: number) => (
                    <Badge key={i} variant="outline" className="font-mono text-[10px]">
                      {b.name}
                      <span className="ml-1 opacity-60">{b.type}</span>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="pt-1 text-[10px] text-muted-foreground">
                Valeurs masquées (sécurité). Édition & redéploiement = Phase 2.
              </p>
            </div>

            {data.error && <p className="text-xs text-amber-400">{data.error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkersView({ nonce }: { nonce: number }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback((soft: boolean) => {
    if (!soft) {
      setErr("");
      setData(null);
    }
    getJSON("/api/priv/workers")
      .then((d) => setData(d))
      .catch((e) => {
        if (!soft) setErr(e?.message || "Erreur");
      });
  }, []);

  useEffect(() => {
    refresh(false);
  }, [refresh, nonce]);

  useEffect(() => {
    const t = setInterval(() => refresh(true), 30000);
    return () => clearInterval(t);
  }, [refresh]);

  if (err) return <ErrorState message={err} onRetry={() => refresh(false)} />;
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="size-4 text-primary" /> Cloudflare non configuré
          </CardTitle>
          <CardDescription>
            Pour superviser tes Workers, configure un token Cloudflare en lecture seule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Ajoute dans le <code>.env</code> du backend, puis redémarre-le :
          </p>
          <pre className="overflow-x-auto rounded-lg border bg-card/40 p-3 font-mono text-xs">{`CLOUDFLARE_API_TOKEN=...   # permission Workers Scripts: Read
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_WORKERS_SUBDOMAIN=neverdiscord666`}</pre>
          <p>Cette vue affichera alors tes Workers avec leur statut en temps réel.</p>
        </CardContent>
      </Card>
    );
  }

  const s = data.summary || {};
  const workers: any[] = data.workers || [];

  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Cloud className="size-6 text-primary" />
          </span>
          <div className="mr-auto">
            <CardTitle className="text-base">Workers Cloudflare</CardTitle>
            <CardDescription className="mt-1">
              {s.total} workers · {s.online} online · {s.degraded} dégradés · {s.down} down
            </CardDescription>
          </div>
          {data.error && <span className="text-xs text-amber-400">{data.error}</span>}
        </CardContent>
      </Card>

      {workers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun worker déployé.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workers.map((w: any) => {
            const cfg = WORKER_STATUS_CFG[w.status] || WORKER_STATUS_CFG.unknown;
            return (
              <button
                key={w.name}
                onClick={() => setSelected(w.name)}
                className="rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 truncate font-mono text-sm font-semibold">
                    <Cloud className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{w.name}</span>
                  </span>
                  <Badge variant={cfg.badge} className="h-5 shrink-0 gap-1 px-1.5 text-[9px]">
                    <span className={cn("size-1.5 rounded-full", cfg.dot, w.status === "online" && "rec-dot")} />
                    {cfg.label}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Radio className="size-3" />
                    {w.latencyMs != null ? `${w.latencyMs} ms` : "—"}
                  </span>
                  <span className="ml-auto truncate">{w.modifiedOn ? `maj ${relTime(w.modifiedOn)}` : ""}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <WorkerDetail name={selected} onClose={() => setSelected(null)} />
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
          : view === "workers"
            ? "Workers Cloudflare"
            : view === "conversations"
              ? "Conversations & Leads"
              : "Infrastructure";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        view={view}
        setView={setView}
        onLogout={handleLogout}
        health={health}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <span>OracleSentinel ·</span>
              <FlipWords words={["surveillance", "closing", "monitoring", "automation"]} className="font-semibold" />
              <span>· 350+ agences</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
              <ShieldCheck className="size-3" /> Session sécurisée
            </Badge>
            <GradientButton onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="size-4" /> <span className="hidden sm:inline">Rafraîchir</span>
            </GradientButton>
          </div>
        </header>
        <div className="p-4 sm:p-6">
          {view === "overview" && <OverviewView nonce={nonce} />}
          {view === "chatbots" && <ChatbotsView nonce={nonce} />}
          {view === "surveillance" && <SurveillanceView nonce={nonce} onSelect={setSelected} />}
          {view === "workers" && <WorkersView nonce={nonce} />}
          {view === "conversations" && <ConversationsView nonce={nonce} />}
          {view === "infra" && <InfraView nonce={nonce} onHealth={setHealth} />}
        </div>
      </main>
      <BotDetail bot={selected} onClose={() => setSelected(null)} onDeleted={() => setNonce((n) => n + 1)} />
    </div>
  );
}
