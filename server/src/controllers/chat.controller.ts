import { Request, Response } from 'express';
import { ChatService } from '../services/chat.service';
import { validateChatMessage, validateLeadForm } from '../validators/schema';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('chat-controller');

export class ChatController {
    static async sendMessage(req: Request, res: Response) {
        try {
            const validation = validateChatMessage(req.body);

            if (!validation.success) {
                return res.status(400).json({ error: validation.error });
            }

            const { session_id, message } = validation.data;

            const tenantId = req.widgetAuth?.tenantId;
            const result = await ChatService.processMessage(session_id, message, tenantId);
            return res.json(result);
        } catch (error) {
            const status = (error as any)?.status;
            const code = (error as any)?.code;
            if (status === 429) {
                return res.status(429).json({
                    error: 'Trop de requêtes. Veuillez réessayer plus tard.',
                    code: 'RATE_LIMIT',
                });
            }
            if (code === 'MISSING_API_KEY') {
                return res.status(503).json({
                    error: 'LLM not configured',
                    code: 'LLM_NOT_CONFIGURED',
                });
            }
            if (status === 502 || status === 503 || status === 504) {
                return res.status(503).json({
                    error: 'Service temporairement indisponible. Veuillez réessayer plus tard.',
                    code: 'UPSTREAM_UNAVAILABLE',
                });
            }
            log.error({ err: error }, 'sendMessage failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async listConversations(req: Request, res: Response) {
        try {
            const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : undefined;
            const offsetRaw = typeof req.query.offset === 'string' ? req.query.offset : undefined;

            const limit = Math.max(1, Math.min(100, limitRaw ? parseInt(limitRaw, 10) : 20));
            const offset = Math.max(0, offsetRaw ? parseInt(offsetRaw, 10) : 0);

            const tenantId = req.widgetAuth?.tenantId || 'default';
            const conversations = await ChatService.listConversations(tenantId, limit, offset);
            return res.json({ conversations });
        } catch (error) {
            log.error({ err: error }, 'listConversations failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async getConversationMessages(req: Request, res: Response) {
        try {
            const sessionIdParam = req.params.sessionId;
            const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
            const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : undefined;
            const limit = Math.max(1, Math.min(500, limitRaw ? parseInt(limitRaw, 10) : 100));

            const tenantId = req.widgetAuth?.tenantId || 'default';
            const messages = await ChatService.getConversationMessages(sessionId, tenantId, limit);
            return res.json({ sessionId, messages });
        } catch (error) {
            log.error({ err: error }, 'getConversationMessages failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async submitLeadForm(req: Request, res: Response) {
        try {
            const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
            if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId) || sessionId.length > 100) {
                return res.status(400).json({ error: 'session_id invalide' });
            }

            const validation = validateLeadForm(req.body);
            if (!validation.success) {
                return res.status(400).json({ error: validation.error });
            }

            const tenantId = req.widgetAuth?.tenantId || 'default';
            const result = await ChatService.submitLeadForm(sessionId, validation.data, tenantId);
            if (!result.success && result.error === 'DUPLICATE_PHONE') {
                return res.status(409).json({
                    error: "Ce numéro de téléphone a déjà été utilisé récemment. Merci d'en saisir un autre.",
                    code: 'DUPLICATE_PHONE',
                });
            }
            return res.json({ success: true, pushedToCRM: result.pushedToCRM });
        } catch (error) {
            log.error({ err: error }, 'submitLeadForm failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
}
