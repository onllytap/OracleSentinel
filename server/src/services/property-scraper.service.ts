import puppeteer, { Browser, Page } from 'puppeteer';
import { getSiteConfig, buildPaginationUrl, SiteConfig, reloadSiteConfig } from '../config/site-config';

// ============================================
// TYPES
// ============================================

export interface Property {
    ref: string;
    type: string;
    price: number;
    priceFormatted: string;
    surface: number;
    rooms: number;
    bedrooms: number;
    location: string;
    floor: string;
    buildingFloors: number;
    description: string;
    url: string;
    features: string[];
    scrapedAt: number;
}

// ============================================
// CACHE
// ============================================

const propertyCache: Map<string, Property> = new Map();
let lastFullScrape: number = 0;
const CACHE_TTL = 3600 * 1000;

// ============================================
// CONFIGURABLE PROPERTY SCRAPER
// ============================================

export class PropertyScraperService {
    private static browser: Browser | null = null;
    private static browserPromise: Promise<Browser> | null = null;
    private static scrapePromise: Promise<Property[]> | null = null;
    private static config: SiteConfig = getSiteConfig();

    /**
     * Reload configuration from .env
     */
    static reloadConfig(): void {
        this.config = reloadSiteConfig();
        console.log(`🔄 Config reloaded: ${this.config.name}`);
    }

    private static async getBrowser(): Promise<Browser> {
        if (this.browser) {
            return this.browser;
        }

        if (!this.browserPromise) {
            console.log('🚀 Launching Puppeteer browser...');
            this.browserPromise = puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        }

        try {
            const browser = await this.browserPromise;
            this.browser = browser;
            return browser;
        } catch (error) {
            this.browserPromise = null;
            throw error;
        }
    }

