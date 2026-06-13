import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
    path: path.join(__dirname, '../../.env'),
    override: process.env.NODE_ENV !== 'production',
});

export type OpenRouterChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};

export type ResponseMode = 'short' | 'normal';

export interface CallWithFallbackOptions {
    response_mode?: ResponseMode;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    timeout_ms?: number;
    max_history_messages?: number;
    max_total_chars?: number;
    models?: string[];
}

export interface CallWithFallbackResult {
    content: string;
    model: string;
    usage?: unknown;
}

class OpenRouterError extends Error {
    status?: number;
    code?: string;
    model?: string;
    body?: unknown;
    attempts?: Array<{ model: string; try: number; status?: number; code?: string; message: string }>;

    constructor(
        message: string,
        info?: {
            status?: number;
            code?: string;
            model?: string;
            body?: unknown;
            attempts?: Array<{ model: string; try: number; status?: number; code?: string; message: string }>;
        }
    ) {
        super(message);
        this.name = 'OpenRouterError';
        this.status = info?.status;
        this.code = info?.code;
        this.model = info?.model;
        this.body = info?.body;
        this.attempts = info?.attempts;
    }
}

const DEFAULT_FALLBACK_MODELS: string[] = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'qwen/qwen3-coder:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'tngtech/tng-r1t-chimera:free',
    'tngtech/deepseek-r1t2-chimera:free',
    'deepseek/deepseek-r1-0528:free',
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getBaseUrl = (): string => {
    return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
};

const getApiKey = (): string | undefined => {
    const key = process.env.OPENROUTER_API_KEY;
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
};

const getDefaultMaxTokens = (mode: ResponseMode): number => {
    const envKey = mode === 'short' ? process.env.OPENROUTER_MAX_TOKENS_SHORT : process.env.OPENROUTER_MAX_TOKENS_NORMAL;
    const parsed = envKey ? parseInt(envKey, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return mode === 'short' ? 300 : 600;
};

const isTransientStatus = (status?: number): boolean => {
    return status === 502 || status === 503 || status === 504;
};

const isFallbackableStatus = (status?: number): boolean => {
    if (!status) return false;
    return [404, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
};

const looksLikeRateLimitMessage = (msg: string): boolean => {
    const m = msg.toLowerCase();
    return (
        m.includes('rate limit') ||
        m.includes('rate_limit') ||
        m.includes('rate_limit_exceeded') ||
        m.includes('too many requests') ||
        m.includes('quota') ||
        m.includes('tokens per day') ||
        m.includes('token/day') ||
        m.includes('daily')
    );
};

const isRateLimitLike = (status: number | undefined, code: string | undefined, message: string | undefined): boolean => {
    if (status === 429) return true;
    if (code && looksLikeRateLimitMessage(code)) return true;
    if (message && looksLikeRateLimitMessage(message)) return true;
    return false;
};

const looksLikeProviderAvailabilityMessage = (msg: string): boolean => {
    const m = msg.toLowerCase();
    return (
        m.includes('provider returned error') ||
        m.includes('provider error') ||
        m.includes('no available provider') ||
        m.includes('no available') ||
        m.includes('overloaded') ||
        m.includes('temporarily')
    );
};

const shouldFallback = (status: number | undefined, code: string | undefined, message: string): boolean => {
    if (isRateLimitLike(status, code, message)) return true;
    if (isFallbackableStatus(status)) return true;
    if (looksLikeProviderAvailabilityMessage(message)) return true;
    if (code && looksLikeProviderAvailabilityMessage(code)) return true;
    return false;
};

const extractErrorInfo = (body: any): { code?: string; message?: string } => {
    if (!body) return {};
    if (typeof body?.error?.code === 'string' || typeof body?.error?.message === 'string') {
        return {
            code: typeof body.error.code === 'string' ? body.error.code : undefined,
            message: typeof body.error.message === 'string' ? body.error.message : undefined,
        };
    }
    if (typeof body?.message === 'string') {
        return { message: body.message };
    }
    return {};
};

const parsePositiveInt = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const truncateForBudget = (text: string, maxChars: number): string => {
    if (maxChars <= 0) return '';
    if (text.length <= maxChars) return text;

    const head = Math.min(4000, Math.max(0, Math.floor(maxChars * 0.25)));
    const tail = Math.max(0, maxChars - head);
    if (tail <= 0) return text.slice(-maxChars);
    return text.slice(0, head) + text.slice(text.length - tail);
};

const trimMessages = (messages: OpenRouterChatMessage[], maxHistoryMessages: number, maxTotalChars: number): OpenRouterChatMessage[] => {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    let trimmed = nonSystem.slice(-maxHistoryMessages);

    const totalChars = (arr: OpenRouterChatMessage[]) => arr.reduce((acc, m) => acc + m.content.length, 0);

    let combined = [...systemMessages, ...trimmed];
    while (totalChars(combined) > maxTotalChars && trimmed.length > 1) {
        trimmed = trimmed.slice(1);
        combined = [...systemMessages, ...trimmed];
    }

    if (totalChars(combined) > maxTotalChars) {
        const nonSystemChars = totalChars(trimmed);
        const systemBudget = maxTotalChars - nonSystemChars;

        if (systemBudget <= 0) {
            const last = trimmed[trimmed.length - 1];
            return [
                {
                    ...last,
                    content: truncateForBudget(last.content, maxTotalChars),
                },
            ];
        }

        const newSystemMessages: OpenRouterChatMessage[] = [];
        let remaining = systemBudget;
        for (const m of systemMessages) {
            if (remaining <= 0) break;
            const sliceLen = Math.min(remaining, m.content.length);
            newSystemMessages.push({ ...m, content: truncateForBudget(m.content, sliceLen) });
            remaining -= sliceLen;
        }

        combined = [...newSystemMessages, ...trimmed];
    }

    return combined;
};

const fetchJson = async (
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<{ status: number; ok: boolean; json: any }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const json = await response.json().catch(() => null);
        return { status: response.status, ok: response.ok, json };
    } finally {
        clearTimeout(timeout);
    }
};

const callModelOnce = async (
    model: string,
    messages: OpenRouterChatMessage[],
    options: Required<Pick<CallWithFallbackOptions, 'timeout_ms'>> & Omit<CallWithFallbackOptions, 'timeout_ms'>
): Promise<CallWithFallbackResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new OpenRouterError('OPENROUTER_API_KEY is not set', { code: 'MISSING_API_KEY' });
    }

    const baseUrl = getBaseUrl();
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const responseMode: ResponseMode = options.response_mode ?? 'normal';

    const maxTokens = typeof options.max_tokens === 'number' && options.max_tokens > 0
        ? options.max_tokens
        : getDefaultMaxTokens(responseMode);

    const body = {
        model,
        messages,
        temperature: options.temperature ?? 0.5,
        top_p: options.top_p ?? 1,
        max_tokens: maxTokens,
        stream: false,
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    const appUrl = typeof process.env.OPENROUTER_APP_URL === 'string' ? process.env.OPENROUTER_APP_URL.trim() : '';
    const appName = typeof process.env.OPENROUTER_APP_NAME === 'string' ? process.env.OPENROUTER_APP_NAME.trim() : '';

    if (appUrl) headers['HTTP-Referer'] = appUrl;
    if (appName) headers['X-Title'] = appName;

    const { status, ok, json } = await fetchJson(
        url,
        {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        },
        options.timeout_ms
    );

    if (!ok) {
        const { code, message } = extractErrorInfo(json);
        throw new OpenRouterError(message || `OpenRouter HTTP ${status}`, {
            status,
            code,
            model,
            body: json,
        });
    }

    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new OpenRouterError('OpenRouter response missing choices[0].message.content', {
            status,
            code: 'EMPTY_COMPLETION',
            model,
            body: json,
        });
    }

    return {
        content,
        model,
        usage: json?.usage,
    };
};

