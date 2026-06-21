// ============================================================================
// Tenant Config Service — per-agency configuration overrides (Phase 2 Option B)
// ============================================================================
// Lets an admin customize ONE tenant's bot identity + personality without
// affecting the others. Effective behavior = GLOBAL config (.env / domain
// template) + this tenant's partial override appended to the system prompt.
//
// SAFETY:
//   - Overrides only ever hold a WHITELISTED, NON-SECRET subset (branding +
//     personality + free-form instructions + public contact details + canned
//     messages). sanitizeOverride() drops anything else, so a malicious or
//     malformed payload can never inject secrets or arbitrary fields.
//   - Read path (chat hot path) is cached (TTL) and degrades to "no override"
//     on any DB error — a tenant config hiccup can NEVER break chat.
//   - Every save is versioned (append-only) for audit + rollback.
//   - buildIdentityPromptBlock() is a PURE function (unit-testable) and returns
//     "" when there is nothing to override → runtime prompt stays byte-identical
//     to today for tenants without an override.
// ============================================================================

import { pool } from "../db/pool";
import type { AgentConfig } from "../factory/types";

export const WRITING_STYLES = [
  "professional",
  "friendly",
  "casual",
  "formal",
  "technical",
] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number];

export const TONES = [
  "warm",
  "neutral",
  "authoritative",
  "empathetic",
  "direct",
] as const;
export type ToneOfVoice = (typeof TONES)[number];

export interface TenantOverride {
  branding?: {
    agentName?: string;
    agencyName?: string;
    tagline?: string;
  };
  personality?: {
    writingStyle?: WritingStyle;
    toneOfVoice?: ToneOfVoice;
    maxResponseWords?: number;
    language?: string;
    systemPromptModifiers?: string[];
    customInstructions?: string;
  };
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
    hours?: string;
  };
  messages?: {
    welcome?: string;
    fallback?: string;
  };
}

export interface TenantConfigRecord {
  tenantId: string;
  override: TenantOverride;
  updatedAt: string | null;
  updatedBy: string | null;
}

const CACHE_TTL_MS = Number(process.env.TENANT_CONFIG_CACHE_MS ?? 30000);
const MAX_NAME = 80;
const MAX_LANG = 24;
const MAX_MODIFIER = 280;
const MAX_MODIFIERS = 20;
const MAX_TAGLINE = 120;
const MAX_CUSTOM_INSTRUCTIONS = 2000;
const MAX_CONTACT = 160; // phone / email / website / hours
const MAX_ADDRESS = 240;
const MAX_MESSAGE = 500; // welcome / fallback

// ── Pure helpers (no I/O) ────────────────────────────────────────────────────

function cleanStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/**
 * Whitelist + validate an arbitrary payload into a safe TenantOverride.
 * Anything not explicitly allowed (incl. any secret-looking field) is dropped.
 * Pure + deterministic → unit-testable.
 */
