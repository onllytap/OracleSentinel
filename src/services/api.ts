// ============================================
// API Service - Optimized for Performance & Security
// ============================================

// Types for API communication
export interface SourcePage {
    title: string;
    url: string;
}

export interface BackendResponse {
    response: string;
    sessionId: string;
    usedKnowledge?: boolean;
    sourcePages?: SourcePage[];
    suggestedActions?: Array<{
        type: 'schedule_visit' | 'request_callback' | 'request_estimate' | 'view_properties' | 'contact_agent' | 'get_directions';
        label: string;
        data?: Record<string, unknown>;
    }>;
}

export interface ChatResponse {
    messages: Array<{
        type: 'text';
        content: string;
    }>;
    sourcePages?: SourcePage[];
    usedKnowledge?: boolean;
}

export interface ChatRequest {
    message: string;
    sessionId: string;
    context?: Record<string, unknown>;
}

export interface ConversationSummary {
    sessionId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    lastMessageAt?: string;
    lastMessagePreview?: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
}

export interface LeadFormPayload {
    prenom: string;
    nom: string;
    telephone: string;
    email?: string;
    projet: 'Achat' | 'Vente' | 'Location' | 'Autre';
    details?: string;
}

export interface EstimatePayload {
    typeLocal: 'Maison' | 'Appartement';
    surface?: string | number;
    pieces?: string | number;
    address?: string;
    codePostal?: string;
    prenom?: string;
    nom?: string;
    telephone?: string;
    email?: string;
}

export interface EstimateApiResult {
    ok: boolean;
    error?: string;
    estimate?: {
        available: boolean;
        surface?: number;
        pricePerM2Median?: number;
        lowPrice?: number;
        midPrice?: number;
        highPrice?: number;
        confidence?: 'low' | 'medium' | 'high';
        disclaimer: string;
        reason?: string;
    };
    dpe?: { available: boolean; etiquette?: string; message: string };
    location?: { codeCommune?: string; codePostal?: string; label?: string };
}

// ============================================
// CONFIGURATION
// ============================================

// @ts-ignore - Vite provides import.meta.env
const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3001';
// @ts-ignore - Vite provides import.meta.env
const WIDGET_ID = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WIDGET_ID) || 'default';
const API_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // 1 second

let cachedWidgetToken: { token: string; expiresAt: number } | null = null;

const createApiError = (response: Response, body: any): Error => {
    const message = body?.error || `HTTP ${response.status}: ${response.statusText}`;
    const err = new Error(message) as any;
    err.status = response.status;
    if (body?.code) err.code = body.code;
    return err;
};

