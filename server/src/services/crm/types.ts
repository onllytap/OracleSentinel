// ============================================================================
// Canonical Data Model (CDM) — Provider-independent CRM types
// ============================================================================

/** Qualification level derived from score */
export type QualificationLevel = 'COLD' | 'WARM' | 'HOT';

/** Lead source identifier */
export type LeadSource = 'CHATBOT' | 'WEBSITE_FORM' | 'ADS' | 'MANUAL';

/** Canonical person/lead representation */
export interface CdmPerson {
    /** Unique external identifier for idempotent upsert (e.g., sessionId) */
    externalId?: string;
    firstName: string;
    lastName: string;
    fullName: string;
    phone: string;
    email?: string;
    /** Address / location text */
    address?: string;
    /** Qualification score 0-100 (normalized to 0-1 for Twenty) */
    qualificationScore?: number;
    /** Derived qualification level */
    qualificationLevel?: QualificationLevel;
    /** Lead source channel */
    source?: LeadSource;
    /** CRM notes (mapped to notesExpertise in Twenty) */
    notes?: string;
}

/** Canonical company representation */
export interface CdmCompany {
    name: string;
    domain?: string;
    address?: {
        street?: string;
        city?: string;
        postalCode?: string;
        country?: string;
    };
}

/** Canonical opportunity / deal */
export interface CdmOpportunity {
    externalId: string;
    name: string;
    stage: 'new' | 'qualified' | 'proposal' | 'won' | 'lost';
    amount?: number;
    closeDate?: string; // ISO date
    notes?: string;
}

/** Full lead payload pushed from the chatbot to the CRM */
export interface CdmLead {
    person: CdmPerson;
    company?: CdmCompany;
    opportunity?: CdmOpportunity;
    /** Project type: Achat, Vente, Location, etc. */
    projectType: string;
    /** Description of what the client needs */
    need: string;
    /** Target area / address */
    location: string;
    /** Appointment date (ISO YYYY-MM-DD) */
    appointmentDate?: string;
    /** Tags (e.g. "Estimation") */
    tags?: string[];
    /** Qualification score 0-100 */
    qualificationScore: number;
    /** Conversation summary */
    summary: string;
    /** Agent notes (technical) */
    notes: string;
    /** Human-like agent impression note (2-3 lines) */
    agentNote?: string;
    // ─── P0-B: Structured note fields ───────────────────────────────
    /** Domain/métier context (immobilier, garage, generic) */
    domain?: string;
    /** Domain display name */
    domainName?: string;
    /** Fields that are still missing */
    missingFields?: string[];
    /** Session ID for traceability */
    sessionId?: string;
}

/** Result from a CRM push operation */
export interface CrmPushResult {
    success: boolean;
    /** Provider-specific record ID */
    recordId?: string;
    error?: string;
    /** Was this a duplicate that was skipped? */
    duplicate?: boolean;
}

/** Provider configuration */
export interface CrmProviderConfig {
    provider: 'airtable' | 'twenty';
    enabled: boolean;
    /** For Airtable: webhook URL. For Twenty: API base URL. */
    baseUrl: string;
    /** API key or token (read from env, never logged) */
    apiKey: string;
    /** Timeout in ms */
    timeoutMs: number;
    /** Extra provider-specific options */
    options?: Record<string, unknown>;
}

/** Schema snapshot from Twenty metadata API */
export interface TwentySchemaSnapshot {
    version: string;
    fetchedAt: string;
    objects: TwentyObjectMeta[];
}

export interface TwentyObjectMeta {
    nameSingular: string;
    namePlural: string;
    fields: TwentyFieldMeta[];
}

export interface TwentyFieldMeta {
    name: string;
    type: string;
    isRequired: boolean;
    isCustom: boolean;
}
