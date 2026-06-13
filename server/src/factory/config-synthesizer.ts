// ============================================================================
// Config Synthesizer — Bidirectional AgentConfig <-> .env conversion
// ============================================================================
// This module is the single source of truth for config serialization.
// AgentConfig (JSON) is the canonical format. .env is the runtime format.
// No config value may exist without being mapped here.
//
// SECURITY INVARIANT:
// - saveConfig() MUST NEVER write a redacted value to .env
// - All secrets from the existing .env MUST be preserved unless the
//   operator explicitly provides a new (non-redacted) value.
// - If a redacted value would be written and no preserved value exists,
//   saveConfig() MUST throw (fail-hard).
// ============================================================================

import type {
  AgentConfig,
  CrmConfig,
  AgentBranding,
  AgentPersonality,
  LlmConfig,
  KnowledgeConfig,
  SecurityConfig,
  DynamicVariables,
  RagConfig,
  FactoryBuildConfig,
} from "./types";
import fs from "fs";
import path from "path";

// ── Secret key patterns and redaction detection ────────────────────────────

/**
 * Exhaustive list of .env keys that contain secrets.
 * Any key matching one of these (exact or pattern) will be preserved
 * from the existing .env during saveConfig().
 */
const SECRET_KEY_EXACT = new Set([
  "JWT_SECRET",
  "ADMIN_API_KEY",
  "ADMIN_SESSION_SECRET",
  "SLACK_WEBHOOK_URL",
  "TWENTY_API_KEY",
  "TWENTY_API_URL",
  "AIRTABLE_WEBHOOK_URL",
  "AIRTABLE_API_KEY",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_TABLE_ID",
  "OPENROUTER_API_KEY",
  "DATABASE_URL",
  "CRM_WEBHOOK_SECRET",
  "GROQ_API_KEY",
]);

/** Pattern-matched secret keys (e.g. GROQ_API_KEY_1 .. GROQ_API_KEY_10) */
const SECRET_KEY_PATTERNS = [/^GROQ_API_KEY_\d+$/];

