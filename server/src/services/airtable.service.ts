import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============================================
// TYPES
// ============================================

export interface LeadData {
    prenom: string;
    nom: string;
    nom_complet: string;
    numero_telephone: string;
    type: string; // Achat immobilier, Vente immobilier, Location
    besoin: string;
    adresse: string;
    date_rdv?: string; // YYYY-MM-DD format
    qualification: number; // 0-100
    details: string; // Conversation summary
    notes?: string; // Context notes (preferences, urgency, etc.)
}

// ============================================
// PHONE FORMATTER
// ============================================

/**
 * Format French phone number to international format (+33)
 * Input: 0612345678, 06 12 34 56 78, 06.12.34.56.78, etc.
 * Output: (+33) 612-345-678
 */
function formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters
    let digits = phone.replace(/\D/g, '');

    // If starts with 33, it's already international
    if (digits.startsWith('33')) {
        digits = digits.substring(2);
    }

    // If starts with 0, remove it (French local format)
    if (digits.startsWith('0')) {
        digits = digits.substring(1);
    }

    // Format as (+33) XXX-XXX-XXX
    if (digits.length >= 9) {
        const part1 = digits.substring(0, 3);
        const part2 = digits.substring(3, 6);
        const part3 = digits.substring(6, 9);
        return `(+33) ${part1}-${part2}-${part3}`;
    }

    // If too short, return with prefix anyway
    return `(+33) ${digits}`;
}

// ============================================
// AIRTABLE SERVICE
// ============================================

// Track pushed conversations to prevent duplicates
const pushedConversations = new Set<string>();

export class AirtableService {
    private static webhookUrl = process.env.AIRTABLE_WEBHOOK_URL || '';
    private static enabled = process.env.AIRTABLE_ENABLED === 'true';

    /**
     * Check if Airtable integration is properly configured
     */
    static isConfigured(): boolean {
        return this.enabled && this.webhookUrl.length > 0;
    }

    /**
     * Check if a conversation has already been pushed
     */
    static hasBeenPushed(sessionId: string): boolean {
        return pushedConversations.has(sessionId);
    }

    /**
     * Mark a conversation as pushed
     */
    static markAsPushed(sessionId: string): void {
        pushedConversations.add(sessionId);
        console.log(`🔒 Marked session ${sessionId} as pushed to prevent duplicates`);
    }

    /**
     * Push a qualified lead to Airtable CRM
     */
    static async pushLead(lead: LeadData, sessionId?: string): Promise<{ success: boolean; error?: string }> {
        if (!this.isConfigured()) {
            console.log('⚠️ Airtable not configured, skipping push');
            return { success: false, error: 'Airtable not configured' };
        }

        // Prevent duplicate pushes
        if (sessionId && this.hasBeenPushed(sessionId)) {
            console.log('⚠️ Lead already pushed for this session, skipping duplicate');
            return { success: true, error: 'Already pushed' };
        }

        try {
            // Format phone number to (+33) format
            const formattedPhone = formatPhoneNumber(lead.numero_telephone);

            console.log('📤 Pushing lead to Airtable:', lead.nom_complet);
            console.log('📱 Phone formatted:', lead.numero_telephone, '→', formattedPhone);

            const response = await fetch(this.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prenom: lead.prenom,
                    nom: lead.nom,
                    nom_complet: lead.nom_complet,
                    numero_telephone: formattedPhone,
                    type: lead.type,
                    besoin: lead.besoin,
                    adresse: lead.adresse,
                    date_rdv: lead.date_rdv || '',
                    qualification: lead.qualification,
                    details: lead.details,
                    notes: lead.notes || '',
                }),
            });

            const result = await response.json() as { success?: boolean };

            if (result.success) {
                console.log('✅ Lead pushed to Airtable successfully');
                // Mark as pushed to prevent duplicates
                if (sessionId) {
                    this.markAsPushed(sessionId);
                }
                return { success: true };
            } else {
                console.error('❌ Airtable webhook returned error:', result);
                return { success: false, error: JSON.stringify(result) };
            }

        } catch (error) {
            console.error('❌ Failed to push lead to Airtable:', error);
            return { success: false, error: String(error) };
        }
    }

    /**
     * Test the webhook connection
     */
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
}
