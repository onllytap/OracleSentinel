// ============================================================================
// Factory Input Validation — Zod Schemas for All API Endpoints
// ============================================================================
// Every payload that enters the Factory API is validated here.
// Zero trust: validate everything, reject early, return clear French errors.
//
// Compatible with Zod v4 (^4.3.6) — uses `error`/`message` params, not
// `required_error`/`invalid_type_error`/`errorMap` which are Zod v3 only.
//
// Usage in routes:
//   import { validateBody, validateQuery, schemas } from '../factory/validation';
//   router.put('/config', validateBody(schemas.putConfig), async (req, res) => { ... });
// ============================================================================

import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// ── Reusable Primitives ────────────────────────────────────────────────────

const nonEmptyString = (label: string) =>
  z
    .string({ error: `${label} est requis` })
    .min(1, `${label} ne peut pas être vide`);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Couleur hex invalide (ex: #6366f1)")
  .default("#6366f1");

const urlString = z
  .string()
  .url("URL invalide")
  .or(z.literal(""))
  .optional()
  .default("");

const positiveInt = (label: string) =>
  z
    .number({ error: `${label} doit être un nombre entier positif` })
    .int(`${label} doit être un entier`)
    .nonnegative(`${label} doit être positif ou zéro`);

const percentage = (label: string) =>
  z.number().min(0, `${label} minimum: 0`).max(100, `${label} maximum: 100`);

const tenantIdValue = nonEmptyString("tenant_id")
  .trim()
  .max(128, "tenant_id: 128 caractères max")
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "tenant_id invalide (caractères autorisés: lettres, chiffres, _, ., -)",
  );

// ── Enum Types (matching types.ts) ─────────────────────────────────────────

const writingStyleEnum = z.enum(
  ["professional", "friendly", "casual", "formal", "technical"],
  {
    error:
      "Style d'écriture invalide (professional | friendly | casual | formal | technical)",
  },
);

const toneOfVoiceEnum = z.enum(
  ["warm", "neutral", "authoritative", "empathetic", "direct"],
  {
    error:
      "Ton de voix invalide (warm | neutral | authoritative | empathetic | direct)",
  },
);

const crmProviderEnum = z.enum(["twenty", "airtable", "none"], {
  error: "Fournisseur CRM invalide (twenty | airtable | none)",
});

const duplicateStrategyEnum = z.enum(
  ["skip", "update", "create_always", "fail"],
  {
    error:
      "Stratégie de doublons invalide (skip | update | create_always | fail)",
  },
);

const identityKeyEnum = z.enum(["phone", "email", "externalid"], {
  error: "Clé d'identité invalide (phone | email | externalid)",
});

const logLevelEnum = z.enum(["silent", "error", "warn", "info", "debug"], {
  error: "Niveau de log invalide (silent | error | warn | info | debug)",
});

const errorModeEnum = z.enum(["strict", "permissive"], {
  error: "Mode d'erreur invalide (strict | permissive)",
});

const agentNoteStyleEnum = z.enum(["formal", "casual", "technical"], {
  error: "Style de note invalide (formal | casual | technical)",
});

const notifyChannelEnum = z.enum(["slack", "email", "none"], {
  error: "Canal de notification invalide (slack | email | none)",
});

const llmProviderEnum = z.enum(
  ["groq", "openrouter", "openai", "anthropic", "custom"],
  {
    error:
      "Fournisseur LLM invalide (groq | openrouter | openai | anthropic | custom)",
  },
);

const embedModeEnum = z.enum(["hosted", "bundle"], {
  error: "Mode embed invalide (hosted | bundle)",
});

// ── Sub-Schemas ────────────────────────────────────────────────────────────

const themeColorsSchema = z.object({
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  background: hexColor,
  surface: hexColor,
  text: hexColor,
});

