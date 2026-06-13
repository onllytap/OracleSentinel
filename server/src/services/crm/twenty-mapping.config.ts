// ============================================================================
// Twenty CRM Field Mapping Configuration
// ============================================================================
// Declarative mapping from CDM (Canonical Data Model) to Twenty API fields.
// This file documents the exact Twenty field names used in the integration.

/**
 * CDM → Twenty People field mapping
 * 
 * Left side: CDM field name
 * Right side: Twenty API field path
 */
export const TWENTY_PEOPLE_MAPPING = {
    // Managed fields (standard Twenty schema)
    firstName: 'name.firstName',
    lastName: 'name.lastName',
    phone: 'phones.primaryPhoneNumber',
    phoneCountryCode: 'phones.primaryPhoneCountryCode',
    email: 'emails.primaryEmail',

    // Custom fields (configured in Twenty workspace)
    externalId: 'externalId',           // Text, Unique - idempotence key
    qualificationScore: 'qualificationScore',  // Number, format %, write 0-1
    qualificationLevel: 'qualificationLevel',  // Select: COLD|WARM|HOT
    source: 'source',                   // Select: CHATBOT|WEBSITE_FORM|ADS|MANUAL
    address: 'Adress',                  // Note: Twenty schema has typo "Adress"
    notes: 'notesExpertise',            // Text — CRM notes from conversation
} as const;

/**
 * Twenty select field valid values
 */
export const TWENTY_ENUMS = {
    qualificationLevel: ['COLD', 'WARM', 'HOT'] as const,
    source: ['CHATBOT', 'WEBSITE_FORM', 'ADS', 'MANUAL'] as const,
} as const;

/**
 * Score to qualificationLevel mapping
 * @param score 0-100 qualification score
 * @returns COLD | WARM | HOT
 */
export function computeQualificationLevel(score: number): 'COLD' | 'WARM' | 'HOT' {
    if (score < 40) return 'COLD';
    if (score < 70) return 'WARM';
    return 'HOT';
}

/**
 * Normalize score for Twenty (0-100 → 0-1)
 * Twenty displays as percentage, so we need to write 0-1 range
 * @param score 0-100 qualification score
 * @returns 0-1 normalized score
 */
export function normalizeScoreForTwenty(score: number): number {
    return Math.min(1, Math.max(0, score / 100));
}

/**
 * Default source for chatbot leads
 */
export const DEFAULT_SOURCE = 'CHATBOT' as const;

/**
 * Default phone country code (France)
 */
export const DEFAULT_PHONE_COUNTRY_CODE = '+33';
