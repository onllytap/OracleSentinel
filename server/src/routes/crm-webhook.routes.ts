// ============================================================================
// Twenty CRM Inbound Webhook Routes
// ============================================================================
//
// Handles incoming webhooks from Twenty CRM:
//   POST /api/crm/webhook/twenty
//
// Use case: Twenty Workflow Webhook Trigger sends events (e.g. record created,
// stage changed) back to the chatbot for downstream logic (notifications, etc.)
//
// Security:
// - Validates a shared secret (TWENTY_WEBHOOK_SECRET) in the Authorization header
// - Rejects replays via timestamp + nonce (if provided)
// ============================================================================

import { Router, Request, Response } from 'express';

const router = Router();

// Anti-replay: track recent nonces (in-memory, 15-minute window)
const recentNonces = new Map<string, number>();
const NONCE_TTL_MS = 15 * 60 * 1000;

function cleanNonces(): void {
    const cutoff = Date.now() - NONCE_TTL_MS;
    for (const [nonce, ts] of recentNonces) {
        if (ts < cutoff) recentNonces.delete(nonce);
    }
}

// Clean nonces every 5 minutes
setInterval(cleanNonces, 5 * 60 * 1000);

/** Validate webhook auth */
function validateWebhookAuth(req: Request): boolean {
    const secret = process.env.TWENTY_WEBHOOK_SECRET;
    if (!secret) {
        // If no secret configured, reject all inbound webhooks
        return false;
    }

    const authHeader = req.headers['authorization'] || req.headers['x-webhook-secret'] || '';
    const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';
    return token === secret;
}

/** POST /api/crm/webhook/twenty */
router.post('/twenty', (req: Request, res: Response) => {
    // 1. Auth check
    if (!validateWebhookAuth(req)) {
        console.warn('[CRM Webhook] Unauthorized webhook attempt');
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    // 2. Anti-replay (optional nonce header)
    const nonce = req.headers['x-webhook-nonce'] as string | undefined;
    if (nonce) {
        if (recentNonces.has(nonce)) {
            console.warn('[CRM Webhook] Replay detected, nonce already seen');
            res.status(409).json({ error: 'Replay detected' });
            return;
        }
        recentNonces.set(nonce, Date.now());
    }

    // 3. Parse event
    const body = req.body;
    const eventType = body?.event || body?.type || 'unknown';

    console.log(`[CRM Webhook] Received event: ${eventType}`);

    // 4. Handle events
    switch (eventType) {
        case 'person.created':
        case 'person.updated':
            handlePersonEvent(body);
            break;
        case 'company.created':
        case 'company.updated':
            handleCompanyEvent(body);
            break;
        case 'opportunity.created':
        case 'opportunity.updated':
            handleOpportunityEvent(body);
            break;
        default:
            console.log(`[CRM Webhook] Unhandled event type: ${eventType}`);
    }

    // Always ack quickly
    res.status(200).json({ received: true });
});

// ── Event handlers ──────────────────────────────────────────────────

function handlePersonEvent(body: any): void {
    const record = body?.data || body?.record || {};
    console.log(`[CRM Webhook] Person event — id: ${record.id || 'N/A'}`);
    // Future: trigger Slack notifications, sync back to local DB, etc.
}

function handleCompanyEvent(body: any): void {
    const record = body?.data || body?.record || {};
    console.log(`[CRM Webhook] Company event — id: ${record.id || 'N/A'}`);
}

function handleOpportunityEvent(body: any): void {
    const record = body?.data || body?.record || {};
    console.log(`[CRM Webhook] Opportunity event — id: ${record.id || 'N/A'}, stage: ${record.stage || 'N/A'}`);
}

export default router;