export function sanitizeOverride(raw: any): TenantOverride {
  const out: TenantOverride = {};
  if (!raw || typeof raw !== "object") return out;

  // ── branding (names only — no logo/colors here, no secrets) ──
  const branding: TenantOverride["branding"] = {};
  const agentName = cleanStr(raw?.branding?.agentName, MAX_NAME);
  const agencyName = cleanStr(raw?.branding?.agencyName, MAX_NAME);
  const tagline = cleanStr(raw?.branding?.tagline, MAX_TAGLINE);
  if (agentName !== undefined) branding.agentName = agentName;
  if (agencyName !== undefined) branding.agencyName = agencyName;
  if (tagline !== undefined) branding.tagline = tagline;
  if (Object.keys(branding).length > 0) out.branding = branding;

  // ── personality ──
  const personality: TenantOverride["personality"] = {};
  const ws = raw?.personality?.writingStyle;
  if (typeof ws === "string" && (WRITING_STYLES as readonly string[]).includes(ws)) {
    personality.writingStyle = ws as WritingStyle;
  }
  const tone = raw?.personality?.toneOfVoice;
  if (typeof tone === "string" && (TONES as readonly string[]).includes(tone)) {
    personality.toneOfVoice = tone as ToneOfVoice;
  }
  const maxWords = raw?.personality?.maxResponseWords;
  if (maxWords !== undefined && maxWords !== null && maxWords !== "") {
    const n = Math.round(Number(maxWords));
    if (Number.isFinite(n)) {
      personality.maxResponseWords = Math.min(300, Math.max(10, n));
    }
  }
  const language = cleanStr(raw?.personality?.language, MAX_LANG);
  if (language !== undefined) personality.language = language;

  const mods = raw?.personality?.systemPromptModifiers;
  if (Array.isArray(mods)) {
    const clean = mods
      .map((m) => cleanStr(m, MAX_MODIFIER))
      .filter((m): m is string => !!m)
      .slice(0, MAX_MODIFIERS);
    if (clean.length > 0) personality.systemPromptModifiers = clean;
  }
  const customInstructions = cleanStr(
    raw?.personality?.customInstructions,
    MAX_CUSTOM_INSTRUCTIONS,
  );
  if (customInstructions !== undefined) {
    personality.customInstructions = customInstructions;
  }
  if (Object.keys(personality).length > 0) out.personality = personality;

  // ── contact (public agency coordinates — no secrets) ──
  const contact: TenantOverride["contact"] = {};
  const phone = cleanStr(raw?.contact?.phone, MAX_CONTACT);
  const email = cleanStr(raw?.contact?.email, MAX_CONTACT);
  const address = cleanStr(raw?.contact?.address, MAX_ADDRESS);
  const website = cleanStr(raw?.contact?.website, MAX_CONTACT);
  const hours = cleanStr(raw?.contact?.hours, MAX_CONTACT);
  if (phone !== undefined) contact.phone = phone;
  if (email !== undefined) contact.email = email;
  if (address !== undefined) contact.address = address;
  if (website !== undefined) contact.website = website;
  if (hours !== undefined) contact.hours = hours;
  if (Object.keys(contact).length > 0) out.contact = contact;

  // ── messages (canned welcome / fallback copy) ──
  const messages: TenantOverride["messages"] = {};
  const welcome = cleanStr(raw?.messages?.welcome, MAX_MESSAGE);
  const fallback = cleanStr(raw?.messages?.fallback, MAX_MESSAGE);
  if (welcome !== undefined) messages.welcome = welcome;
  if (fallback !== undefined) messages.fallback = fallback;
  if (Object.keys(messages).length > 0) out.messages = messages;

  return out;
}

/** True when the override carries no usable field. */
export function isEmptyOverride(o: TenantOverride | null | undefined): boolean {
  if (!o) return true;
  const b = o.branding ?? {};
  const p = o.personality ?? {};
  const c = o.contact ?? {};
  const m = o.messages ?? {};
  const hasB = !!(b.agentName || b.agencyName || b.tagline);
  const hasP = !!(
    p.writingStyle ||
    p.toneOfVoice ||
    (typeof p.maxResponseWords === "number") ||
    p.language ||
    (p.systemPromptModifiers && p.systemPromptModifiers.length > 0) ||
    p.customInstructions
  );
  const hasC = !!(c.phone || c.email || c.address || c.website || c.hours);
  const hasM = !!(m.welcome || m.fallback);
  return !hasB && !hasP && !hasC && !hasM;
}

const STYLE_LABEL: Record<WritingStyle, string> = {
  professional: "professionnel",
  friendly: "amical",
  casual: "décontracté",
  formal: "formel",
  technical: "technique",
};
const TONE_LABEL: Record<ToneOfVoice, string> = {
  warm: "chaleureux",
  neutral: "neutre",
  authoritative: "qui fait autorité",
  empathetic: "empathique",
  direct: "direct",
};

