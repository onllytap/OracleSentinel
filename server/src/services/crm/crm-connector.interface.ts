// ============================================================================
// CRMConnector — Adapter interface (Strategy pattern)
// ============================================================================

import type {
    CdmLead,
    CdmPerson,
    CdmCompany,
    CdmOpportunity,
    CrmPushResult,
    CrmProviderConfig,
} from './types';

export interface CRMConnector {
    /** Human-readable provider name */
    readonly providerName: string;

    /** Test the connection (auth + reachability) */
    testConnection(): Promise<boolean>;

    /** Whether this connector is properly configured and enabled */
    isConfigured(): boolean;

    /** Push a complete lead (person + optional company/opportunity) */
    pushLead(lead: CdmLead, sessionId: string): Promise<CrmPushResult>;

    /** Upsert a person by phone or email */
    upsertPerson(person: CdmPerson): Promise<CrmPushResult>;

    /** Upsert a company by domain or name */
    upsertCompany(company: CdmCompany): Promise<CrmPushResult>;

    /** Upsert an opportunity by externalId */
    upsertOpportunity(opportunity: CdmOpportunity, personId?: string, companyId?: string): Promise<CrmPushResult>;

    /** Link a person to a company */
    linkPersonToCompany(personId: string, companyId: string): Promise<CrmPushResult>;

    /** Search for a record by unique field (phone, email, domain) */
    searchByUniqueField(objectType: 'person' | 'company' | 'opportunity', field: string, value: string): Promise<string | null>;

    /** Check if a phone was already pushed recently (dedup) */
    checkDuplicate(phone: string): Promise<boolean>;

    /** Mark a session as pushed (in-memory dedup) */
    hasBeenPushed(sessionId: string): boolean;

    /** Get count of failed leads in retry queue */
    getFailedLeadsCount(): number;

    /** Retry failed leads */
    retryFailedLeads(): Promise<void>;
}
