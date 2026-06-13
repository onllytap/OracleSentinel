// ============================================================================
// AirtableConnector — Adapter wrapping existing AirtableService logic
// ============================================================================

import { pool } from '../../db/pool';
import type { CRMConnector } from './crm-connector.interface';
import type {
    CdmLead,
    CdmPerson,
    CdmCompany,
    CdmOpportunity,
    CrmPushResult,
    CrmProviderConfig,
} from './types';

// ---------------------------------------------------------------------------
// Helpers (same as original airtable.service.ts)
// ---------------------------------------------------------------------------

interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number, cfg: RetryConfig): number {
    const delay = cfg.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * cfg.baseDelayMs;
    return Math.min(delay + jitter, cfg.maxDelayMs);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function formatPhoneNumber(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('33')) digits = digits.substring(2);
    if (digits.startsWith('0')) digits = digits.substring(1);
    if (digits.length >= 9) {
        return `(+33) ${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, 9)}`;
    }
    return `(+33) ${digits}`;
}

// ---------------------------------------------------------------------------
// Failed-lead retry queue
// ---------------------------------------------------------------------------

interface FailedLead {
    lead: CdmLead;
    sessionId: string;
    attempts: number;
    lastAttempt: Date;
    error: string;
}

// ---------------------------------------------------------------------------
// AirtableConnector
// ---------------------------------------------------------------------------

export class AirtableConnector implements CRMConnector {
    readonly providerName = 'airtable';

    private config: CrmProviderConfig;
    private pushedSessions = new Map<string, number>(); // sessionId → timestamp
    private failedQueue: FailedLead[] = [];
    private dbInitialized = false;

    constructor(config: CrmProviderConfig) {
        this.config = config;
        // Periodic retry
        setInterval(() => this.retryFailedLeads(), 5 * 60 * 1000);
    }

    isConfigured(): boolean {
        return this.config.enabled && this.config.baseUrl.length > 0;
    }

    // ── DB dedup ───────────────────────────────────────────────────────

