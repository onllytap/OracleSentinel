import dotenv from 'dotenv';
import path from 'path';
import { pool } from '../db/pool';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface LeadData {
    prenom: string;
    nom: string;
    nom_complet: string;
    numero_telephone: string;
    type: string;
    besoin: string;
    adresse: string;
    date_rdv?: string;
    tags?: string[];
    qualification: number;
    details: string;
    notes?: string;
}

interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
};

function formatPhoneNumber(phone: string): string {
    let digits = phone.replace(/\D/g, '');

    if (digits.startsWith('33')) {
        digits = digits.substring(2);
    }

    if (digits.startsWith('0')) {
        digits = digits.substring(1);
    }

    if (digits.length >= 9) {
        const part1 = digits.substring(0, 3);
        const part2 = digits.substring(3, 6);
        const part3 = digits.substring(6, 9);
        return `(+33) ${part1}-${part2}-${part3}`;
    }

    return `(+33) ${digits}`;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
    const delay = config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * config.baseDelayMs;
    return Math.min(delay + jitter, config.maxDelayMs);
}

const pushedConversations = new Set<string>();

interface FailedLead {
    lead: LeadData;
    sessionId: string;
    attempts: number;
    lastAttempt: Date;
    error: string;
}

const failedLeadsQueue: FailedLead[] = [];

export class AirtableService {
    private static webhookUrl = process.env.AIRTABLE_WEBHOOK_URL || '';
    private static enabled = process.env.AIRTABLE_ENABLED === 'true';
    private static initialized = false;

