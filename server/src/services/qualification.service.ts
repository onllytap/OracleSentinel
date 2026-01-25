import { LLMService } from './llm.service';

// ============================================
// TYPES
// ============================================

export interface ExtractedLeadData {
    prenom?: string;
    nom?: string;
    numero_telephone?: string;
    type?: string; // Achat, Vente, Location
    besoin?: string;
    adresse?: string;
    date_rdv?: string;
    notes?: string; // Context notes (preferences, urgency, etc.)
}

export interface QualificationResult {
    leadData: ExtractedLeadData;
    score: number;
    missingFields: string[];
    isComplete: boolean;
    conversationSummary: string;
    notes: string;
}

// ============================================
// QUALIFICATION SERVICE
// ============================================

export class QualificationService {
    /**
     * Extract lead data from conversation using LLM
     */
    static async extractLeadData(conversationHistory: { role: string; content: string }[]): Promise<QualificationResult> {
        const conversationText = conversationHistory
            .map(m => `${m.role === 'user' ? 'Client' : 'Agent'}: ${m.content}`)
            .join('\n');

        const extractionPrompt = `Tu es un extracteur de données pour CRM immobilier.

Analyse cette conversation et extrais les informations suivantes au format JSON.
Si une information n'est pas mentionnée, utilise null.

CONVERSATION:
${conversationText}

EXTRAIS CE JSON (et RIEN d'autre):
{
    "prenom": "prénom du client ou null",
    "nom": "nom de famille ou null",
    "numero_telephone": "numéro tel quel (ex: 0612345678) ou null",
    "type": "Achat immobilier|Vente immobilier|Location ou null",
    "besoin": "description du bien recherché ou null",
    "adresse": "secteur/ville recherché ou null",
    "date_rdv": "date format YYYY-MM-DD ou null",
    "score": 0-100,
    "summary": "résumé du projet immobilier en 2 phrases",
    "notes": "IMPORTANT: synthèse des infos hors-formulaire (ex: urgence, budget, contraintes, horaires de rappel, situation personnelle). Si aucune info spéciale, écrire 'Aucune note particulière'"
}

RÈGLES DE SCORING (0-100):
- Prénom/Nom fourni: +15 points
- Téléphone fourni: +20 points
- Type de projet clair: +15 points
- Besoin précis: +15 points
- Localisation précise: +15 points
- Date RDV proposée: +10 points
- Engagement/Motivation visible: +10 points

EXEMPLES DE NOTES:
- "Client pressé, déménage dans 2 mois pour changement de travail"
- "Premier achat, budget serré autour de 250k€"
- "Ne pas appeler le matin, préfère les SMS"
- "Famille avec 2 enfants, recherche proche école"
- "Investisseur, cherche rentabilité 6%+"

Réponds UNIQUEMENT avec le JSON, sans markdown ni explication.`;

        try {
            const response = await LLMService.generateResponse(
                [{ role: 'user', content: extractionPrompt }],
                'Tu es un extracteur JSON précis. Réponds uniquement avec du JSON valide.'
            );

            // Parse the JSON response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error('❌ Failed to extract JSON from LLM response');
                return this.getEmptyResult();
            }

            const extracted = JSON.parse(jsonMatch[0]);

            // Build result
            const leadData: ExtractedLeadData = {
                prenom: extracted.prenom || undefined,
                nom: extracted.nom || undefined,
                numero_telephone: extracted.numero_telephone || undefined,
                type: extracted.type || undefined,
                besoin: extracted.besoin || undefined,
                adresse: extracted.adresse || undefined,
                date_rdv: extracted.date_rdv || undefined,
                notes: extracted.notes || undefined,
            };

            const missingFields = this.getMissingFields(leadData);
            const score = typeof extracted.score === 'number' ? extracted.score : this.calculateScore(leadData);

            return {
                leadData,
                score,
                missingFields,
                isComplete: missingFields.length === 0,
                conversationSummary: extracted.summary || 'Conversation en cours',
                notes: extracted.notes || 'Aucune note particulière',
            };

        } catch (error) {
            console.error('❌ Error extracting lead data:', error);
            return this.getEmptyResult();
        }
    }

    /**
     * Get list of missing required fields
     */
    static getMissingFields(data: ExtractedLeadData): string[] {
        const required: (keyof ExtractedLeadData)[] = [
            'prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse'
        ];
        return required.filter(field => !data[field]);
    }

    /**
     * Calculate qualification score based on collected data
     */
    static calculateScore(data: ExtractedLeadData): number {
        let score = 0;

        if (data.prenom && data.nom) score += 15;
        if (data.numero_telephone) score += 20;
        if (data.type) score += 15;
        if (data.besoin) score += 15;
        if (data.adresse) score += 15;
        if (data.date_rdv) score += 10;

        return Math.min(score, 100);
    }

    /**
     * Get empty result for error cases
     */
    private static getEmptyResult(): QualificationResult {
        return {
            leadData: {},
            score: 0,
            missingFields: ['prenom', 'nom', 'numero_telephone', 'type', 'besoin', 'adresse'],
            isComplete: false,
            conversationSummary: '',
            notes: '',
        };
    }

    /**
     * Get the next question to ask based on missing fields
     */
    static getNextQuestionHint(missingFields: string[]): string {
        const fieldPriority: Record<string, string> = {
            prenom: 'demander le prénom',
            nom: 'demander le nom de famille',
            type: 'demander le type de projet (achat/vente/location)',
            besoin: 'demander la description du bien recherché',
            adresse: 'demander le secteur ou la ville',
            numero_telephone: 'demander le numéro de téléphone',
            date_rdv: 'proposer un rendez-vous',
        };

        if (missingFields.length === 0) {
            return 'toutes les informations sont collectées, proposer de confirmer le rendez-vous';
        }

        return fieldPriority[missingFields[0]] || 'continuer la conversation';
    }
}
