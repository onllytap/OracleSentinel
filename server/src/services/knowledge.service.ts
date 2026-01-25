import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import path from 'path';
import { PropertyScraperService } from './property-scraper.service';

// Reload env at runtime to pick up changes
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============================================
// CONFIGURATION (read dynamically)
// ============================================

function getKnowledgeUrls(): string[] {
    const urls = process.env.KNOWLEDGE_URLS || '';
    return urls.split(',').map(u => u.trim()).filter(Boolean);
}

const CACHE_TTL = parseInt(process.env.KNOWLEDGE_CACHE_TTL || '3600') * 1000;

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

// ============================================
// IN-MEMORY CACHE
// ============================================

const pageCache: Map<string, CachedPage> = new Map();

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
                console.log(`💬 Pure greeting, skipping: "${originalQ}"`);
                return false;
            }
        }

        // Very short messages without question mark are likely greetings
        if (lowerQ.length < 10 && !/\?/.test(lowerQ)) {
            console.log(`💬 Too short, skipping: "${originalQ}"`);
            return false;
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
            console.log(`🎯 Question mark detected (and not chatty), triggering lookup: "${originalQ}"`);
            return true;
        }

        // Iterate over trigger patterns
        for (const pattern of triggerPatterns) {
            if (pattern.test(lowerQ)) {
                console.log(`🏠 Real estate keyword detected, triggering lookup`);
                return true;
            }
        }

        console.log(`💬 No lookup needed: "${originalQ.substring(0, 40)}..."`);
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

        try {
            console.log(`🌐 Fetching: ${url}`);
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OracleSentinel/1.0)',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.5,fr;q=0.3',
                }
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

        } catch (error) {
            console.error(`❌ Error: ${url}`, error);
            return null;
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

    /**
     * Search knowledge base + properties
     */
    static async searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
        const allKnowledge = await this.fetchAllKnowledge();

        // Also scrape properties if query is about real estate
        const lowerQuery = query.toLowerCase();
        const isPropertyQuery = /appartement|maison|t[1-6]|pièces?|chambre|m²|étage|prix|budget|acheter|louer/.test(lowerQuery);

        if (isPropertyQuery) {
            console.log('🏠 Property query detected, loading property data...');
            try {
                const properties = await PropertyScraperService.scrapeAllProperties();

                if (properties.length > 0) {
                    const propertyContext = PropertyScraperService.formatPropertiesForContext(properties);
                    allKnowledge.push({
                        title: `${properties.length} biens immobiliers`,
                        url: 'https://www.buchy-immobilier.com/vente/appartements/',
                        content: propertyContext
                    });
                }
            } catch (error) {
                console.error('❌ Property scraping failed:', error);
            }
        }

        console.log(`📚 Returning ${allKnowledge.length} knowledge chunks`);
        return allKnowledge;
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