const brandingSchema = z.object({
  agentName: nonEmptyString("Nom de l'agent").max(
    200,
    "Nom de l'agent: 200 caractères max",
  ),
  agencyName: nonEmptyString("Nom de l'agence").max(
    200,
    "Nom de l'agence: 200 caractères max",
  ),
  logoUrl: urlString,
  avatarUrl: urlString,
  themeColors: themeColorsSchema.optional().default({
    primary: "#6366f1",
    secondary: "#8b5cf6",
    accent: "#06b6d4",
    background: "#050a18",
    surface: "#0b1228",
    text: "#e5e7eb",
  }),
});

const personalitySchema = z.object({
  writingStyle: writingStyleEnum.default("professional"),
  toneOfVoice: toneOfVoiceEnum.default("warm"),
  systemPromptModifiers: z.array(z.string()).default([]),
  knowledgeBaseUrls: z.array(z.string()).default([]),
  maxResponseWords: positiveInt("Mots max par réponse").max(5000).default(300),
  language: z.string().min(2).max(5).default("fr"),
});

const crmStrictSchema = z.object({
  requireId: z.boolean().default(true),
  verifyWrite: z.boolean().default(true),
  customFields: z.boolean().default(false),
});

const crmRetrySchema = z.object({
  maxRetries: positiveInt("Max retries").max(10).default(3),
  delayMs: positiveInt("Retry delay").max(60000).default(1000),
  timeoutMs: positiveInt("Timeout").max(120000).default(10000),
});

const airtableProviderSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
  timeoutMs: positiveInt("Airtable timeout").max(120000).default(10000),
  fieldMappings: z.record(z.string(), z.string()).default({}),
});

const twentyProviderSchema = z.object({
  enabled: z.boolean().default(false),
  apiUrl: z.string().default(""),
  apiKey: z.string().default(""),
  timeoutMs: positiveInt("Twenty timeout").max(120000).default(10000),
  customFields: z.boolean().default(false),
  fieldMappings: z.record(z.string(), z.string()).default({}),
  defaultSource: z.string().default("chatbot"),
  defaultPhoneCountry: z.string().max(5).default("+33"),
});

const crmConfigSchema = z.object({
  provider: crmProviderEnum.default("none"),
  enabled: z.boolean().default(false),
  minPushScore: percentage("Score minimum de push").default(60),
  identityKey: identityKeyEnum.default("phone"),
  duplicateStrategy: duplicateStrategyEnum.default("update"),
  blockIfIncomplete: z.boolean().default(false),
  requiredFields: z.array(z.string()).default([]),
  minMessagesBeforePush: positiveInt("Messages min avant push")
    .max(100)
    .default(3),
  maxPushesPerSession: positiveInt("Push max par session").max(50).default(2),
  pushCooldownSeconds: positiveInt("Cooldown push").max(3600).default(60),
  pushDelayMs: positiveInt("Délai push").max(30000).default(0),
  strict: crmStrictSchema.default({
    requireId: true,
    verifyWrite: true,
    customFields: false,
  }),
  fallbackBaseFields: z.boolean().default(true),
  retry: crmRetrySchema.default({
    maxRetries: 3,
    delayMs: 1000,
    timeoutMs: 10000,
  }),
  rateLimitPerMinute: positiveInt("Rate limit/min").max(1000).default(30),
  includeAgentNote: z.boolean().default(true),
  includeTranscript: z.boolean().default(false),
  notesMaxLength: positiveInt("Longueur max notes").max(50000).default(2000),
  agentNoteStyle: agentNoteStyleEnum.default("formal"),
  agentNoteLanguage: z.string().default("fr"),
  agentNoteMaxLength: positiveInt("Longueur max note agent")
    .max(50000)
    .default(500),
  capitalizeNames: z.boolean().default(true),
  trimFields: z.boolean().default(true),
  validatePhone: z.boolean().default(true),
  validateEmail: z.boolean().default(true),
  normalizePhone: z.boolean().default(true),
  logLevel: logLevelEnum.default("info"),
  hashPiiInLogs: z.boolean().default(true),
  structuredLogs: z.boolean().default(true),
  debugPayloads: z.boolean().default(false),
  notifyOnSuccess: z.boolean().default(false),
  notifyOnFailure: z.boolean().default(true),
  notifyChannel: notifyChannelEnum.default("none"),
  errorMode: errorModeEnum.default("permissive"),
  webhooksEnabled: z.boolean().default(false),
  webhookSecret: z.string().default(""),
  airtable: airtableProviderSchema.optional(),
  twenty: twentyProviderSchema.optional(),
});

