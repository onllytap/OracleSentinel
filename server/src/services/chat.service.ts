import { pool } from '../db/pool';
import { LLMService } from './llm.service';
import { KnowledgeService } from './knowledge.service';
import { QualificationService } from './qualification.service';
import { VariablesService } from './variables.service';
import { AirtableService, LeadData } from './airtable.service';

import { SYSTEM_PROMPT } from '../core/prompts';

// Response type with RAG and qualification metadata
export interface ChatResponse {
    response: string;
    sessionId: string;
    usedKnowledge: boolean;
    sourcePages?: { title: string; url: string }[];
    suggestedActions?: { type: string; label: string; data?: any }[];
    qualification?: {
        score: number;
        missingFields: string[];
        isComplete: boolean;
        pushedToCRM: boolean;
    };
}

export class ChatService {
    static async processMessage(sessionId: string, userMessage: string): Promise<ChatResponse> {
        const client = await pool.connect();
        try {
            // 1. Upsert Conversation
            const convRes = await client.query(
                `INSERT INTO conversations (session_id) 
         VALUES ($1) 
         ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW() 
         RETURNING id`,
                [sessionId]
            );
            const conversationId = convRes.rows[0].id;

            // 2. Save User Message
            await client.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
                [conversationId, userMessage]
            );

            // 3. Load History
            const historyRes = await client.query(
                `SELECT role, content FROM messages 
         WHERE conversation_id = $1 
         ORDER BY created_at ASC LIMIT 30`,
                [conversationId]
            );

            const history = historyRes.rows.map(row => ({
                role: row.role as 'user' | 'assistant',
                content: row.content as string
            }));

            // 4. RAG: Check if knowledge lookup is needed
            let knowledgeContext = '';
            let sourcePages: { title: string; url: string }[] = [];
            const needsLookup = KnowledgeService.needsKnowledgeLookup(userMessage);

            // 5. LLM: Generate response
            const systemPromptWithVars = SYSTEM_PROMPT.replace(
                '{DYNAMIC_VARIABLES}',
                VariablesService.getFormattedContext()
            );



            if (needsLookup) {
                console.log('🔍 Knowledge lookup triggered for:', userMessage.substring(0, 50));
                const chunks = await KnowledgeService.searchKnowledge(userMessage);

                if (chunks.length > 0) {
                    knowledgeContext = KnowledgeService.buildContext(chunks);
                    sourcePages = chunks.map(c => ({ title: c.title, url: c.url }));
                    console.log(`📚 Found ${chunks.length} relevant knowledge chunks`);
                }
            }

            // 5. Generate AI Response with optional knowledge context
            const enhancedPrompt = knowledgeContext
                ? `${knowledgeContext}\n\n${systemPromptWithVars}`
                : systemPromptWithVars;

            const aiResponseText = await LLMService.generateResponse(history, enhancedPrompt);

            // 6. Save Assistant Message
            await client.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
                [conversationId, aiResponseText]
            );

            // 7. QUALIFICATION: Extract lead data and calculate score
            const updatedHistory = [...history, { role: 'assistant' as const, content: aiResponseText }];
            const qualificationResult = await QualificationService.extractLeadData(updatedHistory);

            console.log(`📊 Qualification Score: ${qualificationResult.score}/100`);
            console.log(`📋 Missing fields: ${qualificationResult.missingFields.join(', ') || 'None'}`);

            // 8. AIRTABLE: Push to CRM if lead is complete and score is high enough
            let pushedToCRM = false;
            const minScore = parseInt(process.env.AIRTABLE_MIN_SCORE || '30');

            if (qualificationResult.isComplete && qualificationResult.score >= minScore) {
                const leadData: LeadData = {
                    prenom: qualificationResult.leadData.prenom || '',
                    nom: qualificationResult.leadData.nom || '',
                    nom_complet: `${qualificationResult.leadData.prenom || ''} ${qualificationResult.leadData.nom || ''}`.trim(),
                    numero_telephone: qualificationResult.leadData.numero_telephone || '',
                    type: qualificationResult.leadData.type || 'Non spécifié',
                    besoin: qualificationResult.leadData.besoin || '',
                    adresse: qualificationResult.leadData.adresse || '',
                    date_rdv: qualificationResult.leadData.date_rdv,
                    qualification: qualificationResult.score,
                    details: qualificationResult.conversationSummary,
                    notes: qualificationResult.notes || '',
                };

                try {
                    console.log('🚀 Pushing qualified lead to Airtable...');
                    console.log('📝 Notes:', leadData.notes);
                    const pushResult = await AirtableService.pushLead(leadData, sessionId);
                    pushedToCRM = pushResult.success;

                    if (pushedToCRM) {
                        // Mark conversation as completed
                        await client.query(
                            `UPDATE conversations SET status = 'completed' WHERE id = $1`,
                            [conversationId]
                        );

                        // Also save to local leads table
                        await client.query(
                            `INSERT INTO leads (conversation_id, email, chat_summary) 
                             VALUES ($1, $2, $3)
                             ON CONFLICT DO NOTHING`,
                            [conversationId, leadData.numero_telephone, qualificationResult.conversationSummary]
                        );
                    }
                } catch (crmError) {
                    console.error('⚠️ CRM/DB Update Failed (Non-fatal, continuing chat):', crmError);
                    // Do not bubble up - we still want to reply to the user
                }
            }
        }

            // 9. Legacy: Check for email and notify via Slack
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const emailMatch = userMessage.match(emailRegex);

        if (emailMatch && process.env.SLACK_WEBHOOK_URL) {
            const email = emailMatch[0];
            console.log(`📧 Email detected: ${email}`);

            try {
                await fetch(process.env.SLACK_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: `🚨 **NOUVEAU LEAD** 🚨\n\n📧 Email: ${email}\n📊 Score: ${qualificationResult.score}/100\n🆔 Session: ${sessionId}`
                    })
                });
            } catch (error) {
                console.error('❌ Failed to send Slack notification:', error);
            }
        }

        // 10. Determine suggested actions dynamically
        let suggestedActions: { type: string, label: string }[] = [];

        if (qualificationResult.isComplete && qualificationResult.score >= 50) {
            // Highly qualified lead -> Push for conversion
            suggestedActions = [
                { type: 'schedule_visit', label: '📅 Planifier une visite' },
                { type: 'request_estimate', label: '📋 Estimation gratuite' }
            ];
        } else if (needsLookup && sourcePages.length > 0) {
            // User asked about properties -> Push for callback or more views
            suggestedActions = [
                { type: 'view_properties', label: '🏠 Voir les biens' },
                { type: 'request_callback', label: '📞 Être rappelé' }
            ];
        } else {
            // General conversation
            suggestedActions = [
                { type: 'contact_agent', label: '💬 Contacter un agent' },
                { type: 'view_properties', label: '🏠 Voir nos annonces' }
            ];
        }

        return {
            response: aiResponseText,
            sessionId: sessionId,
            usedKnowledge: needsLookup && sourcePages.length > 0,
            sourcePages: sourcePages.length > 0 ? sourcePages : undefined,
            suggestedActions: suggestedActions as any, // Cast to match frontend type
            qualification: {
                score: qualificationResult.score,
                missingFields: qualificationResult.missingFields,
                isComplete: qualificationResult.isComplete,
                pushedToCRM: pushedToCRM,
            }
        };

    } finally {
        client.release();
    }
    }
}
