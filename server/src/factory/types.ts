// ============================================================================
// AI Agent Factory — Core Type Contracts
// ============================================================================
// Every type here is a contract. Breaking a contract breaks production.
// These types are provider-agnostic, serializable, and versionable.
// ============================================================================

// ── Agent Identity & Branding ──────────────────────────────────────────────

export interface AgentBranding {
  agentName: string;
  agencyName: string;
  logoUrl?: string;
  avatarUrl?: string;
  themeColors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
  };
}

// ── Agent Personality ──────────────────────────────────────────────────────

export type WritingStyle =
  | "professional"
  | "friendly"
  | "casual"
  | "formal"
  | "technical";
export type ToneOfVoice =
  | "warm"
  | "neutral"
  | "authoritative"
  | "empathetic"
  | "direct";

export interface AgentPersonality {
  writingStyle: WritingStyle;
  toneOfVoice: ToneOfVoice;
  systemPromptModifiers: string[];
  knowledgeBaseUrls: string[];
  maxResponseWords: number;
  language: string;
}

// ── CRM Configuration Contract ─────────────────────────────────────────────

export type CrmProviderType = "twenty" | "airtable" | "none";
export type DuplicateStrategy = "skip" | "update" | "create_always" | "fail";
export type IdentityKey = "phone" | "email" | "externalid";
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
export type ErrorMode = "strict" | "permissive";
export type AgentNoteStyle = "formal" | "casual" | "technical";
export type NotifyChannel = "slack" | "email" | "none";

export interface CrmFieldMapping {
  sourceField: string; // CDM field name
  targetField: string; // CRM provider field name
  enabled: boolean;
  required: boolean;
  transform?: "capitalize" | "lowercase" | "uppercase" | "trim" | "none";
}

export interface CrmConfig {
  provider: CrmProviderType;
  enabled: boolean;

  // Push Policy
  minPushScore: number;
  identityKey: IdentityKey;
  duplicateStrategy: DuplicateStrategy;
  blockIfIncomplete: boolean;
  requiredFields: string[];
  minMessagesBeforePush: number;
  maxPushesPerSession: number;
  pushCooldownSeconds: number;
  pushDelayMs: number;

  // Strict Mode
  strict: {
    requireId: boolean;
    verifyWrite: boolean;
    customFields: boolean;
  };

  // Fallback
  fallbackBaseFields: boolean;

  // Retry
  retry: {
    maxRetries: number;
    delayMs: number;
    timeoutMs: number;
  };

  // Rate Limiting
  rateLimitPerMinute: number;

  // Notes & Summary
  includeAgentNote: boolean;
  includeTranscript: boolean;
  notesMaxLength: number;
  agentNoteStyle: AgentNoteStyle;
  agentNoteLanguage: string;
  agentNoteMaxLength: number;

  // Field Behavior
  capitalizeNames: boolean;
  trimFields: boolean;
  validatePhone: boolean;
  validateEmail: boolean;
  normalizePhone: boolean;

  // Logging & Observability
  logLevel: LogLevel;
  hashPiiInLogs: boolean;
  structuredLogs: boolean;
  debugPayloads: boolean;

  // Notifications
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannel: NotifyChannel;

  // Error Handling Mode
  errorMode: ErrorMode;

  // Webhooks
  webhooksEnabled: boolean;
  webhookSecret: string;

  // Provider-specific
  airtable?: AirtableProviderConfig;
  twenty?: TwentyProviderConfig;
}

export interface AirtableProviderConfig {
  enabled: boolean;
  webhookUrl: string;
  timeoutMs: number;
  fieldMappings: Record<string, string>;
}

export interface TwentyProviderConfig {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  customFields: boolean;
  fieldMappings: Record<string, string>;
  defaultSource: string;
  defaultPhoneCountry: string;
}

// ── LLM Configuration Contract ─────────────────────────────────────────────

export type LlmProviderType =
  | "groq"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "custom";

export interface LlmConfig {
  provider: LlmProviderType;
  model?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
  groq?: {
    model: string;
    apiKeys: string[];
    maxTokensNormal: number;
    maxTokensShort: number;
    keyCooldownMs: number;
  };
  openrouter?: {
    apiKey: string;
    baseUrl: string;
    appName: string;
    maxTokensNormal: number;
    maxTokensShort: number;
    historyMaxMessages: number;
  };
  openai?: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
  };
  anthropic?: {
    apiKey: string;
    model: string;
    maxTokens: number;
  };
  custom?: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
  };
}