const getWidgetToken = async (): Promise<string> => {
    const now = Date.now();
    if (cachedWidgetToken && cachedWidgetToken.expiresAt > now) {
        return cachedWidgetToken.token;
    }

    const controller = createTimeoutController(10000);
    const response = await fetch(`${API_BASE_URL}/api/widget-auth?widget_id=${encodeURIComponent(WIDGET_ID)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null) as any;
        throw createApiError(response, body);
    }

    const data = await response.json() as { token?: string };
    if (!data.token) {
        throw new Error('Missing widget token');
    }

    cachedWidgetToken = { token: data.token, expiresAt: now + 10 * 60 * 1000 };
    return data.token;
};

// ============================================
// UTILITIES
// ============================================

/**
 * Sleep utility for retry delays
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create AbortController with timeout
 */
const createTimeoutController = (timeout: number): AbortController => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    return controller;
};

// ============================================
// API METHODS
// ============================================

export const api = {
    /**
     * Check if backend is available
     */
    healthCheck: async (): Promise<boolean> => {
        try {
            const controller = createTimeoutController(5000);
            const response = await fetch(`${API_BASE_URL}/health`, {
                signal: controller.signal
            });
            return response.ok;
        } catch {
            return false;
        }
    },

    /**
     * Send message with retry logic and proper error handling
     */
    sendMessageStream: async (
        request: ChatRequest,
        onChunk: (chunk: string) => void,
        onMetadata?: (metadata: {
            sourcePages?: SourcePage[];
            usedKnowledge?: boolean;
            suggestedActions?: BackendResponse['suggestedActions'];
        }) => void
    ): Promise<void> => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[API] Retry attempt ${attempt}/${MAX_RETRIES}`);
                    await sleep(RETRY_DELAY * attempt + Math.random() * 250);
                }

                const controller = createTimeoutController(API_TIMEOUT);

                const token = await getWidgetToken();

                const response = await fetch(`${API_BASE_URL}/api/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        message: request.message,
                        session_id: request.sessionId,
                        context: request.context
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const body = await response.json().catch(() => null) as any;
                    throw createApiError(response, body);
                }

                if (!response.body) {
                    throw new Error('Response body is null');
                }

                const data: BackendResponse = await response.json();

                // Send response text
                if (data?.response) {
                    onChunk(data.response);
                } else {
                    onChunk('Je suis désolé, une erreur est survenue. Veuillez réessayer.');
                }

                // Send metadata
                if (onMetadata && data) {
                    onMetadata({
                        sourcePages: data.sourcePages,
                        usedKnowledge: data.usedKnowledge,
                        suggestedActions: data.suggestedActions
                    });
                }

                return; // Success - exit retry loop

            } catch (error) {
                lastError = error as Error;

                const status = (error as any)?.status;

                // Don't retry on abort (timeout)
                if (error instanceof Error && error.name === 'AbortError') {
                    console.error('[API] Request timed out');
                    break;
                }

                if (status === 401 || status === 403) {
                    cachedWidgetToken = null;
                    console.error('[API] Authentication error, clearing cached token');
                    continue;
                }

                if (status === 429) {
                    console.error('[API] Rate limited (429), not retrying');
                    break;
                }

                if (typeof status === 'number' && status >= 400 && status < 500) {
                    console.error(`[API] Non-retryable client error (${status}), not retrying`);
                    break;
                }

                console.error(`[API] Attempt ${attempt + 1} failed:`, error);
            }
        }

        // All retries failed
        console.error('[API] All retries exhausted:', lastError);

        const finalStatus = (lastError as any)?.status;
        if (finalStatus === 429) {
            onChunk('Le service est temporairement indisponible (limite atteinte). Veuillez réessayer plus tard.');
            return;
        }

        onChunk('Le service est temporairement indisponible. Veuillez réessayer dans quelques instants.');
    },

    /**
     * Legacy method for compatibility
     */
    sendMessage: async (request: ChatRequest): Promise<ChatResponse> => {
        let fullText = '';
        let metadata: { sourcePages?: SourcePage[]; usedKnowledge?: boolean } = {};

        await api.sendMessageStream(
            request,
            (chunk) => { fullText += chunk; },
            (meta) => { metadata = meta; }
        );

        return {
            messages: [{ type: 'text', content: fullText }],
            sourcePages: metadata.sourcePages,
            usedKnowledge: metadata.usedKnowledge
        };
    },

    listConversations: async (params?: { limit?: number; offset?: number }): Promise<ConversationSummary[]> => {
        const controller = createTimeoutController(API_TIMEOUT);
        const qs = new URLSearchParams();
        if (params?.limit != null) qs.set('limit', String(params.limit));
        if (params?.offset != null) qs.set('offset', String(params.offset));

        const token = await getWidgetToken();

        const response = await fetch(`${API_BASE_URL}/api/conversations?${qs.toString()}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as { conversations?: ConversationSummary[] };
        return data.conversations || [];
    },

    getConversationMessages: async (sessionId: string, params?: { limit?: number }): Promise<ConversationMessage[]> => {
        const controller = createTimeoutController(API_TIMEOUT);
        const qs = new URLSearchParams();
        if (params?.limit != null) qs.set('limit', String(params.limit));

        const token = await getWidgetToken();

        const response = await fetch(
            `${API_BASE_URL}/api/conversations/${encodeURIComponent(sessionId)}/messages?${qs.toString()}`,
            {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                signal: controller.signal,
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as { messages?: ConversationMessage[] };
        return data.messages || [];
    },

    submitLeadForm: async (sessionId: string, payload: LeadFormPayload): Promise<{ success: boolean; pushedToCRM: boolean }> => {
        const controller = createTimeoutController(API_TIMEOUT);

        const token = await getWidgetToken();

        const response = await fetch(`${API_BASE_URL}/api/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
            body: JSON.stringify({
                session_id: sessionId,
                ...payload,
            }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null) as any;
            throw createApiError(response, body);
        }

        const data = await response.json() as { success?: boolean; pushedToCRM?: boolean };
        return { success: !!data.success, pushedToCRM: !!data.pushedToCRM };
    },

    /**
     * Estimation "machine à mandats" : appelle le moteur réel (DVF + DPE) et
     * capture le vendeur côté serveur. Public (rate-limité côté backend).
     * widgetId identifie l'agence (attribution du mandat).
     */
    estimate: async (payload: EstimatePayload): Promise<EstimateApiResult> => {
        const controller = createTimeoutController(API_TIMEOUT);
        const response = await fetch(`${API_BASE_URL}/api/estimate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ ...payload, widgetId: WIDGET_ID }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null) as any;
            throw createApiError(response, body);
        }

        return await response.json() as EstimateApiResult;
    },
};