/**
 * Build the per-tenant identity/personality block appended to the system
 * prompt. PURE function. Returns "" when there is nothing to override, so the
 * runtime prompt is unchanged for tenants without an override.
 */
export function buildIdentityPromptBlock(
  override: TenantOverride | null | undefined,
): string {
  if (isEmptyOverride(override)) return "";
  const o = override as TenantOverride;
  const b = o.branding ?? {};
  const p = o.personality ?? {};
  const c = o.contact ?? {};
  const m = o.messages ?? {};
  const lines: string[] = [];

  if (b.agentName && b.agencyName) {
    lines.push(`- Tu es ${b.agentName}, l'assistant de ${b.agencyName}.`);
  } else if (b.agentName) {
    lines.push(`- Tu es ${b.agentName}.`);
  } else if (b.agencyName) {
    lines.push(`- Tu représentes ${b.agencyName}.`);
  }
  if (b.tagline) lines.push(`- Slogan: ${b.tagline}`);

  if (p.writingStyle || p.toneOfVoice) {
    const parts: string[] = [];
    if (p.writingStyle) parts.push(`style ${STYLE_LABEL[p.writingStyle]}`);
    if (p.toneOfVoice) parts.push(`ton ${TONE_LABEL[p.toneOfVoice]}`);
    lines.push(`- Adopte un ${parts.join(", ")}.`);
  }
  if (p.language) lines.push(`- Réponds en ${p.language}.`);
  if (typeof p.maxResponseWords === "number") {
    lines.push(`- Maximum ${p.maxResponseWords} mots par réponse.`);
  }
  for (const mod of p.systemPromptModifiers ?? []) {
    lines.push(`- ${mod}`);
  }
  if (m.welcome) {
    lines.push(`- Message d'accueil suggéré: "${m.welcome}"`);
  }
  if (m.fallback) {
    lines.push(`- En cas d'incompréhension, réponds dans l'esprit: "${m.fallback}"`);
  }

  // Labelled sub-sections, kept separate so they stand out in the prompt.
  const blocks: string[] = [];
  if (lines.length > 0) blocks.push(lines.join("\n"));

  if (p.customInstructions) {
    blocks.push(
      "📌 INSTRUCTIONS SPÉCIFIQUES (prioritaires)\n" + p.customInstructions,
    );
  }

  if (c.phone || c.email || c.address || c.website || c.hours) {
    const contactLines: string[] = [];
    if (c.phone) contactLines.push(`- Téléphone: ${c.phone}`);
    if (c.email) contactLines.push(`- Email: ${c.email}`);
    if (c.address) contactLines.push(`- Adresse: ${c.address}`);
    if (c.website) contactLines.push(`- Site web: ${c.website}`);
    if (c.hours) contactLines.push(`- Horaires: ${c.hours}`);
    blocks.push("📞 Coordonnées de l'agence\n" + contactLines.join("\n"));
  }

  if (blocks.length === 0) return "";

  return (
    "\n\n━━━━━━━━━━━━━━━━━━━━━━\n" +
    "🏷️ IDENTITÉ & STYLE DE CETTE AGENCE (prioritaire sur les règles génériques)\n" +
    "━━━━━━━━━━━━━━━━━━━━━━\n" +
    blocks.join("\n\n")
  );
}

// ── Cache (per-tenant, TTL) ──────────────────────────────────────────────────

const cache = new Map<string, { at: number; value: TenantOverride | null }>();

function cacheGet(tenantId: string): TenantOverride | null | undefined {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  return undefined;
}
function cacheSet(tenantId: string, value: TenantOverride | null): void {
  cache.set(tenantId, { at: Date.now(), value });
}

/** Test/ops helper. */
export function resetTenantConfigCache(): void {
  cache.clear();
}

// ── DB access ────────────────────────────────────────────────────────────────

/**
 * Read a tenant's override. CACHED + degrades to null on any error
 * (the chat hot path must never throw because of tenant config).
 */