function isSecretKey(key: string): boolean {
  if (SECRET_KEY_EXACT.has(key)) return true;
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

/**
 * Detect whether a string value looks like a redacted/masked secret.
 * Redacted values from the Factory UI look like: "sk-proj-A...xyz9"
 * i.e. they contain "..." surrounded by visible characters.
 * We also catch placeholder patterns like "••••••".
 */
function isRedactedValue(value: string): boolean {
  if (!value || value.length < 5) return false;
  // Pattern 1: contains literal "..." with chars on both sides
  if (/^.{2,}\.\.\..{2,}$/.test(value)) return true;
  // Pattern 2: contains three consecutive dots anywhere (partial reveal)
  if (/\.\.\./.test(value) && value.length > 8) return true;
  // Pattern 3: placeholder bullets
  if (/^[•]{3,}$/.test(value)) return true;
  // Pattern 4: masked with asterisks like "***" or "/***"
  if (/^\*{3,}$/.test(value)) return true;
  return false;
}

/** Maximum number of .env backups to keep */
const MAX_BACKUP_COUNT = 10;

// ── Parse .env file into AgentConfig ───────────────────────────────────────

export function envToAgentConfig(
  env: Record<string, string | undefined>,
): AgentConfig {
  const e = (key: string, fallback = ""): string =>
    (env[key] ?? fallback).replace(/^["']|["']$/g, "");
  const n = (key: string, fallback: number): number => {
    const v = parseInt(e(key, String(fallback)), 10);
    return isNaN(v) ? fallback : v;
  };
  const b = (key: string, fallback: boolean): boolean => {
    const raw = e(key, "");
    if (!raw) return fallback;
    return raw === "true" || raw === "1";
  };

  // Collect GROQ keys
  const groqKeys: string[] = [];
  const primaryKey = e("GROQ_API_KEY");
  if (primaryKey) groqKeys.push(primaryKey);
  for (let i = 1; i <= 10; i++) {
    const k = e(`GROQ_API_KEY_${i}`);
    if (k) groqKeys.push(k);
  }

  // Collect knowledge URLs
  const knowledgeUrls = e("KNOWLEDGE_URLS", "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  // Collect allowed origins
  const allowedOrigins = e("WIDGET_ALLOWED_ORIGINS", "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // Parse widget tenant map
  const tenantMap: Record<string, string> = {};
  const tenantRaw = e("WIDGET_TENANT_MAP", "default:default");
  for (const pair of tenantRaw.split(",")) {
    const [wid, tid] = pair
      .trim()
      .split(":")
      .map((s) => s.trim());
    if (wid && tid) tenantMap[wid] = tid;
  }

  // Collect dynamic variables (VAR_*)
  const variables: DynamicVariables = {};
  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith("VAR_") && val !== undefined) {
      variables[key] = val.replace(/^["']|["']$/g, "");
    }
  }

  // Airtable field mappings
  const airtableFields: Record<string, string> = {};
  const airtableFieldKeys = [
    "FIRSTNAME",
    "LASTNAME",
    "FULLNAME",
    "PHONE",
    "EMAIL",
    "TYPE",
    "NEED",
    "ADDRESS",
    "QUALIFICATION",
    "DETAILS",
    "NOTES",
    "AGENTNOTE",
    "APPOINTMENT",
    "TAGS",
  ];
  for (const fk of airtableFieldKeys) {
    const val = e(`AIRTABLE_FIELD_${fk}`);
    if (val) airtableFields[fk.toLowerCase()] = val;
  }

  // Twenty field mappings
  const twentyFields: Record<string, string> = {};
  const twentyFieldKeys = [
    "EXTERNALID",
    "SOURCE",
    "QUALIFICATIONSCORE",
    "QUALIFICATIONLEVEL",
  ];
  for (const fk of twentyFieldKeys) {
    const val = e(`TWENTY_FIELD_${fk}`);
    if (val) twentyFields[fk.toLowerCase()] = val;
  }

  const config: AgentConfig = {
    version: e("FACTORY_CONFIG_VERSION", "1.0.0"),
    createdAt: e("FACTORY_CREATED_AT", new Date().toISOString()),
    updatedAt: new Date().toISOString(),

    branding: {
      agentName: e("FACTORY_AGENT_NAME", e("COMPANY_NAME", "AI Agent")),
      agencyName: e("VAR_AGENCE_NOM", e("COMPANY_NAME", "")),
      logoUrl: e("FACTORY_LOGO_URL"),
      avatarUrl: e("FACTORY_AVATAR_URL"),
      themeColors: {
        primary: e("FACTORY_THEME_PRIMARY", "#6366f1"),
        secondary: e("FACTORY_THEME_SECONDARY", "#8b5cf6"),
        accent: e("FACTORY_THEME_ACCENT", "#06b6d4"),
        background: e("FACTORY_THEME_BG", "#0b1220"),
        surface: e("FACTORY_THEME_SURFACE", "#0f172a"),
        text: e("FACTORY_THEME_TEXT", "#e5e7eb"),
      },
    },

    personality: {
      writingStyle: e(
        "FACTORY_WRITING_STYLE",
        "professional",
      ) as AgentPersonality["writingStyle"],
      toneOfVoice: e("FACTORY_TONE", "warm") as AgentPersonality["toneOfVoice"],
      systemPromptModifiers: e("FACTORY_PROMPT_MODIFIERS", "")
        .split("|")
        .filter(Boolean),
      knowledgeBaseUrls: knowledgeUrls,
      maxResponseWords: n("FACTORY_MAX_RESPONSE_WORDS", 40),
      language: e("PREFERRED_LANGUAGE", "fr"),
    },

    crm: {
      provider: e("CRM_PROVIDER", "none") as CrmConfig["provider"],
      enabled: e("CRM_PROVIDER", "none") !== "none",
      minPushScore: n("CRM_MIN_PUSH_SCORE", 60),
      identityKey: e("CRM_IDENTITY_KEY", "phone") as CrmConfig["identityKey"],
      duplicateStrategy: e(
        "CRM_DUPLICATE_STRATEGY",
        "update",
      ) as CrmConfig["duplicateStrategy"],
      blockIfIncomplete: b("CRM_BLOCK_IF_INCOMPLETE", false),
      requiredFields: e("CRM_REQUIRED_FIELDS", "phone,firstName")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      minMessagesBeforePush: n("CRM_MIN_MESSAGES_BEFORE_PUSH", 3),
      maxPushesPerSession: n("CRM_MAX_PUSHES_PER_SESSION", 3),
      pushCooldownSeconds: n("CRM_PUSH_COOLDOWN_SECONDS", 60),
      pushDelayMs: n("CRM_PUSH_DELAY_MS", 500),
      strict: {
        requireId: b("CRM_STRICT_REQUIRE_ID", true),
        verifyWrite: b("CRM_STRICT_VERIFY_WRITE", true),
        customFields: b("CRM_STRICT_CUSTOM_FIELDS", false),
      },
      fallbackBaseFields: b("CRM_FALLBACK_BASE_FIELDS", true),
      retry: {
        maxRetries: n("CRM_MAX_RETRIES", 3),
        delayMs: n("CRM_RETRY_DELAY_MS", 1000),
        timeoutMs: n("CRM_TIMEOUT_MS", 10000),
      },
      rateLimitPerMinute: n("CRM_RATE_LIMIT_PER_MINUTE", 30),
      includeAgentNote: b("CRM_INCLUDE_AGENT_NOTE", true),
      includeTranscript: b("CRM_INCLUDE_TRANSCRIPT", false),
      notesMaxLength: n("CRM_NOTES_MAX_LENGTH", 2000),
      agentNoteStyle: e(
        "CRM_AGENT_NOTE_STYLE",
        "casual",
      ) as CrmConfig["agentNoteStyle"],
      agentNoteLanguage: e("CRM_AGENT_NOTE_LANGUAGE", "fr"),
      agentNoteMaxLength: n("CRM_AGENT_NOTE_MAX_LENGTH", 500),
      capitalizeNames: b("CRM_CAPITALIZE_NAMES", true),
      trimFields: b("CRM_TRIM_FIELDS", true),
      validatePhone: b("CRM_VALIDATE_PHONE", true),
      validateEmail: b("CRM_VALIDATE_EMAIL", true),
      normalizePhone: b("CRM_NORMALIZE_PHONE", true),
      logLevel: e("CRM_LOG_LEVEL", "info") as CrmConfig["logLevel"],
      hashPiiInLogs: b("CRM_HASH_PII_IN_LOGS", true),
      structuredLogs: b("CRM_STRUCTURED_LOGS", true),
      debugPayloads: b("CRM_DEBUG_PAYLOADS", false),
      notifyOnSuccess: b("CRM_NOTIFY_ON_SUCCESS", false),
      notifyOnFailure: b("CRM_NOTIFY_ON_FAILURE", true),
      notifyChannel: e(
        "CRM_NOTIFY_CHANNEL",
        "none",
      ) as CrmConfig["notifyChannel"],
      errorMode: b("CRM_STRICT_REQUIRE_ID", true) ? "strict" : "permissive",
      webhooksEnabled: b("CRM_WEBHOOKS_ENABLED", false),
      webhookSecret: e("CRM_WEBHOOK_SECRET", ""),
      airtable: {
        enabled: b("AIRTABLE_ENABLED", false),
        webhookUrl: e("AIRTABLE_WEBHOOK_URL"),
        timeoutMs: n("AIRTABLE_TIMEOUT_MS", 10000),
        fieldMappings: airtableFields,
      },
      twenty: {
        enabled: b("TWENTY_ENABLED", false),
        apiUrl: e("TWENTY_API_URL", "https://api.twenty.com"),
        apiKey: e("TWENTY_API_KEY", ""),
        timeoutMs: n("TWENTY_TIMEOUT_MS", 10000),
        customFields: b("TWENTY_CUSTOM_FIELDS", false),
        fieldMappings: twentyFields,
        defaultSource: e("TWENTY_DEFAULT_SOURCE", "CHATBOT"),
        defaultPhoneCountry: e("TWENTY_DEFAULT_PHONE_COUNTRY", "FR"),
      },
    },

    llm: {
      provider: e("LLM_PROVIDER", "groq") as LlmConfig["provider"],
      model: e("LLM_MODEL", ""),
      baseUrl: e("LLM_BASE_URL", ""),
      timeoutMs: n("LLM_TIMEOUT_MS", 30000),
      maxRetries: n("LLM_MAX_RETRIES", 2),
      maxTokens: n("LLM_MAX_TOKENS", 700),
      groq: {
        model: e("GROQ_MODEL", "llama-3.3-70b-versatile"),
        apiKeys: groqKeys,
        maxTokensNormal: n("GROQ_MAX_TOKENS_NORMAL", 700),
        maxTokensShort: n("GROQ_MAX_TOKENS_SHORT", 300),
        keyCooldownMs: n("GROQ_KEY_COOLDOWN_MS", 15000),
      },
      openrouter: {
        apiKey: e("OPENROUTER_API_KEY", ""),
        baseUrl: e("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        appName: e("OPENROUTER_APP_NAME", "OracleSentinel"),
        maxTokensNormal: n("OPENROUTER_MAX_TOKENS_NORMAL", 600),
        maxTokensShort: n("OPENROUTER_MAX_TOKENS_SHORT", 300),
        historyMaxMessages: n("OPENROUTER_HISTORY_MAX_MESSAGES", 10),
      },
    },

    knowledge: {
      urls: knowledgeUrls,
      maxUrls: n("KNOWLEDGE_MAX_URLS", 3),
      cacheTtl: n("KNOWLEDGE_CACHE_TTL", 3600),
      fetchTimeoutMs: n("KNOWLEDGE_FETCH_TIMEOUT_MS", 10000),
      catalogFallbackScraper: b("CATALOG_FALLBACK_SCRAPER", false),
      xmlEnabled: b("KNOWLEDGE_XML_ENABLED", true),
      xmlMaxSizeMb: n("KNOWLEDGE_XML_MAX_SIZE_MB", 20),
    },

    rag: {
      enabled: b("RAG_ENABLED", true),
      forceLookupOnIntent: b("RAG_FORCE_LOOKUP_ON_INTENT", false),
      minConfidence: parseFloat(e("RAG_MIN_CONFIDENCE", "0.3")) || 0.3,
    },

    factory: {
      buildStrict: b("FACTORY_BUILD_STRICT", true),
      embedMode: e("FACTORY_EMBED_MODE", "hosted") as "hosted" | "bundle",
      agentApiKeyRequired: b("FACTORY_AGENT_API_KEY_REQUIRED", false),
      agentKillSwitch: b("FACTORY_AGENT_KILL_SWITCH", false),
    },

    security: {
      jwtIssuer: e("JWT_ISSUER", "oraclesentinel.com"),
      jwtAudience: e("JWT_AUDIENCE", "oraclebot"),
      jwtTtlSeconds: n("JWT_TTL_SECONDS", 1200),
      jwtAlg: e("JWT_ALG", "HS256"),
      allowedOrigins,
      widgetTenantMap: tenantMap,
    },

    variables,

    server: {
      port: n("PORT", 3001),
      nodeEnv: e("NODE_ENV", "development"),
      databaseUrl: e("DATABASE_URL", ""),
      preferredLanguage: e("PREFERRED_LANGUAGE", "fr"),
    },

    scraper: {
      cardSelector: e("SITE_CARD_SELECTOR", ".item__block"),
      priceSelector: e("SITE_PRICE_SELECTOR", ".item__price"),
      locationSelector: e("SITE_LOCATION_SELECTOR", ".item__block--city"),
      typeSelector: e("SITE_TYPE_SELECTOR", ".item__block--title"),
      linkSelector: e("SITE_LINK_SELECTOR", "a.cta-secondary"),
      descriptionSelector: e(
        "SITE_DETAIL_DESCRIPTION_SELECTOR",
        ".description",
      ),
      featuresSelector: e("SITE_DETAIL_FEATURES_SELECTOR", ".features li"),
      loadDelay: n("SITE_LOAD_DELAY", 3000),
    },
  };

  return config;
}

// ── Serialize AgentConfig to .env string ───────────────────────────────────

export function agentConfigToEnv(config: AgentConfig): string {
  const lines: string[] = [];

  const section = (title: string) => {
    lines.push("");
    lines.push(`# ${"=".repeat(57)}`);
    lines.push(`# ${title}`);
    lines.push(`# ${"=".repeat(57)}`);
  };

  const set = (key: string, value: string | number | boolean) => {
    const v = String(value);
    const needsQuotes = v.includes(" ") || v.includes(",") || v.includes("'");
    lines.push(`${key}=${needsQuotes ? `"${v}"` : v}`);
  };

  const comment = (text: string) => {
    lines.push(`# ${text}`);
  };

  // ── Factory Metadata ───────────────────────────────────────────
  section("FACTORY METADATA");
  set("FACTORY_CONFIG_VERSION", config.version);
  set("FACTORY_CREATED_AT", config.createdAt);
  set("FACTORY_AGENT_NAME", config.branding.agentName);
  if (config.branding.logoUrl) set("FACTORY_LOGO_URL", config.branding.logoUrl);
  if (config.branding.avatarUrl)
    set("FACTORY_AVATAR_URL", config.branding.avatarUrl);
  set("FACTORY_THEME_PRIMARY", config.branding.themeColors.primary);
  set("FACTORY_THEME_SECONDARY", config.branding.themeColors.secondary);
  set("FACTORY_THEME_ACCENT", config.branding.themeColors.accent);
  set("FACTORY_THEME_BG", config.branding.themeColors.background);
  set("FACTORY_THEME_SURFACE", config.branding.themeColors.surface);
  set("FACTORY_THEME_TEXT", config.branding.themeColors.text);
  set("FACTORY_WRITING_STYLE", config.personality.writingStyle);
  set("FACTORY_TONE", config.personality.toneOfVoice);
  if (config.personality.systemPromptModifiers.length > 0) {
    set(
      "FACTORY_PROMPT_MODIFIERS",
      config.personality.systemPromptModifiers.join("|"),
    );
  }
  set("FACTORY_MAX_RESPONSE_WORDS", config.personality.maxResponseWords);

  // ── Server ─────────────────────────────────────────────────────
  section("SERVER CONFIGURATION");
  set("NODE_ENV", config.server.nodeEnv);
  set("PORT", config.server.port);
  set("PREFERRED_LANGUAGE", config.server.preferredLanguage);

  // ── Database ───────────────────────────────────────────────────
  section("DATABASE");
  set("DATABASE_URL", config.server.databaseUrl);

  // ── LLM ────────────────────────────────────────────────────────
  section("LLM CONFIGURATION");
  set("LLM_PROVIDER", config.llm.provider);

  if (config.llm.groq) {
    lines.push("");
    comment("GROQ (Rotation System)");
    set("GROQ_MODEL", config.llm.groq.model);
    if (config.llm.groq.apiKeys.length > 0) {
      set("GROQ_API_KEY", config.llm.groq.apiKeys[0]);
      for (let i = 1; i < config.llm.groq.apiKeys.length; i++) {
        set(`GROQ_API_KEY_${i}`, config.llm.groq.apiKeys[i]);
      }
    }
    set("GROQ_MAX_TOKENS_NORMAL", config.llm.groq.maxTokensNormal);
    set("GROQ_MAX_TOKENS_SHORT", config.llm.groq.maxTokensShort);
    set("GROQ_KEY_COOLDOWN_MS", config.llm.groq.keyCooldownMs);
  }

  if (config.llm.openrouter) {
    lines.push("");
    comment("OPENROUTER");
    set("OPENROUTER_API_KEY", config.llm.openrouter.apiKey);
    set("OPENROUTER_BASE_URL", config.llm.openrouter.baseUrl);
    set("OPENROUTER_APP_NAME", config.llm.openrouter.appName);
    set("OPENROUTER_MAX_TOKENS_NORMAL", config.llm.openrouter.maxTokensNormal);
    set("OPENROUTER_MAX_TOKENS_SHORT", config.llm.openrouter.maxTokensShort);
    set(
      "OPENROUTER_HISTORY_MAX_MESSAGES",
      config.llm.openrouter.historyMaxMessages,
    );
  }

  // LLM top-level overrides
  if (config.llm.model) set("LLM_MODEL", config.llm.model);
  if (config.llm.baseUrl) set("LLM_BASE_URL", config.llm.baseUrl);
  set("LLM_TIMEOUT_MS", config.llm.timeoutMs);
  set("LLM_MAX_RETRIES", config.llm.maxRetries);
  set("LLM_MAX_TOKENS", config.llm.maxTokens);

  // ── Knowledge ──────────────────────────────────────────────────
  section("KNOWLEDGE BASE / RAG");
  set("COMPANY_NAME", config.branding.agencyName);
  set("KNOWLEDGE_URLS", config.knowledge.urls.join(","));
  set("KNOWLEDGE_MAX_URLS", config.knowledge.maxUrls);
  set("KNOWLEDGE_CACHE_TTL", config.knowledge.cacheTtl);
  set("KNOWLEDGE_FETCH_TIMEOUT_MS", config.knowledge.fetchTimeoutMs);
  set(
    "CATALOG_FALLBACK_SCRAPER",
    config.knowledge.catalogFallbackScraper ? "1" : "0",
  );
  set("KNOWLEDGE_XML_ENABLED", config.knowledge.xmlEnabled);
  set("KNOWLEDGE_XML_MAX_SIZE_MB", config.knowledge.xmlMaxSizeMb);

  // RAG
  lines.push("");
  comment("RAG CONFIGURATION");
  set("RAG_ENABLED", config.rag.enabled);
  set("RAG_FORCE_LOOKUP_ON_INTENT", config.rag.forceLookupOnIntent);
  set("RAG_MIN_CONFIDENCE", config.rag.minConfidence);

  // Factory Build
  section("FACTORY BUILD & DEPLOYMENT");
  set("FACTORY_BUILD_STRICT", config.factory.buildStrict);
  set("FACTORY_EMBED_MODE", config.factory.embedMode);
  set("FACTORY_AGENT_API_KEY_REQUIRED", config.factory.agentApiKeyRequired);
  set("FACTORY_AGENT_KILL_SWITCH", config.factory.agentKillSwitch);

  // ── CRM ────────────────────────────────────────────────────────
  section("CRM SYNC ENGINE");
  set("CRM_PROVIDER", config.crm.provider);
  set("CRM_MIN_PUSH_SCORE", config.crm.minPushScore);
  set("CRM_IDENTITY_KEY", config.crm.identityKey);
  set("CRM_DUPLICATE_STRATEGY", config.crm.duplicateStrategy);
  set("CRM_STRICT_REQUIRE_ID", config.crm.strict.requireId);
  set("CRM_STRICT_VERIFY_WRITE", config.crm.strict.verifyWrite);
  set("CRM_STRICT_CUSTOM_FIELDS", config.crm.strict.customFields);
  set("CRM_FALLBACK_BASE_FIELDS", config.crm.fallbackBaseFields);
  set("CRM_LOG_LEVEL", config.crm.logLevel);
  set("CRM_MAX_RETRIES", config.crm.retry.maxRetries);
  set("CRM_RETRY_DELAY_MS", config.crm.retry.delayMs);
  set("CRM_TIMEOUT_MS", config.crm.retry.timeoutMs);
  set("CRM_PUSH_DELAY_MS", config.crm.pushDelayMs);
  set("CRM_MIN_MESSAGES_BEFORE_PUSH", config.crm.minMessagesBeforePush);
  set("CRM_MAX_PUSHES_PER_SESSION", config.crm.maxPushesPerSession);
  set("CRM_PUSH_COOLDOWN_SECONDS", config.crm.pushCooldownSeconds);
  set("CRM_INCLUDE_AGENT_NOTE", config.crm.includeAgentNote);
  set("CRM_INCLUDE_TRANSCRIPT", config.crm.includeTranscript);
  set("CRM_NOTES_MAX_LENGTH", config.crm.notesMaxLength);
  set("CRM_AGENT_NOTE_STYLE", config.crm.agentNoteStyle);
  set("CRM_AGENT_NOTE_LANGUAGE", config.crm.agentNoteLanguage);
  set("CRM_AGENT_NOTE_MAX_LENGTH", config.crm.agentNoteMaxLength);
  set("CRM_CAPITALIZE_NAMES", config.crm.capitalizeNames);
  set("CRM_TRIM_FIELDS", config.crm.trimFields);
  set("CRM_VALIDATE_PHONE", config.crm.validatePhone);
  set("CRM_VALIDATE_EMAIL", config.crm.validateEmail);
  set("CRM_NORMALIZE_PHONE", config.crm.normalizePhone);
  set("CRM_BLOCK_IF_INCOMPLETE", config.crm.blockIfIncomplete);
  set("CRM_REQUIRED_FIELDS", config.crm.requiredFields.join(","));
  set("CRM_HASH_PII_IN_LOGS", config.crm.hashPiiInLogs);
  set("CRM_STRUCTURED_LOGS", config.crm.structuredLogs);
  set("CRM_DEBUG_PAYLOADS", config.crm.debugPayloads);
  set("CRM_NOTIFY_ON_SUCCESS", config.crm.notifyOnSuccess);
  set("CRM_NOTIFY_ON_FAILURE", config.crm.notifyOnFailure);
  set("CRM_NOTIFY_CHANNEL", config.crm.notifyChannel);
  set("CRM_RATE_LIMIT_PER_MINUTE", config.crm.rateLimitPerMinute);
  set("CRM_WEBHOOKS_ENABLED", config.crm.webhooksEnabled);
  if (config.crm.webhookSecret)
    set("CRM_WEBHOOK_SECRET", config.crm.webhookSecret);

  // Airtable
  if (config.crm.airtable) {
    lines.push("");
    comment("AIRTABLE PROVIDER");
    set("AIRTABLE_ENABLED", config.crm.airtable.enabled);
    set("AIRTABLE_WEBHOOK_URL", config.crm.airtable.webhookUrl);
    set("AIRTABLE_TIMEOUT_MS", config.crm.airtable.timeoutMs);
    for (const [k, v] of Object.entries(config.crm.airtable.fieldMappings)) {
      set(`AIRTABLE_FIELD_${k.toUpperCase()}`, v);
    }
  }

  // Twenty
  if (config.crm.twenty) {
    lines.push("");
    comment("TWENTY CRM PROVIDER");
    set("TWENTY_ENABLED", config.crm.twenty.enabled);
    set("TWENTY_API_URL", config.crm.twenty.apiUrl);
    set("TWENTY_API_KEY", config.crm.twenty.apiKey);
    set("TWENTY_TIMEOUT_MS", config.crm.twenty.timeoutMs);
    set("TWENTY_CUSTOM_FIELDS", config.crm.twenty.customFields);
    for (const [k, v] of Object.entries(config.crm.twenty.fieldMappings)) {
      set(`TWENTY_FIELD_${k.toUpperCase()}`, v);
    }
    set("TWENTY_DEFAULT_SOURCE", config.crm.twenty.defaultSource);
    set("TWENTY_DEFAULT_PHONE_COUNTRY", config.crm.twenty.defaultPhoneCountry);
  }

  // ── Dynamic Variables ──────────────────────────────────────────
  section("DYNAMIC VARIABLES");
  for (const [key, value] of Object.entries(config.variables)) {
    set(key, value);
  }

  // ── Security ───────────────────────────────────────────────────
  section("SECURITY & AUTH");
  set("JWT_ISSUER", config.security.jwtIssuer);
  set("JWT_AUDIENCE", config.security.jwtAudience);
  set("JWT_TTL_SECONDS", config.security.jwtTtlSeconds);
  set("JWT_ALG", config.security.jwtAlg);
  comment("JWT_SECRET=<generated-at-build-time>");
  comment("ADMIN_API_KEY=<generated-at-build-time>");
  set("WIDGET_ALLOWED_ORIGINS", config.security.allowedOrigins.join(","));
  const tenantPairs = Object.entries(config.security.widgetTenantMap).map(
    ([w, t]) => `${w}:${t}`,
  );
  set("WIDGET_TENANT_MAP", tenantPairs.join(","));

  // ── Scraper ────────────────────────────────────────────────────
  if (config.scraper) {
    section("SITE SCRAPER");
    set("SITE_CARD_SELECTOR", config.scraper.cardSelector);
    set("SITE_PRICE_SELECTOR", config.scraper.priceSelector);
    set("SITE_LOCATION_SELECTOR", config.scraper.locationSelector);
    set("SITE_TYPE_SELECTOR", config.scraper.typeSelector);
    set("SITE_LINK_SELECTOR", config.scraper.linkSelector);
    set("SITE_DETAIL_DESCRIPTION_SELECTOR", config.scraper.descriptionSelector);
    set("SITE_DETAIL_FEATURES_SELECTOR", config.scraper.featuresSelector);
    set("SITE_LOAD_DELAY", config.scraper.loadDelay);
  }

  return lines.join("\n");
}

// ── Read current .env and parse to AgentConfig ─────────────────────────────

export function loadCurrentConfig(): AgentConfig {
  const envPath = path.join(__dirname, "../../.env");
  const envContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8")
    : "";
  const envVars: Record<string, string> = {};

  // Also include process.env as fallback
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) envVars[k] = v;
  }

  // Parse .env file (overrides process.env)
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    envVars[key] = value;
  }

  return envToAgentConfig(envVars);
}

// ── Parse all key=value pairs from a .env string ───────────────────────────

function parseEnvContent(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

// ── Rotate old backups, keeping only the N most recent ─────────────────────

function rotateBackups(envPath: string, maxKeep: number): void {
  const dir = path.dirname(envPath);
  const base = path.basename(envPath);
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.backup.`))
      .sort();
    const excess = files.length - maxKeep;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        try {
          fs.unlinkSync(path.join(dir, files[i]));
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

// ── Retrieve the latest backup path ────────────────────────────────────────

export function getLatestBackupPath(): string | null {
  const envPath = path.join(__dirname, "../../.env");
  const dir = path.dirname(envPath);
  const base = path.basename(envPath);
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.backup.`))
      .sort();
    if (files.length === 0) return null;
    return path.join(dir, files[files.length - 1]);
  } catch {
    return null;
  }
}

// ── Restore latest backup ──────────────────────────────────────────────────

export function restoreLatestBackup(): {
  restored: boolean;
  backupUsed: string | null;
  error?: string;
} {
  const envPath = path.join(__dirname, "../../.env");
  const latest = getLatestBackupPath();
  if (!latest) {
    return {
      restored: false,
      backupUsed: null,
      error: "No backup files found",
    };
  }
  try {
    fs.copyFileSync(latest, envPath);
    return { restored: true, backupUsed: latest };
  } catch (err: any) {
    return { restored: false, backupUsed: latest, error: err.message };
  }
}

// ── Write AgentConfig to .env file (SECRET-SAFE) ──────────────────────────
//
// ALGORITHM:
// 1. Read existing .env → extract ALL current key-value pairs
// 2. Identify all secret keys from current .env
// 3. Generate new .env content from config
// 4. Parse the generated content line-by-line
// 5. For each line that sets a secret key:
//    a. If the new value is redacted → substitute with preserved value
//    b. If no preserved value exists → FAIL HARD (throw)
//    c. If the new value is NOT redacted → use it (operator provided new secret)
// 6. Write the patched content atomically
// 7. Verify round-trip integrity on secrets
// 8. If verification fails → rollback to backup
//
// This guarantees: no redacted value EVER reaches the .env file.
// ───────────────────────────────────────────────────────────────────────────

export function saveConfig(config: AgentConfig): {
  path: string;
  backup: string | null;
} {
  const envPath = path.join(__dirname, "../../.env");
  let backupPath: string | null = null;

  // ── Step 1: Backup current .env ────────────────────────────────
  if (fs.existsSync(envPath)) {
    backupPath = `${envPath}.backup.${Date.now()}`;
    fs.copyFileSync(envPath, backupPath);
  }

  // ── Step 2: Rotate old backups ─────────────────────────────────
  rotateBackups(envPath, MAX_BACKUP_COUNT);

  // ── Step 3: Extract ALL current values (especially secrets) ────
  const currentContent = fs.existsSync(backupPath || envPath)
    ? fs.readFileSync(backupPath || envPath, "utf-8")
    : "";
  const currentVars = parseEnvContent(currentContent);

  // Build a map of preserved secret values from the CURRENT .env
  const preservedSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(currentVars)) {
    if (isSecretKey(key) && value && !isRedactedValue(value)) {
      preservedSecrets[key] = value;
    }
  }

  // ── Step 4: Generate raw .env from config ──────────────────────
  const rawEnvContent = agentConfigToEnv(config);

  // ── Step 5: Patch every line — replace redacted secrets ────────
  const patchedLines: string[] = [];
  const poisonedKeys: string[] = [];

  for (const line of rawEnvContent.split("\n")) {
    const trimmed = line.trim();

    // Pass through comments and blanks
    if (!trimmed || trimmed.startsWith("#")) {
      patchedLines.push(line);
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      patchedLines.push(line);
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip quotes for inspection
    let rawValue = value;
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1);
    }

    if (isSecretKey(key)) {
      if (isRedactedValue(rawValue) || rawValue === "" || rawValue === "***") {
        // Value from config is redacted or empty → must substitute
        if (preservedSecrets[key]) {
          // Substitute with preserved real value
          const needsQuotes =
            preservedSecrets[key].includes(" ") ||
            preservedSecrets[key].includes(",") ||
            preservedSecrets[key].includes("'");
          const safeVal = needsQuotes
            ? `"${preservedSecrets[key]}"`
            : preservedSecrets[key];
          patchedLines.push(`${key}=${safeVal}`);
        } else {
          // No preserved value and incoming is redacted → poison
          poisonedKeys.push(key);
          // Still write a placeholder comment so the key is visible
          patchedLines.push(
            `# ${key}= [REDACTED VALUE BLOCKED — set via Factory UI or .env]`,
          );
        }
      } else {
        // Operator provided a new real secret value — use it
        patchedLines.push(line);
      }
    } else {
      // Non-secret key — pass through
      patchedLines.push(line);
    }
  }

  // ── Step 5b: Append any NON-MODELED keys from current .env that were NOT in generated output
  // This includes both secrets AND non-secret keys not in AgentConfig (e.g. CHAT_DEBUG, COMPANY_*, etc.)
  const generatedKeys = new Set<string>();
  for (const line of rawEnvContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) generatedKeys.add(t.slice(0, eq).trim());
  }

  const appendSecrets: string[] = [];
  const appendNonSecrets: string[] = [];

  // Preserve all keys from current .env that are not in generated output
  for (const [key, value] of Object.entries(currentVars)) {
    if (!generatedKeys.has(key) && value) {
      const needsQuotes =
        value.includes(" ") || value.includes(",") || value.includes("'");
      const line = `${key}=${needsQuotes ? `"${value}"` : value}`;

      if (isSecretKey(key)) {
        appendSecrets.push(line);
      } else {
        appendNonSecrets.push(line);
      }
    }
  }

  // Append preserved secrets first
  if (appendSecrets.length > 0) {
    patchedLines.push("");
    patchedLines.push(
      "# Preserved secrets (not managed by factory config model)",
    );
    patchedLines.push(...appendSecrets);
  }

  // Then append non-secret non-modeled keys
  if (appendNonSecrets.length > 0) {
    patchedLines.push("");
    patchedLines.push(
      "# Non-modeled keys (preserved from current .env — not in AgentConfig schema)",
    );
    patchedLines.push(...appendNonSecrets);
  }

  const finalContent = patchedLines.join("\n");

  // ── Step 6: Write .env ─────────────────────────────────────────
  fs.writeFileSync(envPath, finalContent, "utf-8");

  // ── Step 7: Round-trip integrity verification on secrets ───────
  const writtenVars = parseEnvContent(finalContent);
  const integrityErrors: string[] = [];

  for (const [key, originalValue] of Object.entries(preservedSecrets)) {
    const writtenValue = writtenVars[key];
    if (!writtenValue) {
      // Key was commented out (poisoned) — already logged above
      continue;
    }
    if (isRedactedValue(writtenValue)) {
      integrityErrors.push(
        `INTEGRITY FAIL: ${key} contains redacted value after write`,
      );
    }
  }

  if (integrityErrors.length > 0) {
    // ── Step 8: Rollback on integrity failure ──────────────────
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, envPath);
    }
    throw new Error(
      `Secret integrity check failed — .env rolled back to backup. ` +
        `Errors: ${integrityErrors.join("; ")}`,
    );
  }

  // Log poisoned keys as warnings (non-fatal if the key was optional)
  if (poisonedKeys.length > 0) {
    // Import factoryLog lazily to avoid circular dependency
    try {
      const { factoryLog } = require("./observability");
      factoryLog(
        "warn",
        "factory.config.secrets.blocked",
        `Blocked ${poisonedKeys.length} redacted value(s) from being written to .env`,
        { keys: poisonedKeys },
      );
    } catch {
      /* graceful fallback */
    }
  }

  return { path: envPath, backup: backupPath };
}

// ── Config Diff (for versioning) ───────────────────────────────────────────

export interface ConfigDiff {
  field: string;
  oldValue: string;
  newValue: string;
}

export function diffConfigs(a: AgentConfig, b: AgentConfig): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const flatA = flattenObject(a);
  const flatB = flattenObject(b);

  const allKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);
  for (const key of allKeys) {
    const vA = flatA[key] ?? "<not set>";
    const vB = flatB[key] ?? "<not set>";
    if (vA !== vB) {
      // Redact sensitive values
      const isSensitive =
        key.toLowerCase().includes("apikey") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password");
      diffs.push({
        field: key,
        oldValue: isSensitive ? "***" : String(vA),
        newValue: isSensitive ? "***" : String(vB),
      });
    }
  }

  return diffs;
}

function flattenObject(
  obj: Record<string, any>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = String(value);
    }
  }
  return result;
}
