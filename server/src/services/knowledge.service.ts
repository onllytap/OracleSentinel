import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import path from 'path';
import { PropertyScraperService } from './property-scraper.service';
import { CatalogService } from './catalog.service';
import { debugLog } from '../utils/debug-log';

// Reload env at runtime to pick up changes
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============================================
// CONFIGURATION (read dynamically)
// ============================================

function getKnowledgeUrls(): string[] {
    const urls = process.env.KNOWLEDGE_URLS || '';
    return urls.split(',').map(u => u.trim()).filter(Boolean);
}

const CACHE_TTL = (parseInt(process.env.KNOWLEDGE_CACHE_TTL || '3600') || 3600) * 1000;
const FETCH_TIMEOUT_MS = parseInt(process.env.KNOWLEDGE_FETCH_TIMEOUT_MS || '10000') || 10000;

// ============================================
// TYPES
// ============================================

interface CachedPage {
    url: string;
    title: string;
    content: string;
    fetchedAt: number;
}

interface KnowledgeChunk {
    title: string;
    url: string;
    content: string;
    relevance?: number;
}

type KnowledgeRoute = 'CATALOGUE' | 'SITE_PUBLIC' | 'MIXTE';

// ============================================
// IN-MEMORY CACHE
// ============================================

const pageCache: Map<string, CachedPage> = new Map();
const inFlightFetch: Map<string, Promise<CachedPage | null>> = new Map();

// ============================================
// KNOWLEDGE SERVICE
// ============================================

export class KnowledgeService {
    /**
     * Determine if a user question needs knowledge lookup
     * Improved: handles typos, broader patterns, question marks
     */
    static needsKnowledgeLookup(question: string): boolean {
        const lowerQ = question.toLowerCase().trim();
        const originalQ = question.trim();

        const looksLikeRef = /\bref\s*\d{3,10}\b/i.test(originalQ) || /\bref\d{3,10}\b/i.test(originalQ);

        const route = this.routeQuery(originalQ);

        const hasCatalogueCriteria = (() => {
            if (looksLikeRef) return true;
            if (/\b(appartement|maison|studio|terrain|villa)\b/i.test(lowerQ)) return true;
            if (/\b(achat|acheter|location|louer|vente|vendre)\b/i.test(lowerQ)) return true;
            if (/\bt\s*[1-6]\b/i.test(lowerQ) || /\bpi(è|e)ces?\b/i.test(lowerQ) || /\bchambres?\b/i.test(lowerQ)) return true;
            if (/\b\d{1,3}\s*(m²|m2)\b/i.test(lowerQ) || /(m²|m2)/i.test(lowerQ)) return true;
            if (/(€|euros?)/i.test(lowerQ) || /\bbudget\b/i.test(lowerQ) || /\bprix\b/i.test(lowerQ)) return true;
            if (/\b\d{2,3}\s*k\b/i.test(lowerQ) || /\b\d{5,6}\b/.test(lowerQ)) return true;
            return false;
        })();

        // ═══════════════════════════════════════════════════════════
        // STEP 1: EXCLUDE ONLY pure greetings (very strict)
        // ═══════════════════════════════════════════════════════════
        const pureGreetings = [
            /^(hi|hey|hello|bonjour|salut|coucou|yo|bonsoir)\s*[!?.,]*$/i,
            /^(merci|thanks|thank you|thx)\s*[!?.,]*$/i,
            /^(ok|okay|d'accord|super|génial|cool|nice|great|parfait)\s*[!?.,]*$/i,
            /^(oui|non|yes|no|yep|nope|ouais)\s*[!?.,]*$/i,
            /^(bye|au revoir|à bientôt|ciao)\s*[!?.,]*$/i,
        ];

        for (const pattern of pureGreetings) {
            if (pattern.test(lowerQ)) {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`💬 Pure greeting, skipping: "${originalQ}"`);
                } else {
                    console.log('💬 Pure greeting, skipping');
                }
                return false;
            }
        }

        // Very short messages without question mark are likely greetings
        // Exception: short site/public questions like "adresse", "horaires", "contact"
        const shortButUseful = /\b(contact|adresse|horaires?|t(é|e)l(é|e)phone|email|mentions|rgpd|cookies)\b/i.test(lowerQ);
        if (lowerQ.length < 10 && !/\?/.test(lowerQ) && !shortButUseful) {
            if (process.env.NODE_ENV !== 'production') {
                console.log(`💬 Too short, skipping: "${originalQ}"`);
            } else {
                console.log('💬 Too short, skipping');
            }
            return false;
        }