    private async ensureTable(): Promise<void> {
        if (this.dbInitialized) return;
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS crm_pushed_leads (
                    phone VARCHAR(50) PRIMARY KEY,
                    provider VARCHAR(20) NOT NULL DEFAULT 'airtable',
                    session_id VARCHAR(255),
                    record_id VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_crm_pushed_leads_created
                ON crm_pushed_leads (created_at)
            `);
            this.dbInitialized = true;
        } catch (e) {
            console.error('[Airtable] Failed to init dedup table:', e);
        }
    }

    async checkDuplicate(phone: string): Promise<boolean> {
        await this.ensureTable();
        try {
            const normalized = formatPhoneNumber(phone);
            const res = await pool.query(
                `SELECT COUNT(*) AS count FROM crm_pushed_leads WHERE phone = $1 AND created_at > NOW() - INTERVAL '30 days'`,
                [normalized],
            );
            return parseInt(res.rows[0]?.count || '0') > 0;
        } catch {
            return false;
        }
    }

    hasBeenPushed(sessionId: string): boolean {
        return this.pushedSessions.has(sessionId);
    }

    private markPushed(sessionId: string): void {
        this.pushedSessions.set(sessionId, Date.now());
        // Prevent memory leak: purge sessions older than 24h
        if (this.pushedSessions.size > 5000) {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const [key, ts] of this.pushedSessions) {
                if (ts < cutoff) this.pushedSessions.delete(key);
            }
        }
    }

    private async recordPush(phone: string, sessionId: string): Promise<void> {
        await this.ensureTable();
        try {
            const normalized = formatPhoneNumber(phone);
            await pool.query(
                `INSERT INTO crm_pushed_leads (phone, provider, session_id, created_at)
                 VALUES ($1, 'airtable', $2, NOW())
                 ON CONFLICT (phone) DO UPDATE SET session_id = $2, created_at = NOW()`,
                [normalized, sessionId],
            );
        } catch (e) {
            console.error('[Airtable] Record push error:', e);
        }
    }

    // ── Test connection ────────────────────────────────────────────────

    async testConnection(): Promise<boolean> {
        if (!this.isConfigured()) return false;
        try {
            const res = await fetch(this.config.baseUrl, {
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
            const data = await res.json() as { success?: boolean };
            return data.success === true;
        } catch {
            return false;
        }
    }

    // ── Unsupported granular ops (Airtable webhook = single payload) ──

    async upsertPerson(_person: CdmPerson): Promise<CrmPushResult> {
        return { success: false, error: 'Airtable webhook mode does not support granular upsert. Use pushLead().' };
    }

    async upsertCompany(_company: CdmCompany): Promise<CrmPushResult> {
        return { success: false, error: 'Airtable webhook mode does not support granular upsert. Use pushLead().' };
    }

    async upsertOpportunity(_opp: CdmOpportunity): Promise<CrmPushResult> {
        return { success: false, error: 'Airtable webhook mode does not support granular upsert. Use pushLead().' };
    }

    async linkPersonToCompany(_personId: string, _companyId: string): Promise<CrmPushResult> {
        return { success: false, error: 'Not applicable for Airtable webhook mode.' };
    }

    async searchByUniqueField(_objectType: 'person' | 'company' | 'opportunity', _field: string, _value: string): Promise<string | null> {
        return null; // Airtable webhook mode has no search capability
    }

    // ── Push full lead (Airtable webhook payload) ──────────────────────

    async pushLead(lead: CdmLead, sessionId: string): Promise<CrmPushResult> {
        if (!this.isConfigured()) {
            console.log('[Airtable] Not configured, skipping push');
            return { success: false, error: 'Airtable not configured' };
        }

        if (this.hasBeenPushed(sessionId)) {
            console.log('[Airtable] Session already pushed, skipping');
            return { success: true, duplicate: true };
        }

        const isDup = await this.checkDuplicate(lead.person.phone);
        if (isDup) {
            console.log('[Airtable] Duplicate phone, skipping');
            return { success: false, error: 'DUPLICATE_PHONE', duplicate: true };
        }

        const formattedPhone = formatPhoneNumber(lead.person.phone);

        // Read configurable field names from env (defaults match legacy French naming)
        const fields = {
            firstName: process.env.AIRTABLE_FIELD_FIRSTNAME || 'prenom',
            lastName: process.env.AIRTABLE_FIELD_LASTNAME || 'nom',
            fullName: process.env.AIRTABLE_FIELD_FULLNAME || 'nom_complet',
            phone: process.env.AIRTABLE_FIELD_PHONE || 'numero_telephone',
            type: process.env.AIRTABLE_FIELD_TYPE || 'type',
            need: process.env.AIRTABLE_FIELD_NEED || 'besoin',
            address: process.env.AIRTABLE_FIELD_ADDRESS || 'adresse',
            qualification: process.env.AIRTABLE_FIELD_QUALIFICATION || 'qualification',
            details: process.env.AIRTABLE_FIELD_DETAILS || 'details',
            notes: process.env.AIRTABLE_FIELD_NOTES || 'notes',
            appointment: process.env.AIRTABLE_FIELD_APPOINTMENT || 'date_rdv',
            tags: process.env.AIRTABLE_FIELD_TAGS || 'tags',
            email: process.env.AIRTABLE_FIELD_EMAIL || 'email',
            agentNote: process.env.AIRTABLE_FIELD_AGENTNOTE || 'impression_agent',
            // New fields — synchronized with Twenty
            externalId: process.env.AIRTABLE_FIELD_EXTERNALID || 'externalId',
            source: process.env.AIRTABLE_FIELD_SOURCE || 'source',
            qualificationLevel: process.env.AIRTABLE_FIELD_QUALIFICATIONLEVEL || 'qualificationLevel',
        };

        // Build Airtable webhook payload with configurable field names
        const payload: Record<string, any> = {
            [fields.firstName]: lead.person.firstName,
            [fields.lastName]: lead.person.lastName,
            [fields.fullName]: lead.person.fullName,
            [fields.phone]: formattedPhone,
            [fields.type]: lead.projectType,
            [fields.need]: lead.need,
            [fields.address]: lead.location,
            [fields.qualification]: lead.qualificationScore,
            [fields.details]: lead.summary,
            [fields.notes]: lead.notes || 'Premier contact — à qualifier.',
            // New fields — synchronized with Twenty
            [fields.externalId]: lead.person.externalId || '',
            [fields.source]: lead.person.source || 'CHATBOT',
            [fields.qualificationLevel]: lead.person.qualificationLevel || 'COLD',
        };

        // Optional fields
        if (lead.appointmentDate) payload[fields.appointment] = lead.appointmentDate;
        if (lead.tags?.length) payload[fields.tags] = lead.tags.join(', ');
        if (lead.person.email) payload[fields.email] = lead.person.email;
        if (lead.agentNote) payload[fields.agentNote] = lead.agentNote;

        for (let attempt = 0; attempt <= DEFAULT_RETRY.maxRetries; attempt++) {
            if (attempt > 0) {
                const delay = backoff(attempt - 1, DEFAULT_RETRY);
                console.log(`[Airtable] Retry ${attempt}/${DEFAULT_RETRY.maxRetries} after ${Math.round(delay)}ms`);
                await sleep(delay);
            }

            try {
                console.log('[Airtable] Pushing lead...');

                const response = await fetchWithTimeout(this.config.baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }, this.config.timeoutMs);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const rawBody = await response.text().catch(() => '');
                let parsed: any = null;
                if (rawBody?.trim()) {
                    try { parsed = JSON.parse(rawBody); } catch { parsed = null; }
                }

                if (parsed && parsed.success === false) {
                    throw new Error('Airtable webhook returned success=false');
                }

                console.log('[Airtable] Lead pushed successfully');
                this.markPushed(sessionId);
                await this.recordPush(lead.person.phone, sessionId);
                return { success: true };

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[Airtable] Attempt ${attempt + 1} failed:`, msg);

                if (attempt === DEFAULT_RETRY.maxRetries) {
                    this.failedQueue.push({
                        lead,
                        sessionId,
                        attempts: DEFAULT_RETRY.maxRetries + 1,
                        lastAttempt: new Date(),
                        error: msg,
                    });
                    return { success: false, error: msg };
                }
            }
        }
        return { success: false, error: 'Unknown error' };
    }

    // ── Retry queue ────────────────────────────────────────────────────

    getFailedLeadsCount(): number {
        return this.failedQueue.length;
    }

    async retryFailedLeads(): Promise<void> {
        if (this.failedQueue.length === 0) return;
        console.log(`[Airtable] Retrying ${this.failedQueue.length} failed leads`);

        const batch = [...this.failedQueue];
        this.failedQueue.length = 0;

        for (const item of batch) {
            const result = await this.pushLead(item.lead, item.sessionId);
            if (!result.success && !result.duplicate) {
                if (item.attempts < 10) {
                    this.failedQueue.push({
                        ...item,
                        attempts: item.attempts + 1,
                        lastAttempt: new Date(),
                        error: result.error || 'Unknown',
                    });
                } else {
                    console.error(`[Airtable] Lead permanently failed after ${item.attempts} attempts`);
                }
            }
        }
    }
}
