// ============================================================================
// CRM Factory — Singleton provider switch
// ============================================================================

import type { CRMConnector } from './crm-connector.interface';
import type { CrmProviderConfig } from './types';
import { AirtableConnector } from './airtable-connector';
import { TwentyConnector } from './twenty-connector';
import { getCrmConfig } from './config';

let instance: CRMConnector | null = null;

function resolveConfig(): CrmProviderConfig {
    const crmConfig = getCrmConfig();
    const provider = crmConfig.provider;

    if (provider === 'twenty') {
        return {
            provider: 'twenty',
            enabled: process.env.TWENTY_ENABLED !== 'false',
            baseUrl: process.env.TWENTY_API_URL || 'https://api.twenty.com',
            apiKey: process.env.TWENTY_API_KEY || '',
            timeoutMs: crmConfig.retry.timeoutMs,
            options: {
                graphqlPreferred: process.env.TWENTY_USE_GRAPHQL !== 'false',
            },
        };
    }

    if (provider === 'airtable') {
        return {
            provider: 'airtable',
            enabled: process.env.AIRTABLE_ENABLED === 'true',
            baseUrl: process.env.AIRTABLE_WEBHOOK_URL || '',
            apiKey: '',
            timeoutMs: crmConfig.retry.timeoutMs,
        };
    }

    // Provider = none (disabled)
    return {
        provider: 'none' as any,
        enabled: false,
        baseUrl: '',
        apiKey: '',
        timeoutMs: 10000,
    };
}

/** Create a no-op connector when CRM is disabled */
function createNoOpConnector(): CRMConnector {
    return {
        providerName: 'none',
        isConfigured: () => false,
        testConnection: async () => false,
        checkDuplicate: async () => false,
        hasBeenPushed: () => false,
        pushLead: async () => ({ success: true, duplicate: false }),
        upsertPerson: async () => ({ success: true }),
        upsertCompany: async () => ({ success: true }),
        upsertOpportunity: async () => ({ success: true }),
        linkPersonToCompany: async () => ({ success: true }),
        searchByUniqueField: async () => null,
        getFailedLeadsCount: () => 0,
        retryFailedLeads: async () => { },
    };
}

/** Get or create the CRM connector singleton */
export function getCRMConnector(): CRMConnector {
    const crmConfig = getCrmConfig();

    if (!instance) {
        const config = resolveConfig();

        if (crmConfig.provider === 'none') {
            console.log('[CRM] Provider: DISABLED (CRM_PROVIDER=none)');
            instance = createNoOpConnector();
        } else if (config.provider === 'twenty') {
            instance = new TwentyConnector(config);
            console.log('[CRM] Provider: Twenty CRM');
        } else {
            instance = new AirtableConnector(config);
            console.log('[CRM] Provider: Airtable');
        }
    }
    return instance!;
}

/** Reset the singleton (for testing or config reload) */
export function resetCRMConnector(): void {
    instance = null;
}

/** Get provider name without creating instance */
export function getProviderName(): string {
    return (process.env.CRM_PROVIDER || 'airtable').toLowerCase().trim();
}