        if (looksLikeRef) {
            if (process.env.NODE_ENV !== 'production') {
                console.log(`🏷️ Reference detected, triggering lookup: "${originalQ}"`);
            } else {
                console.log('🏷️ Reference detected, triggering lookup');
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 2: CHECK for real estate patterns (Prioritize these)
        // ═══════════════════════════════════════════════════════════
        const triggerPatterns = [
            // Real estate patterns
            /appartement/i,
            /maison/i,
            /terrain/i,
            /studio/i,
            /t[1-6]/i,
            /pièces?/i,
            /chambres?/i,
            /m²|m2|metres? carr/i,
            /budget/i,
            /euros?|€/i,
            /prix/i,
            /achat|acheter/i,
            /vente|vendre/i,
            /locat|louer/i,
            /cherche|recherche/i,
            /disponible/i,
            /annonce/i,
            /offre/i,
            /offre/i,
            /bien immobil/i,
            /visite/i,
            /rdv|rendez-vous/i,
            /dispo/i,
            /voir/i,

            // Site public patterns
            /contact/i,
            /t(é|e)l(é|e)phone|num(é|e)ro/i,
            /email|e-mail/i,
            /adresse/i,
            /horaires?|ouvert|ferme|ouverture/i,
            /honoraires?|frais/i,
            /mentions l(é|e)gales?/i,
            /politique de confidentialit(é|e)/i,
            /rgpd|cookies/i,
            /services?/i,
        ];

        // START: EXCLUDE CHATTY QUESTIONS from the generic "?" rule
        const chattyQuestions = [
            /comment (ça|ca) va/i,
            /comment allez(-| )vous/i,
            /tu es qui/i,
            /qui es(-| )tu/i,
            /t'as quel age/i,
            /d'ou viens(-| )tu/i,
        ];

        const isChatty = chattyQuestions.some(p => p.test(lowerQ));

        if (/\?/.test(originalQ) && lowerQ.length > 10 && !isChatty) {
            if (process.env.NODE_ENV !== 'production') {
                console.log(`🎯 Question mark detected (and not chatty), triggering lookup: "${originalQ}"`);
            } else {
                console.log('🎯 Question mark detected (and not chatty), triggering lookup');
            }
            if (route === 'CATALOGUE') {
                return hasCatalogueCriteria;
            }
            return true;
        }

        // Iterate over trigger patterns
        for (const pattern of triggerPatterns) {
            if (pattern.test(lowerQ)) {
                if (route === 'CATALOGUE') {
                    if (hasCatalogueCriteria) {
                        console.log(`🏠 Real estate keyword detected, triggering lookup`);
                        return true;
                    }
                    return false;
                }

                console.log(`🏠 Real estate keyword detected, triggering lookup`);
                return true;
            }
        }

        if (process.env.NODE_ENV !== 'production') {
            console.log(`💬 No lookup needed: "${originalQ.substring(0, 40)}..."`);
        } else {
            console.log('💬 No lookup needed');
        }
        return false;
    }

    /**
     * Fetch and parse a single webpage
     */
    static async fetchPage(url: string): Promise<CachedPage | null> {
        const cached = pageCache.get(url);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
            console.log(`📦 Cache hit: ${url}`);
            return cached;
        }

        const inFlight = inFlightFetch.get(url);
        if (inFlight) {
            return inFlight;
        }

        const promise = (async (): Promise<CachedPage | null> => {
            try {
                console.log(`🌐 Fetching: ${url}`);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

                try {
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; OracleSentinel/1.0)',
                            'Accept': 'text/html,application/xhtml+xml',
                            'Accept-Language': 'en-US,en;q=0.5,fr;q=0.3',
                        },
                        signal: controller.signal,
                    });

                    if (!response.ok) {
                        console.error(`❌ Failed: ${url} → ${response.status}`);
                        return null;
                    }

                    const html = await response.text();
                    const content = this.extractContent(html);
                    const title = this.extractTitle(html);

                    const page: CachedPage = { url, title, content, fetchedAt: Date.now() };
                    pageCache.set(url, page);
                    console.log(`✅ Cached: ${title} (${content.length} chars)`);
                    return page;
                } finally {
                    clearTimeout(timeout);
                }
            } catch (error) {
                console.error(`❌ Error: ${url}`, error);
                return null;
            }
        })();

        inFlightFetch.set(url, promise);
        try {
            return await promise;
        } finally {
            inFlightFetch.delete(url);
        }
    }

    /**
     * Extract clean text content from HTML
     */
    static extractContent(html: string): string {
        const $ = cheerio.load(html);

        // Remove non-content elements
        $('script, style, nav, header, footer, aside, form, iframe, noscript, svg, button').remove();
        $('[role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]').remove();
        $('.nav, .menu, .footer, .sidebar, .ad, .cookie, .popup, .modal').remove();

        // Try to get main content
        let content = '';
        const mainSelectors = ['main', 'article', '.content', '#content', '.main', '[role="main"]', '.page-content', '.entry-content', 'section'];

        for (const selector of mainSelectors) {
            const mainContent = $(selector).text();
            if (mainContent.length > 200) {
                content = mainContent;
                break;
            }
        }

        // Fallback to body
        if (!content || content.length < 200) {
            content = $('body').text();
        }

        // Clean up
        return content
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim()
            .substring(0, 10000);
    }

    /**
     * Extract page title
     */
    static extractTitle(html: string): string {
        const $ = cheerio.load(html);
        return $('title').text().trim() ||
            $('h1').first().text().trim() ||
            'Untitled Page';
    }

    /**
     * Fetch all configured knowledge URLs (simple fetch, no Puppeteer)
     */
    static async fetchAllKnowledge(): Promise<KnowledgeChunk[]> {
        const urls = getKnowledgeUrls();

        if (urls.length === 0) {
            console.warn('⚠️ No KNOWLEDGE_URLS configured');
            return [];
        }

        console.log(`📚 Fetching ${urls.length} URLs`);

        const results: KnowledgeChunk[] = [];
        for (const url of urls) {
            const page = await this.fetchPage(url);
            if (page) {
                results.push({ title: page.title, url: page.url, content: page.content });
            }
        }
        return results;
    }

    private static routeQuery(query: string): KnowledgeRoute {
        const q = query.toLowerCase();

        if (/\bref\s*\d{3,10}\b/i.test(query) || /\bref\d{3,10}\b/i.test(query)) {
            return 'CATALOGUE';
        }

        const catalogSignals = [
            /appartement/i,
            /maison/i,
            /terrain/i,
            /studio/i,
            /t[1-6]\b/i,
            /pi(è|e)ces?/i,
            /chambres?/i,
            /m²|m2|metres? carr/i,
            /budget/i,
            /euros?|€/i,
            /prix/i,
            /achat|acheter/i,
            /vente|vendre/i,
            /locat|louer/i,
            /cherche|recherche/i,
            /disponible/i,
            /annonce/i,
            /offre/i,
            /bien immobil/i,
            /propose(-| )moi/i,
        ];

        const siteSignals = [
            /contact/i,
            /t(é|e)l(é|e)phone|num(é|e)ro/i,
            /email|e-mail/i,
            /adresse/i,
            /horaires?|ouvert|ferme|ouverture/i,
            /honoraires?|frais/i,
            /mentions l(é|e)gales?/i,
            /politique de confidentialit(é|e)/i,
            /rgpd|cookies/i,
            /services?/i,
            /agence/i,
            /depuis quand|historique/i,
        ];

        const mixedSignals = [
            /visite/i,
            /rdv|rendez-vous/i,
            /comment (ça|ca) se passe/i,
            /processus/i,
            /proc(é|e)dure/i,
        ];

        const isCatalog = catalogSignals.some((p) => p.test(q));
        const isSite = siteSignals.some((p) => p.test(q));
        const isMixed = mixedSignals.some((p) => p.test(q));

        if ((isCatalog && isSite) || (isMixed && (isCatalog || isSite))) return 'MIXTE';
        if (isSite && !isCatalog) return 'SITE_PUBLIC';
        return 'CATALOGUE';
    }

    private static pickSiteUrls(query: string): string[] {
        const urls = getKnowledgeUrls();
        const maxUrls = Math.max(1, Math.min(3, parseInt(process.env.KNOWLEDGE_MAX_URLS || '3', 10) || 3));

        if (urls.length <= maxUrls) return urls;

        const q = query.toLowerCase();
        const keywords: string[] = [];

        if (/mentions l(é|e)gales?|legal/i.test(q)) keywords.push('mention', 'legal');
        if (/confidentialit(é|e)|privacy|rgpd/i.test(q)) keywords.push('confidential', 'privacy', 'rgpd');
        if (/horaires?|ouvert|ferme/i.test(q)) keywords.push('horaire', 'hour', 'open');
        if (/contact|t(é|e)l(é|e)phone|email|adresse/i.test(q)) keywords.push('contact', 'contactez', 'adresse');
        if (/honoraires?|frais/i.test(q)) keywords.push('honor', 'fee', 'tarif');
        if (/services?/i.test(q)) keywords.push('service');

        const scored = urls.map((u) => {
            const lu = u.toLowerCase();
            let score = 0;
            for (const k of keywords) {
                if (lu.includes(k)) score += 2;
            }
            if (score === 0 && (lu.includes('home') || lu.endsWith('/') || lu === (process.env.COMPANY_WEBSITE || '').toLowerCase())) score += 1;
            return { u, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, maxUrls).map((x) => x.u);
        return top.length > 0 ? top : urls.slice(0, maxUrls);
    }

    /**
     * Search knowledge base + properties
     */
    static async searchKnowledge(params: { query: string; tenantId?: string; requestId?: string }): Promise<KnowledgeChunk[]> {
        const route = this.routeQuery(params.query);
        const chunks: KnowledgeChunk[] = [];

        debugLog('knowledge.search.start', {
            requestId: params.requestId,
            route,
            tenantId: params.tenantId,
            query: params.query,
        });

        if (route === 'SITE_PUBLIC' || route === 'MIXTE') {
            const picked = this.pickSiteUrls(params.query);
            const pages: KnowledgeChunk[] = [];

            for (const url of picked) {
                const page = await this.fetchPage(url);
                if (!page) continue;
                pages.push({ title: page.title, url: page.url, content: page.content });
            }

            chunks.push(...pages);
            debugLog('knowledge.search.site_public', {
                requestId: params.requestId,
                pickedUrls: picked,
                resultsCount: pages.length,
            });
        }

        if (route === 'CATALOGUE' || route === 'MIXTE') {
            const tenantId = params.tenantId || 'default';
            try {
                const properties = await CatalogService.searchForContext({
                    query: params.query,
                    tenantId,
                    limit: 3,
                    requestId: params.requestId,
                });

                if (properties.length > 0) {
                    chunks.push({
                        title: `${properties.length} biens (catalogue interne)`,
                        url: 'catalog://internal',
                        content: CatalogService.formatPropertiesForContext(properties),
                    });
                }

                debugLog('knowledge.search.catalogue', {
                    requestId: params.requestId,
                    propertiesCount: properties.length,
                    propertyRefs: properties.map((p) => p.id_unique).slice(0, 10),
                });
            } catch (error) {
                console.error('❌ Catalog query failed:', error);

                const allowFallback = (process.env.CATALOG_FALLBACK_SCRAPER || '').trim() === '1';
                if (allowFallback) {
                    try {
                        const properties = await PropertyScraperService.scrapeAllProperties();
                        if (properties.length > 0) {
                            const propertyContext = PropertyScraperService.formatPropertiesForContext(properties);
                            chunks.push({
                                title: `${properties.length} biens immobiliers`,
                                url: 'https://www.buchy-immobilier.com/vente/appartements/',
                                content: propertyContext,
                            });
                        }
                    } catch (scrapeError) {
                        console.error('❌ Property scraping failed:', scrapeError);
                    }
                }
            }
        }

        debugLog('knowledge.search.end', {
            requestId: params.requestId,
            route,
            chunksCount: chunks.length,
        });

        console.log(`📚 Returning ${chunks.length} knowledge chunks (${route})`);
        return chunks;
    }

    /**
     * Build context string for LLM - includes company identity + website content
     */
    static buildContext(chunks: KnowledgeChunk[]): string {
        if (chunks.length === 0) return '';

        // Read company identity from environment
        const companyName = process.env.COMPANY_NAME || 'Our Company';
        const companyTagline = process.env.COMPANY_TAGLINE || '';
        const companyWebsite = process.env.COMPANY_WEBSITE || '';
        const companyDescription = process.env.COMPANY_DESCRIPTION || '';
        const companyServices = process.env.COMPANY_SERVICES || '';
        const targetAudience = process.env.TARGET_AUDIENCE || '';

        let context = '\n\n';
        context += '='.repeat(60) + '\n';
        context += 'COMPANY IDENTITY & KNOWLEDGE BASE\n';
        context += '='.repeat(60) + '\n\n';

        // Company identity section
        context += '📌 WHO WE ARE:\n';
        context += `Company: ${companyName}\n`;
        if (companyTagline) context += `Tagline: ${companyTagline}\n`;
        if (companyWebsite) context += `Website: ${companyWebsite}\n`;
        if (companyDescription) context += `Description: ${companyDescription}\n`;
        if (companyServices) context += `Services: ${companyServices}\n`;
        if (targetAudience) context += `Target Audience: ${targetAudience}\n`;
        context += '\n';

        // Website content section
        context += '📚 VERIFIED WEBSITE CONTENT:\n';
        context += '-'.repeat(60) + '\n\n';

        for (const chunk of chunks) {
            context += `PAGE: ${chunk.title}\n`;
            context += `URL: ${chunk.url}\n`;
            context += chunk.content.substring(0, 5000) + '\n\n';
        }

        context += '='.repeat(60) + '\n';
        context += 'RULES:\n';
        context += `- You represent ${companyName}\n`;
        context += '- Answer based on the website content above\n';
        context += '- If a service is mentioned above, we DO offer it\n';
        context += '- Do NOT contradict the website content\n';
        context += '='.repeat(60) + '\n';

        return context;
    }

    static clearCache(): void {
        pageCache.clear();
        console.log('🗑️ Cache cleared');
    }

    static getCacheStats() {
        return {
            size: pageCache.size,
            urls: Array.from(pageCache.keys()),
            configuredUrls: getKnowledgeUrls()
        };
    }
}