const groqLlmSchema = z.object({
  model: z.string().default("llama-3.3-70b-versatile"),
  apiKeys: z.array(z.string()).default([]),
  maxTokensNormal: positiveInt("Max tokens normal").max(32000).default(700),
  maxTokensShort: positiveInt("Max tokens short").max(32000).default(300),
  keyCooldownMs: positiveInt("Key cooldown").max(60000).default(500),
});

const openrouterLlmSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().url().default("https://openrouter.ai/api/v1"),
  appName: z.string().default("OracleSentinel"),
  maxTokensNormal: positiveInt("Max tokens normal").max(32000).default(700),
  maxTokensShort: positiveInt("Max tokens short").max(32000).default(300),
  historyMaxMessages: positiveInt("Historique max messages")
    .max(100)
    .default(20),
});

const openaiLlmSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default("https://api.openai.com/v1"),
  model: z.string().default("gpt-4o"),
  maxTokens: positiveInt("Max tokens").max(128000).default(4096),
});

const anthropicLlmSchema = z.object({
  apiKey: z.string().default(""),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: positiveInt("Max tokens").max(128000).default(4096),
});

const customLlmSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  model: z.string().default(""),
  maxTokens: positiveInt("Max tokens").max(128000).default(4096),
});

const llmConfigSchema = z.object({
  provider: llmProviderEnum.default("groq"),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  timeoutMs: positiveInt("Timeout LLM").max(120000).default(30000),
  maxRetries: positiveInt("Max retries LLM").max(10).default(3),
  maxTokens: positiveInt("Max tokens LLM").max(128000).default(4096),
  groq: groqLlmSchema.optional(),
  openrouter: openrouterLlmSchema.optional(),
  openai: openaiLlmSchema.optional(),
  anthropic: anthropicLlmSchema.optional(),
  custom: customLlmSchema.optional(),
});

const knowledgeConfigSchema = z.object({
  urls: z.array(z.string()).default([]),
  maxUrls: positiveInt("Max URLs").max(100).default(10),
  cacheTtl: positiveInt("Cache TTL").default(3600),
  fetchTimeoutMs: positiveInt("Fetch timeout").max(120000).default(10000),
  catalogFallbackScraper: z.boolean().default(false),
  xmlEnabled: z.boolean().default(true),
  xmlMaxSizeMb: z.number().min(0).max(100).default(10),
});

const ragConfigSchema = z.object({
  enabled: z.boolean().default(false),
  forceLookupOnIntent: z.boolean().default(false),
  minConfidence: z.number().min(0).max(1).default(0.7),
});

const factoryBuildConfigSchema = z.object({
  buildStrict: z.boolean().default(false),
  embedMode: embedModeEnum.default("hosted"),
  agentApiKeyRequired: z.boolean().default(false),
  agentKillSwitch: z.boolean().default(false),
});

const securityConfigSchema = z.object({
  jwtIssuer: z.string().default("oraclebot"),
  jwtAudience: z.string().default("oraclebot"),
  jwtTtlSeconds: positiveInt("JWT TTL").max(86400).default(1200),
  jwtAlg: z.string().default("HS256"),
  allowedOrigins: z.array(z.string()).default([]),
  widgetTenantMap: z.record(z.string(), z.string()).default({}),
});

const serverConfigSchema = z.object({
  port: positiveInt("Port").max(65535).default(3001),
  nodeEnv: z.string().default("production"),
  databaseUrl: z.string().default(""),
  preferredLanguage: z.string().default("fr"),
});

