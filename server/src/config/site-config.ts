import dotenv from 'dotenv';
import path from 'path';

// Reload env
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============================================
// SITE CONFIGURATION INTERFACE
// ============================================

export interface SiteConfig {
    // Identity
    name: string;
    baseUrl: string;
    listingUrl: string;

    // Pagination
    paginationPattern: string;
    maxPages: number;

    // CSS Selectors - Listing Page
    cardSelector: string;
    priceSelector: string;
    surfaceSelector: string;
    roomsSelector: string;
    bedroomsSelector: string;
    locationSelector: string;
    typeSelector: string;
    linkSelector: string;
    imageSelector: string;

    // CSS Selectors - Detail Page
    descriptionSelector: string;
    featuresSelector: string;
    refSelector: string;

    // Regex Patterns (for text extraction)
    floorRegex: string;
    buildingFloorsRegex: string;
    surfaceRegex: string;
    roomsRegex: string;
    refRegex: string;

    // Interactions
    cookieButtonText: string;
    overlayButtonText: string;
    loadDelay: number;

    // Notes
    notes: string;
}

// ============================================
// DEFAULT CONFIGURATION (Buchy Immobilier)
// ============================================

const DEFAULT_CONFIG: SiteConfig = {
    name: 'Buchy Immobilier',
    baseUrl: 'https://www.buchy-immobilier.com',
    listingUrl: 'https://www.buchy-immobilier.com/vente/appartements/',

    paginationPattern: 'https://www.buchy-immobilier.com/vente/appartements/{PAGE}',
    maxPages: 2,

    cardSelector: '.item__block',
    priceSelector: '.item__price',
    surfaceSelector: '',  // Extracted from title
    roomsSelector: '',    // Extracted from title
    bedroomsSelector: '', // Extracted from title
    locationSelector: '.item__block--city',
    typeSelector: '.item__block--title',
    linkSelector: 'a.cta-secondary',
    imageSelector: 'img',

    descriptionSelector: '.description, .bien-description, [class*="description"]',
    featuresSelector: '.features li, .caracteristiques li',
    refSelector: '',

    floorRegex: '(?:situé au|niveau|étage)\\s*:?\\s*(rez-de-chauss[ée]e|rdc|\\d+(?:er|ème|e)?\\s*étage)',
    buildingFloorsRegex: 'immeuble\\s*(?:de)?\\s*(\\d+)\\s*étage',
    surfaceRegex: '(\\d+)\\s*m[²2]',
    roomsRegex: '(\\d+)\\s*pièces?',
    refRegex: '(?:réf|ref|référence)\\s*:?\\s*(\\d+)',

    cookieButtonText: 'tout accepter',
    overlayButtonText: 'voir les annonces',
    loadDelay: 3000,

    notes: ''
};

// ============================================
// LOAD CONFIG FROM ENV
// ============================================

export function loadSiteConfig(): SiteConfig {
    const env = process.env;

    // If no SITE_NAME configured, use defaults
    if (!env.SITE_NAME && !env.SITE_BASE_URL) {
        console.log('📦 Using default Buchy Immobilier config');
        return DEFAULT_CONFIG;
    }

    console.log(`📦 Loading custom site config: ${env.SITE_NAME || 'Custom Site'}`);

    return {
        // Identity
        name: env.SITE_NAME || DEFAULT_CONFIG.name,
        baseUrl: env.SITE_BASE_URL || DEFAULT_CONFIG.baseUrl,
        listingUrl: env.SITE_LISTING_URL || DEFAULT_CONFIG.listingUrl,

        // Pagination
        paginationPattern: env.SITE_PAGINATION_PATTERN || DEFAULT_CONFIG.paginationPattern,
        maxPages: parseInt(env.SITE_MAX_PAGES || '') || DEFAULT_CONFIG.maxPages,

        // CSS Selectors - Listing
        cardSelector: env.SITE_CARD_SELECTOR || DEFAULT_CONFIG.cardSelector,
        priceSelector: env.SITE_PRICE_SELECTOR || DEFAULT_CONFIG.priceSelector,
        surfaceSelector: env.SITE_SURFACE_SELECTOR || DEFAULT_CONFIG.surfaceSelector,
        roomsSelector: env.SITE_ROOMS_SELECTOR || DEFAULT_CONFIG.roomsSelector,
        bedroomsSelector: env.SITE_BEDROOMS_SELECTOR || DEFAULT_CONFIG.bedroomsSelector,
        locationSelector: env.SITE_LOCATION_SELECTOR || DEFAULT_CONFIG.locationSelector,
        typeSelector: env.SITE_TYPE_SELECTOR || DEFAULT_CONFIG.typeSelector,
        linkSelector: env.SITE_LINK_SELECTOR || DEFAULT_CONFIG.linkSelector,
        imageSelector: env.SITE_IMAGE_SELECTOR || DEFAULT_CONFIG.imageSelector,

        // CSS Selectors - Detail
        descriptionSelector: env.SITE_DETAIL_DESCRIPTION_SELECTOR || DEFAULT_CONFIG.descriptionSelector,
        featuresSelector: env.SITE_DETAIL_FEATURES_SELECTOR || DEFAULT_CONFIG.featuresSelector,
        refSelector: env.SITE_DETAIL_REF_SELECTOR || DEFAULT_CONFIG.refSelector,

        // Regex
        floorRegex: env.SITE_FLOOR_REGEX || DEFAULT_CONFIG.floorRegex,
        buildingFloorsRegex: env.SITE_BUILDING_FLOORS_REGEX || DEFAULT_CONFIG.buildingFloorsRegex,
        surfaceRegex: env.SITE_SURFACE_REGEX || DEFAULT_CONFIG.surfaceRegex,
        roomsRegex: env.SITE_ROOMS_REGEX || DEFAULT_CONFIG.roomsRegex,
        refRegex: env.SITE_REF_REGEX || DEFAULT_CONFIG.refRegex,

        // Interactions
        cookieButtonText: env.SITE_COOKIE_BUTTON_TEXT || DEFAULT_CONFIG.cookieButtonText,
        overlayButtonText: env.SITE_OVERLAY_BUTTON_TEXT || DEFAULT_CONFIG.overlayButtonText,
        loadDelay: parseInt(env.SITE_LOAD_DELAY || '') || DEFAULT_CONFIG.loadDelay,

        // Notes
        notes: env.SITE_NOTES || ''
    };
}

// ============================================
// HELPER: Build pagination URL
// ============================================

export function buildPaginationUrl(config: SiteConfig, pageNum: number): string {
    if (pageNum === 1) {
        return config.listingUrl;
    }
    return config.paginationPattern.replace('{PAGE}', pageNum.toString());
}

// ============================================
// EXPORT SINGLETON CONFIG
// ============================================

let cachedConfig: SiteConfig | null = null;

export function getSiteConfig(): SiteConfig {
    if (!cachedConfig) {
        cachedConfig = loadSiteConfig();
    }
    return cachedConfig;
}

export function reloadSiteConfig(): SiteConfig {
    dotenv.config({ path: path.join(__dirname, '../../.env') });
    cachedConfig = loadSiteConfig();
    return cachedConfig;
}