export async function callWithFallback(
    messages: OpenRouterChatMessage[],
    options: CallWithFallbackOptions = {}
): Promise<CallWithFallbackResult> {
    const models = Array.isArray(options.models) && options.models.length > 0 ? options.models : DEFAULT_FALLBACK_MODELS;
    const responseMode: ResponseMode = options.response_mode ?? 'normal';

    const envMaxHistory = parsePositiveInt(process.env.OPENROUTER_HISTORY_MAX_MESSAGES);
    const maxHistory = typeof options.max_history_messages === 'number' && options.max_history_messages > 0
        ? Math.min(50, options.max_history_messages)
        : (envMaxHistory ? Math.min(50, envMaxHistory) : 10);

    const maxTotalChars = typeof options.max_total_chars === 'number' && options.max_total_chars > 0
        ? options.max_total_chars
        : 20000;

    const timeoutMs = typeof options.timeout_ms === 'number' && options.timeout_ms > 0 ? options.timeout_ms : 30000;

    const trimmedMessages = trimMessages(messages, maxHistory, maxTotalChars);

    const attempts: Array<{ model: string; try: number; status?: number; code?: string; message: string }> = [];

    let rateLimitFailures = 0;

    for (const model of models) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[OpenRouter] model=${model} try=${attempt} mode=${responseMode}`);
                } else {
                    console.log(`[OpenRouter] model=${model} try=${attempt}`);
                }

                const result = await callModelOnce(model, trimmedMessages, {
                    ...options,
                    response_mode: responseMode,
                    timeout_ms: timeoutMs,
                });

                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[OpenRouter] success model=${result.model}`);
                } else {
                    console.log('[OpenRouter] success');
                }

                return result;
            } catch (err) {
                const status = (err as any)?.status as number | undefined;
                const code = (err as any)?.code as string | undefined;
                const message = err instanceof Error ? err.message : String(err);

                attempts.push({ model, try: attempt, status, code, message });

                const isAbort = err instanceof Error && err.name === 'AbortError';
                const isTransient = isAbort || isTransientStatus(status) || (err instanceof TypeError && message.toLowerCase().includes('fetch'));
                const isRateLimit = isRateLimitLike(status, code, message);

                if (isRateLimit) {
                    rateLimitFailures += 1;
                    console.warn('[OpenRouter] rate limit/quota -> fallback', { model, status, code });
                    break;
                }

                if (isTransient) {
                    if (attempt === 1) {
                        console.warn('[OpenRouter] transient error -> retry once', { model, status, code, error: message });
                        await sleep(300 + Math.floor(Math.random() * 400));
                        continue;
                    }

                    console.warn('[OpenRouter] transient error after retry -> fallback', { model, status, code });
                    break;
                }

                if (shouldFallback(status, code, message)) {
                    console.warn('[OpenRouter] provider/model error -> fallback', { model, status, code });
                    break;
                }

                throw new OpenRouterError('OpenRouter call failed (non-retryable)', {
                    status,
                    code,
                    model,
                    body: err,
                    attempts,
                });
            }
        }
    }

    const allWereRateLimit = rateLimitFailures === models.length;

    throw new OpenRouterError('All OpenRouter models failed', {
        status: allWereRateLimit ? 429 : 503,
        code: allWereRateLimit ? 'RATE_LIMIT' : 'UPSTREAM_UNAVAILABLE',
        attempts,
    });
}