// ── Knowledge Base Configuration ───────────────────────────────────────────

export interface KnowledgeConfig {
  urls: string[];
  maxUrls: number;
  cacheTtl: number;
  fetchTimeoutMs: number;
  catalogFallbackScraper: boolean;
  xmlEnabled: boolean;
  xmlMaxSizeMb: number;
}

// ── RAG Configuration ──────────────────────────────────────────────────────

export interface RagConfig {
  enabled: boolean;
  forceLookupOnIntent: boolean;
  minConfidence: number;
}

// ── Factory Build Configuration ────────────────────────────────────────────

export type EmbedMode = "hosted" | "bundle";

export interface FactoryBuildConfig {
  buildStrict: boolean;
  embedMode: EmbedMode;
  agentApiKeyRequired: boolean;
  agentKillSwitch: boolean;
}

// ── Security Configuration ─────────────────────────────────────────────────

export interface SecurityConfig {
  jwtIssuer: string;
  jwtAudience: string;
  jwtTtlSeconds: number;
  jwtAlg: string;
  allowedOrigins: string[];
  widgetTenantMap: Record<string, string>;
}

// ── Dynamic Variables (Agency Info) ────────────────────────────────────────

export interface DynamicVariables {
  [key: string]: string;
}

// ── Complete Agent Configuration (Serializable) ────────────────────────────

export interface AgentConfig {
  version: string;
  createdAt: string;
  updatedAt: string;

  // Core Identity
  branding: AgentBranding;
  personality: AgentPersonality;

  // Infrastructure
  crm: CrmConfig;
  llm: LlmConfig;
  knowledge: KnowledgeConfig;
  security: SecurityConfig;
  rag: RagConfig;
  factory: FactoryBuildConfig;

  // Dynamic agency data
  variables: DynamicVariables;

  // Server
  server: {
    port: number;
    nodeEnv: string;
    databaseUrl: string;
    preferredLanguage: string;
  };

  // Scraper
  scraper?: {
    cardSelector: string;
    priceSelector: string;
    locationSelector: string;
    typeSelector: string;
    linkSelector: string;
    descriptionSelector: string;
    featuresSelector: string;
    loadDelay: number;
  };
}

// ── Build Pipeline Types ───────────────────────────────────────────────────

export type BuildStepStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "failure";

export interface BuildStep {
  name: string;
  status: BuildStepStatus;
  message?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export type BuildStatus = "idle" | "building" | "success" | "failure";

export interface BuildResult {
  status: BuildStatus;
  steps: BuildStep[];
  timestamp: string;
  agentName: string;
  warnings: string[];
  errors: string[];
  productionReady: boolean;
  auditLog: BuildAuditEntry;
  buildId: string;
  configVersion?: string;
  durationMs?: number;
}

export interface BuildAuditEntry {
  event: string;
  agent: string;
  status: string;
  timestamp: string;
  configVersion: string;
  steps: { name: string; status: string; durationMs?: number }[];
}

// ── Production Readiness ───────────────────────────────────────────────────

export type ReadinessLevel = "READY" | "WARNING" | "BLOCKED";

export interface ReadinessCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  blocking: boolean;
}

export interface ReadinessReport {
  level: ReadinessLevel;
  checks: ReadinessCheck[];
  blockers: string[];
  warnings: string[];
  timestamp: string;
}

// ── Observability Types ────────────────────────────────────────────────────

export interface CrmPushMetrics {
  totalPushes: number;
  successCount: number;
  failureCount: number;
  duplicateCount: number;
  avgDurationMs: number;
  lastPushAt: string | null;
  lastVerificationResult: "pass" | "fail" | "skipped" | null;
  failedLeadsInQueue: number;
}

export interface SystemHealthMetrics {
  uptime: number;
  memoryUsageMb: number;
  activeConnections: number;
  databaseConnected: boolean;
  crmConnected: boolean;
  llmAvailable: boolean;
  lastError: string | null;
}

export interface ObservabilitySnapshot {
  system: SystemHealthMetrics;
  crm: CrmPushMetrics;
  timestamp: string;
}

// ── Runtime Behavior Matrix ────────────────────────────────────────────────

export interface RuntimeScenario {
  scenario: string;
  condition: string;
  strictBehavior: string;
  permissiveBehavior: string;
  outcome: "SUCCESS" | "WARNING" | "FAILURE" | "BLOCKED";
}