const scraperConfigSchema = z
  .object({
    cardSelector: z.string().default(""),
    priceSelector: z.string().default(""),
    locationSelector: z.string().default(""),
    typeSelector: z.string().default(""),
    linkSelector: z.string().default(""),
    descriptionSelector: z.string().default(""),
    featuresSelector: z.string().default(""),
    loadDelay: positiveInt("Load delay").max(30000).default(2000),
  })
  .optional();

// ── Complete AgentConfig Schema ────────────────────────────────────────────

const agentConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
  branding: brandingSchema,
  personality: personalitySchema,
  crm: crmConfigSchema,
  llm: llmConfigSchema,
  knowledge: knowledgeConfigSchema,
  security: securityConfigSchema,
  rag: ragConfigSchema,
  factory: factoryBuildConfigSchema,
  variables: z.record(z.string(), z.string()).default({}),
  server: serverConfigSchema,
  scraper: scraperConfigSchema,
});

// ── API Endpoint Schemas ───────────────────────────────────────────────────

/** PUT /api/factory/config — body schema */
const putConfigBodySchema = z.object({
  config: agentConfigSchema,
});

/** POST /api/factory/diff — body schema */
const diffConfigBodySchema = z.object({
  config: agentConfigSchema,
});

/** POST /api/factory/build — body schema (config optional; reads from .env if absent) */
const postBuildBodySchema = z
  .object({
    config: agentConfigSchema.optional(),
  })
  .default({});

/** GET /api/factory/logs — query schema */
const getLogsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v || "50", 10);
      return isNaN(n) ? 50 : Math.min(Math.max(1, n), 200);
    }),
  level: z.enum(["info", "warn", "error", "debug"]).optional(),
});

/** GET /api/factory/builds — query schema */
const getBuildsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v || "50", 10);
      return isNaN(n) ? 50 : Math.min(Math.max(1, n), 200);
    }),
});

/** POST /api/factory/knowledge/import/* — query schema */
const knowledgeImportQuerySchema = z.object({
  tenant_id: tenantIdValue.optional(),
});

/** POST /api/factory/llm/test — body schema */
const llmTestBodySchema = z
  .object({
    prompt: z.string().max(1000).default("Dis bonjour en une phrase."),
  })
  .default({ prompt: "Dis bonjour en une phrase." });

/** POST /api/factory/crm/test — body (empty or absent) */
const crmTestBodySchema = z.object({}).default({});

/** POST /api/factory/test/webhook — body schema */
const webhookTestBodySchema = z.object({
  url: z.string().url("URL invalide"),
});

/** GET /api/factory/builds/:buildId — param schema */
const buildIdParamSchema = z.object({
  buildId: z
    .string()
    .regex(
      /^build-[a-f0-9]{8}$/,
      "Build ID invalide (format attendu: build-xxxxxxxx)",
    ),
});

/** POST /api/factory/rollback/latest — body (empty) */
const rollbackBodySchema = z.object({}).default({});

/** DELETE /api/factory/knowledge/tenants/:tenantId — param schema */
const tenantIdParamSchema = z.object({
  tenantId: tenantIdValue,
});

/** GET /api/factory/proxy — query schema */
const proxyQuerySchema = z.object({
  url: z.string().url("URL invalide pour le proxy"),
});

// ── Middleware Factories ───────────────────────────────────────────────────

/**
 * Express middleware that validates `req.body` against a Zod schema.
 * On success, `req.body` is replaced with the parsed (coerced + defaulted) value.
 * On failure, returns 400 with structured French error messages.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: "Validation échouée",
        details: errors,
      });
    }
    req.body = result.data;
    return next();
  };
}

/**
 * Express middleware that validates `req.query` against a Zod schema.
 * On success, parsed values are stored on `req.validatedQuery`.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: "Paramètres de requête invalides",
        details: errors,
      });
    }
    // Overwrite query with parsed values (transforms applied)
    (req as any).validatedQuery = result.data;
    return next();
  };
}

/**
 * Express middleware that validates `req.params` against a Zod schema.
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: "Paramètres de route invalides",
        details: errors,
      });
    }
    (req as any).validatedParams = result.data;
    return next();
  };
}

// ── Error Formatting ───────────────────────────────────────────────────────

interface ValidationError {
  path: string;
  message: string;
}

function formatZodErrors(error: z.ZodError): ValidationError[] {
  // Zod v4: error.issues is the array of issue objects
  const issues = (error as any).issues || (error as any).errors || [];
  return issues.map((e: any) => ({
    path: (e.path || []).join(".") || "(racine)",
    message: e.message || String(e),
  }));
}

// ── Standalone Validation (for use outside Express) ────────────────────────

/**
 * Validate an AgentConfig object directly (used by build pipeline, tests, etc.)
 * Returns { success: true, data } or { success: false, errors }.
 */