    private static async initTables(): Promise<void> {
        if (this.initialized) return;
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS airtable_leads (
                    phone VARCHAR(50) PRIMARY KEY,
                    session_id VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_airtable_leads_created_at
                ON airtable_leads (created_at)
            `);
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize airtable tables:', error);
        }
    }

    static isConfigured(): boolean {
        return this.enabled && this.webhookUrl.length > 0;
    }

    static hasBeenPushed(sessionId: string): boolean {
        return pushedConversations.has(sessionId);
    }

    static markAsPushed(sessionId: string): void {
        pushedConversations.add(sessionId);
        console.log(`Marked session ${sessionId} as pushed to prevent duplicates`);
    }

    static async checkDuplicate(phone: string): Promise<boolean> {
        try {
            await this.initTables();
            const normalizedPhone = formatPhoneNumber(phone);
            const result = await pool.query(
                `SELECT COUNT(*) as count FROM airtable_leads WHERE phone = $1 AND created_at > NOW() - INTERVAL '30 days'`,
                [normalizedPhone]
            );
            return parseInt(result.rows[0]?.count || '0') > 0;
        } catch (error) {
            console.error('Error checking duplicate:', error);
            return false;
        }
    }

    static async recordLead(phone: string, sessionId: string): Promise<void> {
        try {
            await this.initTables();
            const normalizedPhone = formatPhoneNumber(phone);
            await pool.query(
                `INSERT INTO airtable_leads (phone, session_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (phone) DO UPDATE SET session_id = $2, created_at = NOW()`,
                [normalizedPhone, sessionId]
            );
        } catch (error) {
            console.error('Error recording lead:', error);
        }
    }

    static async pushLead(
        lead: LeadData, 
        sessionId?: string,
        config: RetryConfig = DEFAULT_RETRY_CONFIG
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.isConfigured()) {
            console.log('Airtable not configured, skipping push');
            return { success: false, error: 'Airtable not configured' };
        }

        await this.initTables();

        if (sessionId && this.hasBeenPushed(sessionId)) {
            console.log('Lead already pushed for this session, skipping duplicate');
            return { success: true, error: 'Already pushed' };
        }

        const isDuplicate = await this.checkDuplicate(lead.numero_telephone);
        if (isDuplicate) {
            console.log('Duplicate phone number detected, skipping');
            return { success: false, error: 'DUPLICATE_PHONE' };
        }

        const formattedPhone = formatPhoneNumber(lead.numero_telephone);

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = calculateBackoff(attempt - 1, config);
                    console.log(`Retry attempt ${attempt}/${config.maxRetries} after ${delay}ms`);
                    await sleep(delay);
                }

                if (process.env.NODE_ENV !== 'production') {
                    console.log('Pushing lead to Airtable:', lead.nom_complet);
                } else {
                    console.log('Pushing lead to Airtable');
                }

                const payload: Record<string, any> = {
                    prenom: lead.prenom,
                    nom: lead.nom,
                    nom_complet: lead.nom_complet,
                    numero_telephone: formattedPhone,
                    type: lead.type,
                    besoin: lead.besoin,
                    adresse: lead.adresse,
                    qualification: lead.qualification,
                    details: lead.details,
                    notes: lead.notes || '',
                };

                const dateRdv = typeof lead.date_rdv === 'string' ? lead.date_rdv.trim() : '';
                if (dateRdv) {
                    payload.date_rdv = dateRdv;
                }

                const tagsCsv = Array.isArray(lead.tags) && lead.tags.length > 0 ? lead.tags.join(', ') : '';
                if (tagsCsv) {
                    payload.tags = tagsCsv;
                }

                if (process.env.NODE_ENV !== 'production') {
                    console.log(`📦 Airtable payload keys: ${Object.keys(payload).join(', ')}`);
                    console.log(`📝 Airtable notes length: ${(payload.notes || '').length}`);
                }

                const response = await fetchWithTimeout(this.webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                }, parseInt(process.env.AIRTABLE_TIMEOUT_MS || '10000'));

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                // Airtable Automations webhooks often return 2xx with empty body.
                // Consider any 2xx a success unless the body explicitly indicates failure.
                const rawBody = await response.text().catch(() => '');
                let parsed: any = null;
                if (rawBody && rawBody.trim()) {
                    try {
                        parsed = JSON.parse(rawBody);
                    } catch {
                        parsed = null;
                    }
                }

                if (parsed && parsed.success === false) {
                    throw new Error('Airtable webhook returned success=false');
                }

                console.log('Lead pushed to Airtable successfully');
                if (sessionId) {
                    this.markAsPushed(sessionId);
                    await this.recordLead(lead.numero_telephone, sessionId);
                }
                return { success: true };

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`Attempt ${attempt + 1} failed:`, errorMessage);

                if (attempt === config.maxRetries) {
                    console.error('All retries exhausted, queuing for later');
                    if (sessionId) {
                        failedLeadsQueue.push({
                            lead,
                            sessionId,
                            attempts: config.maxRetries + 1,
                            lastAttempt: new Date(),
                            error: errorMessage,
                        });
                    }
                    return { success: false, error: errorMessage };
                }
            }
        }

        return { success: false, error: 'Unknown error' };
    }

    static async retryFailedLeads(): Promise<void> {
        if (failedLeadsQueue.length === 0) return;

        console.log(`Processing ${failedLeadsQueue.length} failed leads`);

        const leadsToRetry = [...failedLeadsQueue];
        failedLeadsQueue.length = 0;

        for (const failed of leadsToRetry) {
            const result = await this.pushLead(failed.lead, failed.sessionId, {
                maxRetries: 1,
                baseDelayMs: 5000,
                maxDelayMs: 10000,
            });

            if (!result.success) {
                if (failed.attempts < 10) {
                    failedLeadsQueue.push({
                        ...failed,
                        attempts: failed.attempts + 1,
                        lastAttempt: new Date(),
                        error: result.error || 'Unknown',
                    });
                } else {
                    if (process.env.NODE_ENV !== 'production') {
                        console.error('Lead permanently failed after 10 attempts:', failed.lead.nom_complet);
                    } else {
                        console.error('Lead permanently failed after 10 attempts');
                    }
                }
            }
        }
    }

    static async testConnection(): Promise<boolean> {
        if (!this.isConfigured()) {
            return false;
        }

        try {
            const response = await fetch(this.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prenom: 'Test',
                    nom: 'Connection',
                    nom_complet: 'Test Connection',
                    numero_telephone: '(+33) 000-000-000',
                    type: 'Test',
                    besoin: 'Test de connexion',
                    adresse: 'N/A',
                    qualification: 0,
                    details: 'Test automatique de connexion webhook',
                    notes: 'Test automatique',
                }),
            });

            const result = await response.json() as { success?: boolean };
            return result.success === true;
        } catch {
            return false;
        }
    }

    static getFailedLeadsCount(): number {
        return failedLeadsQueue.length;
    }
}

setInterval(() => {
    AirtableService.retryFailedLeads();
}, 5 * 60 * 1000);