    static async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.browserPromise = null;
    }

    /**
     * Accept cookies using configured button text
     */
    private static async acceptCookies(page: Page): Promise<void> {
        const cookieText = this.config.cookieButtonText.toLowerCase();
        if (!cookieText) return;

        try {
            await page.evaluate((text) => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const btn = buttons.find(b => b.textContent?.toLowerCase().includes(text));
                if (btn) (btn as HTMLElement).click();
            }, cookieText);
            await new Promise(r => setTimeout(r, 1000));
            console.log('✅ Cookies accepted');
        } catch { /* ignore */ }
    }

    /**
     * Click overlay button if configured
     */
    private static async clickOverlay(page: Page): Promise<void> {
        const overlayText = this.config.overlayButtonText.toLowerCase();
        if (!overlayText) return;

        try {
            const buttons = await page.$$('button, a, .cta');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent?.toLowerCase() || '', btn);
                if (text.includes(overlayText.split(' ')[0]) && text.includes(overlayText.split(' ').pop() || '')) {
                    await btn.click();
                    console.log(`✅ Clicked overlay: "${overlayText}"`);
                    break;
                }
            }
            await new Promise(r => setTimeout(r, this.config.loadDelay));
        } catch { /* ignore */ }
    }

    /**
     * Scrape listing page using configured selectors
     */
    private static async scrapeListingPage(page: Page, url: string): Promise<Partial<Property>[]> {
        const config = this.config;
        console.log(`📄 Scraping: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, config.loadDelay));
        await this.acceptCookies(page);
        await this.clickOverlay(page);

        // Wait for cards
        try {
            await page.waitForSelector(config.cardSelector, { timeout: 10000 });
            console.log('✅ Cards loaded');
        } catch {
            console.log(`⚠️ No cards found with: ${config.cardSelector}`);
        }

        // Debug count
        const cardCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, config.cardSelector);
        console.log(`📊 Found ${cardCount} cards`);

        // Scroll for lazy loading
        await page.evaluate(() => window.scrollBy(0, 500));
        await new Promise(r => setTimeout(r, 1000));

        // Extract with configured selectors
        return await page.evaluate((cfg) => {
            const results: any[] = [];
            const cards = document.querySelectorAll(cfg.cardSelector);

            cards.forEach((card, index) => {
                // Price
                let price = 0;
                let priceText = '';
                if (cfg.priceSelector) {
                    const priceEl = card.querySelector(cfg.priceSelector);
                    priceText = priceEl?.textContent?.replace(/\s/g, '') || '';
                    const priceMatch = priceText.match(/(\d+)/);
                    price = priceMatch ? parseInt(priceMatch[1]) : 0;
                }

                // Location
                let location = '';
                if (cfg.locationSelector) {
                    const locEl = card.querySelector(cfg.locationSelector);
                    location = locEl?.textContent?.trim().replace(/\s*\(\d+\)/, '') || '';
                }

                // Title/Type
                let titleText = '';
                let type = 'Bien';
                if (cfg.typeSelector) {
                    const titleEl = card.querySelector(cfg.typeSelector);
                    titleText = titleEl?.textContent?.trim() || '';
                    if (titleText.toLowerCase().includes('appartement')) type = 'Appartement';
                    else if (titleText.toLowerCase().includes('maison')) type = 'Maison';
                    else if (titleText.toLowerCase().includes('studio')) type = 'Studio';
                    else if (titleText.toLowerCase().includes('terrain')) type = 'Terrain';
                }

                // Surface, rooms, bedrooms from selectors or regex on title
                let surface = 0, rooms = 0, bedrooms = 0;

                if (cfg.surfaceSelector) {
                    const surfEl = card.querySelector(cfg.surfaceSelector);
                    const surfMatch = surfEl?.textContent?.match(/(\d+)/);
                    surface = surfMatch ? parseInt(surfMatch[1]) : 0;
                } else if (cfg.surfaceRegex) {
                    const match = titleText.match(new RegExp(cfg.surfaceRegex, 'i'));
                    surface = match ? parseInt(match[1]) : 0;
                }

                if (cfg.roomsSelector) {
                    const roomsEl = card.querySelector(cfg.roomsSelector);
                    const roomsMatch = roomsEl?.textContent?.match(/(\d+)/);
                    rooms = roomsMatch ? parseInt(roomsMatch[1]) : 0;
                } else if (cfg.roomsRegex) {
                    const match = titleText.match(new RegExp(cfg.roomsRegex, 'i'));
                    rooms = match ? parseInt(match[1]) : 0;
                }

                if (cfg.bedroomsSelector) {
                    const bedEl = card.querySelector(cfg.bedroomsSelector);
                    const bedMatch = bedEl?.textContent?.match(/(\d+)/);
                    bedrooms = bedMatch ? parseInt(bedMatch[1]) : 0;
                }

                // Link
                let linkEl = card.querySelector(cfg.linkSelector) as HTMLAnchorElement;
                if (!linkEl) linkEl = card.querySelector('a') as HTMLAnchorElement;
                const url = linkEl?.href || '';

                // Reference from URL or selector
                let ref = `gen-${index}`;
                if (cfg.refSelector) {
                    const refEl = card.querySelector(cfg.refSelector);
                    ref = refEl?.textContent?.trim() || ref;
                } else {
                    const refMatch = url.match(/\/(\d{3,})/) || url.match(/\/(\d+)-/);
                    if (refMatch) ref = refMatch[1];
                }

                results.push({
                    ref,
                    type,
                    price,
                    priceFormatted: price > 0 ? `${price.toLocaleString('fr-FR')} €` : 'Prix NC',
                    surface,
                    rooms,
                    bedrooms,
                    location,
                    description: titleText,
                    url
                });
            });

            return results;
        }, {
            cardSelector: config.cardSelector,
            priceSelector: config.priceSelector,
            surfaceSelector: config.surfaceSelector,
            roomsSelector: config.roomsSelector,
            bedroomsSelector: config.bedroomsSelector,
            locationSelector: config.locationSelector,
            typeSelector: config.typeSelector,
            linkSelector: config.linkSelector,
            refSelector: config.refSelector,
            surfaceRegex: config.surfaceRegex,
            roomsRegex: config.roomsRegex
        });
    }

    /**
     * Scrape detail page for floor and features
     */
    private static async scrapeDetailPage(page: Page, url: string): Promise<{ floor: string, buildingFloors: number, features: string[], fullDescription: string }> {
        const config = this.config;
        console.log(`🏠 Detail: ${url.substring(0, 60)}...`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 1500));

        return await page.evaluate((cfg) => {
            const bodyText = document.body.textContent || '';

            // Floor extraction using configured regex
            let floor = 'Non précisé';
            if (cfg.floorRegex) {
                const floorPatterns = [
                    new RegExp(cfg.floorRegex, 'i'),
                    /(rez-de-chauss[ée]e|rdc)/i,
                    /(\d+)(?:er|ème|e)?\s*étage/i
                ];
                for (const pattern of floorPatterns) {
                    const match = bodyText.match(pattern);
                    if (match) {
                        floor = match[1] || match[0];
                        floor = floor.charAt(0).toUpperCase() + floor.slice(1).toLowerCase();
                        break;
                    }
                }
            }

            // Building floors
            let buildingFloors = 0;
            if (cfg.buildingFloorsRegex) {
                const buildingMatch = bodyText.match(new RegExp(cfg.buildingFloorsRegex, 'i'));
                if (buildingMatch) buildingFloors = parseInt(buildingMatch[1]);
            }

            // Features
            const features: string[] = [];
            if (cfg.featuresSelector) {
                const featureEls = document.querySelectorAll(cfg.featuresSelector);
                featureEls.forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text.length < 50) features.push(text);
                });
            }
            // Also extract from body text
            const featureKeywords = ['ascenseur', 'cave', 'parking', 'garage', 'balcon', 'terrasse', 'piscine', 'jardin'];
            for (const kw of featureKeywords) {
                if (bodyText.toLowerCase().includes(kw) && !features.some(f => f.toLowerCase().includes(kw))) {
                    features.push(kw.charAt(0).toUpperCase() + kw.slice(1));
                }
            }

            // Description
            let fullDescription = '';
            if (cfg.descriptionSelector) {
                const descEl = document.querySelector(cfg.descriptionSelector);
                fullDescription = descEl?.textContent?.trim() || '';
            }

            return { floor, buildingFloors, features: features.slice(0, 10), fullDescription };
        }, {
            floorRegex: config.floorRegex,
            buildingFloorsRegex: config.buildingFloorsRegex,
            featuresSelector: config.featuresSelector,
            descriptionSelector: config.descriptionSelector
        });
    }

    /**
     * Scrape all properties using configuration
     */
    static async scrapeAllProperties(): Promise<Property[]> {
        if (Date.now() - lastFullScrape < CACHE_TTL && propertyCache.size > 0) {
            console.log(`📦 Using cache (${propertyCache.size} items)`);
            return Array.from(propertyCache.values());
        }

        if (this.scrapePromise) {
            return this.scrapePromise;
        }

        this.scrapePromise = (async () => {
            const config = this.config;
            console.log(`🌐 Scraping ${config.name} (${config.maxPages} pages)`);

            const browser = await this.getBrowser();
            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            const allProperties: Property[] = [];
            const nextCache: Map<string, Property> = new Map();

            try {
                for (let pageNum = 1; pageNum <= config.maxPages; pageNum++) {
                    const listUrl = buildPaginationUrl(config, pageNum);
                    const listings = await this.scrapeListingPage(page, listUrl);

                    console.log(`📋 Page ${pageNum}: ${listings.length} listings`);
                    if (listings.length === 0) break;

                    // OPTIMIZATION: Only scrape full details for the top 3 properties to save time (3s vs 30s)
                    // For the rest, use the data available on the listing card
                    const detailedLimit = 3;

                    // Process first few with details in parallel
                    const detailedListings = await Promise.all(
                        listings.slice(0, detailedLimit).map(async (listing) => {
                            if (!listing.url) return null;

                            const detailPage = await browser.newPage();
                            await detailPage.setViewport({ width: 1920, height: 1080 });
                            await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

                            try {
                                const details = await this.scrapeDetailPage(detailPage, listing.url);
                                return { ...listing, ...details };
                            } catch (e) {
                                return listing;
                            } finally {
                                try {
                                    await detailPage.close();
                                } catch {}
                            }
                        })
                    );

                    const finalListings = [
                        ...detailedListings.filter(l => l !== null),
                        ...listings.slice(detailedLimit)
                    ];

                    for (const listing of finalListings) {
                        if (listing && listing.url) {
                            const floor = (listing as any).floor || 'Non précisé';
                            const buildingFloors = (listing as any).buildingFloors || 0;
                            const features = (listing as any).features || [];
                            const fullDesc = (listing as any).fullDescription || listing.description || '';

                            const property: Property = {
                                ref: listing.ref || `gen-${allProperties.length}`,
                                type: listing.type || 'Bien',
                                price: listing.price || 0,
                                priceFormatted: listing.priceFormatted || 'Prix NC',
                                surface: listing.surface || 0,
                                rooms: listing.rooms || 0,
                                bedrooms: listing.bedrooms || 0,
                                location: listing.location || '',
                                floor: floor,
                                buildingFloors: buildingFloors,
                                description: fullDesc,
                                url: listing.url,
                                features: features,
                                scrapedAt: Date.now()
                            };
                            allProperties.push(property);
                            nextCache.set(property.ref, property);
                        }
                    }
                }
                lastFullScrape = Date.now();
                console.log(`📊 Total: ${allProperties.length} properties`);

                if (nextCache.size > 0) {
                    propertyCache.clear();
                    for (const [ref, prop] of nextCache.entries()) {
                        propertyCache.set(ref, prop);
                    }
                }
            } finally {
                await page.close();
            }

            if (allProperties.length === 0 && propertyCache.size > 0) {
                return Array.from(propertyCache.values());
            }

            return allProperties;
        })();

        try {
            return await this.scrapePromise;
        } finally {
            this.scrapePromise = null;
        }
    }

    static getPropertyByRef(ref: string): Property | undefined {
        return propertyCache.get(ref);
    }

    static searchProperties(criteria: { type?: string; minPrice?: number; maxPrice?: number; minSurface?: number; minRooms?: number; floor?: string; }): Property[] {
        return Array.from(propertyCache.values()).filter(p => {
            if (criteria.type && !p.type.toLowerCase().includes(criteria.type.toLowerCase())) return false;
            if (criteria.minPrice && p.price < criteria.minPrice) return false;
            if (criteria.maxPrice && p.price > criteria.maxPrice) return false;
            if (criteria.minSurface && p.surface < criteria.minSurface) return false;
            if (criteria.minRooms && p.rooms < criteria.minRooms) return false;
            if (criteria.floor && !p.floor.toLowerCase().includes(criteria.floor.toLowerCase())) return false;
            return true;
        });
    }

    static formatPropertiesForContext(properties: Property[]): string {
        if (properties.length === 0) return '';
        const config = this.config;
        const header = `\n📋 ${properties.length} BIENS IMMOBILIERS - ${config.name}:\n\n`;
        const lines = properties.map((p, i) => {
            const features = p.features.length > 0 ? ` | ${p.features.slice(0, 3).join(', ')}` : '';
            return `${i + 1}. **${p.type}** Ref:${p.ref} - ${p.location}
   💰 ${p.priceFormatted} | 📐 ${p.surface}m² | 🏠 ${p.rooms}P/${p.bedrooms}Ch
   🏢 Étage: ${p.floor}${p.buildingFloors ? ` (immeuble ${p.buildingFloors} étages)` : ''}${features}`;
        }).join('\n\n');
        return header + lines + '\n\n⚠️ Données RÉELLES. Ne jamais inventer.';
    }

    static getCacheStats() {
        return {
            site: this.config.name,
            size: propertyCache.size,
            lastScrape: lastFullScrape ? new Date(lastFullScrape).toISOString() : 'Never',
            refs: Array.from(propertyCache.keys())
        };
    }

    static clearCache() {
        propertyCache.clear();
        lastFullScrape = 0;
        console.log('🗑️ Cache cleared');
    }
}