export function validateAgentConfig(
  config: unknown,
):
  | { success: true; data: z.infer<typeof agentConfigSchema> }
  | { success: false; errors: ValidationError[] } {
  const result = agentConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatZodErrors(result.error) };
}

/**
 * Coerce and fill defaults on a partial config.
 * Useful when loading from .env where many fields might be missing.
 * Throws on truly invalid data (wrong types, etc.)
 */
export function coerceAgentConfig(
  partialConfig: unknown,
): z.infer<typeof agentConfigSchema> {
  return agentConfigSchema.parse(partialConfig);
}

// ── Export All Schemas ─────────────────────────────────────────────────────

export const schemas = {
  // Complete config
  agentConfig: agentConfigSchema,

  // API body schemas
  putConfigBody: putConfigBodySchema,
  diffConfigBody: diffConfigBodySchema,
  postBuildBody: postBuildBodySchema,
  llmTestBody: llmTestBodySchema,
  crmTestBody: crmTestBodySchema,
  webhookTestBody: webhookTestBodySchema,
  rollbackBody: rollbackBodySchema,

  // API query schemas
  getLogsQuery: getLogsQuerySchema,
  getBuildsQuery: getBuildsQuerySchema,
  knowledgeImportQuery: knowledgeImportQuerySchema,
  proxyQuery: proxyQuerySchema,

  // API param schemas
  buildIdParam: buildIdParamSchema,
  tenantIdParam: tenantIdParamSchema,

  // Sub-schemas (for partial validation / composition)
  branding: brandingSchema,
  personality: personalitySchema,
  crm: crmConfigSchema,
  llm: llmConfigSchema,
  knowledge: knowledgeConfigSchema,
  security: securityConfigSchema,
  rag: ragConfigSchema,
  factory: factoryBuildConfigSchema,
  server: serverConfigSchema,
  scraper: scraperConfigSchema,

  // Enums (useful for generating UI dropdowns dynamically)
  enums: {
    writingStyle: writingStyleEnum,
    toneOfVoice: toneOfVoiceEnum,
    crmProvider: crmProviderEnum,
    duplicateStrategy: duplicateStrategyEnum,
    identityKey: identityKeyEnum,
    logLevel: logLevelEnum,
    errorMode: errorModeEnum,
    agentNoteStyle: agentNoteStyleEnum,
    notifyChannel: notifyChannelEnum,
    llmProvider: llmProviderEnum,
    embedMode: embedModeEnum,
  },
} as const;

// Re-export Zod inferred types for use in route handlers
export type ValidatedAgentConfig = z.infer<typeof agentConfigSchema>;
export type ValidatedPutConfigBody = z.infer<typeof putConfigBodySchema>;
export type ValidatedDiffConfigBody = z.infer<typeof diffConfigBodySchema>;
export type ValidatedPostBuildBody = z.infer<typeof postBuildBodySchema>;
export type ValidatedGetLogsQuery = z.infer<typeof getLogsQuerySchema>;
export type ValidatedGetBuildsQuery = z.infer<typeof getBuildsQuerySchema>;
export type ValidatedBuildIdParam = z.infer<typeof buildIdParamSchema>;
export type ValidatedKnowledgeImportQuery = z.infer<
  typeof knowledgeImportQuerySchema
>;
export type ValidatedTenantIdParam = z.infer<typeof tenantIdParamSchema>;