export async function getTenantOverride(
  tenantId: string,
): Promise<TenantOverride | null> {
  const cached = cacheGet(tenantId);
  if (cached !== undefined) return cached;
  try {
    const r = await pool.query(
      `SELECT overrides FROM tenant_configs WHERE tenant_id = $1`,
      [tenantId],
    );
    const raw = r.rows[0]?.overrides ?? null;
    const value = raw ? sanitizeOverride(raw) : null;
    cacheSet(tenantId, value);
    return value;
  } catch {
    cacheSet(tenantId, null);
    return null;
  }
}

/**
 * The prompt block to append for this tenant (cached read + pure build).
 * Returns "" when no override → prompt identical to today.
 */
export async function getEffectiveIdentityPromptBlock(
  tenantId: string,
): Promise<string> {
  const override = await getTenantOverride(tenantId);
  return buildIdentityPromptBlock(override);
}

/** Full record for the QG editor. */
export async function getTenantConfig(
  tenantId: string,
): Promise<TenantConfigRecord> {
  const r = await pool.query(
    `SELECT tenant_id, overrides, updated_at, updated_by
     FROM tenant_configs WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = r.rows[0];
  return {
    tenantId,
    override: row?.overrides ? sanitizeOverride(row.overrides) : {},
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * Save (upsert) a tenant override + append a version row. Sanitizes first, so
 * only whitelisted non-secret fields are ever persisted. Invalidates cache.
 */
export async function saveTenantOverride(
  tenantId: string,
  rawOverride: any,
  updatedBy: string | null,
): Promise<TenantConfigRecord> {
  const clean = sanitizeOverride(rawOverride);
  const json = JSON.stringify(clean);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenant_configs (tenant_id, overrides, updated_at, updated_by)
       VALUES ($1, $2::jsonb, NOW(), $3)
       ON CONFLICT (tenant_id) DO UPDATE
         SET overrides = EXCLUDED.overrides,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
      [tenantId, json, updatedBy],
    );
    await client.query(
      `INSERT INTO tenant_config_versions (tenant_id, overrides, created_by)
       VALUES ($1, $2::jsonb, $3)`,
      [tenantId, json, updatedBy],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  cacheSet(tenantId, isEmptyOverride(clean) ? null : clean);
  return getTenantConfig(tenantId);
}

export interface TenantConfigVersion {
  id: number;
  override: TenantOverride;
  createdAt: string;
  createdBy: string | null;
}

export async function getTenantConfigVersions(
  tenantId: string,
  limit = 20,
): Promise<TenantConfigVersion[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
  const r = await pool.query(
    `SELECT id, overrides, created_at, created_by
     FROM tenant_config_versions
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, safeLimit],
  );
  return r.rows.map((row: any) => ({
    id: Number(row.id),
    override: row.overrides ? sanitizeOverride(row.overrides) : {},
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by ?? null,
  }));
}

/** Restore a previous version (re-saves it as the current override + new version). */
export async function rollbackTenantConfig(
  tenantId: string,
  versionId: number,
  updatedBy: string | null,
): Promise<TenantConfigRecord> {
  const r = await pool.query(
    `SELECT overrides FROM tenant_config_versions WHERE id = $1 AND tenant_id = $2`,
    [versionId, tenantId],
  );
  if (!r.rows[0]) {
    throw new Error("Version introuvable pour ce tenant");
  }
  return saveTenantOverride(tenantId, r.rows[0].overrides, updatedBy);
}


// ============================================================================
// Factory → QG bridge
// ============================================================================
// When an agent is deployed via /factory (PUT /config), mirror the deployed
// identity/personality into each tenant's override so the Command Center shows
// the REAL deployed values (not blanks) and the runtime applies them.
//
// MERGE RULE: an existing QG-set value is NEVER overwritten — we only fill
// gaps. So re-deploying fills missing fields without clobbering manual QG edits.

