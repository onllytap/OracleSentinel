// ============================================================================
// CRM Module — Public API
// ============================================================================

export type { CRMConnector } from './crm-connector.interface';
export type {
    CdmPerson,
    CdmCompany,
    CdmOpportunity,
    CdmLead,
    CrmPushResult,
    CrmProviderConfig,
    TwentySchemaSnapshot,
    TwentyObjectMeta,
    TwentyFieldMeta,
} from './types';
export { getCRMConnector, resetCRMConnector, getProviderName } from './crm-factory';
export { AirtableConnector } from './airtable-connector';
export { TwentyConnector } from './twenty-connector';
