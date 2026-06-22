// ============================================================================
// CrmView — per-agency CRM configuration (R17).
// Lets the operator pick an agency (tenant), choose a CRM provider, map fields,
// and store credentials. SECURITY: the stored secret is NEVER shown — the UI
// only reads `hasCredentials` (✅/❌). Secrets are write-only (sent on save).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import {
  listTenants,
  getTenantCrm,
  saveTenantCrm,
  testTenantCrm,
  type TenantRecord,
  type TenantCrmConfig,
  type TenantCrmProvider,
} from "../api";

const PROVIDERS: { id: TenantCrmProvider; label: string }[] = [
  { id: "none", label: "Aucun (push global par défaut)" },
  { id: "twenty", label: "Twenty" },
  { id: "airtable", label: "Airtable" },
  { id: "webhook", label: "Webhook générique" },
];

// Canonical lead fields → provider field names (R17.4).
const MAPPING_FIELDS = ["firstName", "lastName", "phone", "email", "need", "qualification", "notes"] as const;

// Secret inputs per provider (write-only). Labels are non-secret; values never
// come back from the server.
const SECRET_FIELDS: Record<TenantCrmProvider, { key: string; label: string }[]> = {
  none: [],
  twenty: [
    { key: "apiUrl", label: "URL de l'API Twenty" },
    { key: "apiKey", label: "Clé API" },
  ],
  airtable: [{ key: "webhookUrl", label: "URL du webhook Airtable" }],
  webhook: [
    { key: "url", label: "URL du webhook" },
    { key: "secret", label: "Secret (optionnel)" },
    { key: "headerName", label: "Nom d'en-tête d'auth (optionnel)" },
  ],
};

export default function CrmView({ nonce }: { nonce: number }) {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [cfg, setCfg] = useState<TenantCrmConfig | null>(null);
  const [provider, setProvider] = useState<TenantCrmProvider>("none");
  const [enabled, setEnabled] = useState(false);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Load the agency list once (and on refresh).
  useEffect(() => {
    listTenants()
      .then((t) => {
        setTenants(t);
        setTenantId((cur) => cur || (t[0]?.tenantId ?? "default"));
      })
      .catch(() => setTenants([]));
  }, [nonce]);

  const loadConfig = useCallback((id: string) => {
    if (!id) return;
    setLoading(true);
    setErr("");
    setMsg("");
    setSecrets({});
    getTenantCrm(id)
      .then((c) => {
        setCfg(c);
        setProvider(c.provider);
        setEnabled(c.enabled);
        setMappings(c.fieldMappings || {});
      })
      .catch((e) => setErr(e?.message || "Erreur de chargement"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tenantId) loadConfig(tenantId);
  }, [tenantId, loadConfig]);

  const onSave = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      // Only send non-empty secret fields (empty = keep existing).
      const cleanSecrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets)) if (v.trim()) cleanSecrets[k] = v.trim();
      const saved = await saveTenantCrm(tenantId, {
        provider,
        enabled,
        fieldMappings: mappings,
        secrets: Object.keys(cleanSecrets).length ? cleanSecrets : undefined,
      });
      setCfg(saved);
      setSecrets({});
      setMsg("Configuration enregistrée.");
    } catch (e: any) {
      setErr(e?.message || "Échec de l'enregistrement");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await testTenantCrm(tenantId);
      setMsg(`${r.ok ? "✅" : "❌"} ${r.message}`);
    } catch (e: any) {
      setErr(e?.message || "Échec du test");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CRM par agence</CardTitle>
        <CardDescription>
          Chaque agence pousse ses leads qualifiés dans son propre CRM. Les identifiants sont chiffrés au
          repos et ne sont jamais réaffichés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Agency picker */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Agence (tenant)
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="h-9 min-w-[200px] rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {tenants.length === 0 && <option value="default">default</option>}
              {tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.name} — {t.tenantId}
                </option>
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

        {loading ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : (
          <>
            {/* Credentials status — boolean only, NEVER the secret */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-3 text-sm">
              <span className="text-muted-foreground">Identifiants configurés :</span>
              {cfg?.hasCredentials ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-400">✅ Oui</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground">❌ Non</Badge>
              )}
              {cfg?.updatedAt && (
                <span className="ml-auto text-xs text-muted-foreground">
                  maj {new Date(cfg.updatedAt).toLocaleString("fr-FR")}
                </span>
              )}
            </div>

            {/* Provider + enabled */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Fournisseur CRM
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as TenantCrmProvider)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Activer le push vers ce CRM
              </label>
            </div>

            {/* Secrets (write-only) */}
            {SECRET_FIELDS[provider].length > 0 && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Identifiants (laisser vide pour conserver l'existant — jamais réaffiché)
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SECRET_FIELDS[provider].map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {f.label}
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={secrets[f.key] ?? ""}
                        onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                        placeholder={cfg?.hasCredentials ? "•••••••• (conservé)" : ""}
                        className="h-9"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Field mapping */}
            {provider !== "none" && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Correspondance des champs (champ canonique → champ du CRM)
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MAPPING_FIELDS.map((f) => (
                    <label key={f} className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {f}
                      <Input
                        value={mappings[f] ?? ""}
                        onChange={(e) => setMappings((m) => ({ ...m, [f]: e.target.value }))}
                        placeholder={f}
                        className="h-9"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {err && <p className="text-sm text-red-400">{err}</p>}
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}

            <div className="flex flex-wrap gap-2">
              <Button onClick={onSave} disabled={busy || !tenantId}>Enregistrer</Button>
              <Button variant="outline" onClick={onTest} disabled={busy || !tenantId || provider === "none"}>
                Tester la connexion
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