const SEED_TENANT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

/** Derive a whitelisted TenantOverride from a full (global) AgentConfig. */
export function buildOverrideFromAgentConfig(config: AgentConfig): TenantOverride {
  return sanitizeOverride({
    branding: {
      agentName: config?.branding?.agentName,
      agencyName: config?.branding?.agencyName,
    },
    personality: {
      writingStyle: config?.personality?.writingStyle,
      toneOfVoice: config?.personality?.toneOfVoice,
      maxResponseWords: config?.personality?.maxResponseWords,
      language: config?.personality?.language,
      systemPromptModifiers: config?.personality?.systemPromptModifiers,
    },
  });
}

/** Merge two overrides, preferring EXISTING (QG) values; incoming only fills gaps. */
function mergeOverridePreferExisting(
  existing: TenantOverride | null,
  incoming: TenantOverride,
): TenantOverride {
  const e = existing ?? {};
  return sanitizeOverride({
    branding: {
      agentName: e.branding?.agentName ?? incoming.branding?.agentName,
      agencyName: e.branding?.agencyName ?? incoming.branding?.agencyName,
      tagline: e.branding?.tagline ?? incoming.branding?.tagline,
    },
    personality: {
      writingStyle: e.personality?.writingStyle ?? incoming.personality?.writingStyle,
      toneOfVoice: e.personality?.toneOfVoice ?? incoming.personality?.toneOfVoice,
      maxResponseWords:
        e.personality?.maxResponseWords ?? incoming.personality?.maxResponseWords,
      language: e.personality?.language ?? incoming.personality?.language,
      systemPromptModifiers: e.personality?.systemPromptModifiers?.length
        ? e.personality.systemPromptModifiers
        : incoming.personality?.systemPromptModifiers,
      customInstructions:
        e.personality?.customInstructions ?? incoming.personality?.customInstructions,
    },
    contact: {
      phone: e.contact?.phone ?? incoming.contact?.phone,
      email: e.contact?.email ?? incoming.contact?.email,
      address: e.contact?.address ?? incoming.contact?.address,
      website: e.contact?.website ?? incoming.contact?.website,
      hours: e.contact?.hours ?? incoming.contact?.hours,
    },
    messages: {
      welcome: e.messages?.welcome ?? incoming.messages?.welcome,
      fallback: e.messages?.fallback ?? incoming.messages?.fallback,
    },
  });
}

/**
 * Seed/refresh per-tenant overrides from a deployed AgentConfig. Targets every
 * tenant in security.widgetTenantMap plus "default". Never clobbers existing QG
 * values (gap-fill only) and skips tenants whose effective override is
 * unchanged (no redundant version rows). Best-effort per tenant; never throws.
 * Returns the list of tenant ids that were written.
 */
export async function seedTenantConfigsFromFactory(
  config: AgentConfig,
): Promise<string[]> {
  const incoming = buildOverrideFromAgentConfig(config);
  if (isEmptyOverride(incoming)) return [];

  const tenants = new Set<string>(["default"]);
  const map = config?.security?.widgetTenantMap ?? {};
  for (const tid of Object.values(map)) {
    if (typeof tid === "string" && SEED_TENANT_ID_RE.test(tid.trim())) {
      tenants.add(tid.trim());
    }
  }

  const seeded: string[] = [];
  for (const tenantId of tenants) {
    try {
      const existing = await getTenantOverride(tenantId);
      const merged = mergeOverridePreferExisting(existing, incoming);
      if (isEmptyOverride(merged)) continue;
      // Skip when nothing actually changes → avoids redundant version rows.
      if (existing && JSON.stringify(existing) === JSON.stringify(merged)) continue;
      await saveTenantOverride(tenantId, merged, "factory");
      seeded.push(tenantId);
    } catch {
      // best-effort: skip this tenant on any error (never break a deploy)
    }
  }
  return seeded;
}
