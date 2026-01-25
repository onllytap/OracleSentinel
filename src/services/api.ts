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

// ============================================
// CONFIGURATION
// ============================================

// @ts-ignore - Vite provides import.meta.env
const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3001';
const API_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // 1 second

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
                    await sleep(RETRY_DELAY * attempt);
                }

                const controller = createTimeoutController(API_TIMEOUT);

                const response = await fetch(`${API_BASE_URL}/api/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: request.message,
                        session_id: request.sessionId,
                        context: request.context
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

                // Don't retry on abort (timeout)
                if (error instanceof Error && error.name === 'AbortError') {
                    console.error('[API] Request timed out');
                    break;
                }

                console.error(`[API] Attempt ${attempt + 1} failed:`, error);
            }
        }

        // All retries failed
        console.error('[API] All retries exhausted:', lastError);
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
    }
};
