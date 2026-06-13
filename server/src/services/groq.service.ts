import Groq from 'groq-sdk';

export type GroqChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type GroqResponseMode = 'short' | 'normal';

export interface GroqCallOptions {
  response_mode?: GroqResponseMode;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  request_id?: string;
}

export interface GroqCallResult {
  content: string;
  model: string;
  usage?: unknown;
}

type KeyState = {
  key: string;
  cooldownUntilMs: number;
};

const looksLikeRateLimit = (err: unknown): boolean => {
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.response?.status;
  const message = typeof anyErr?.message === 'string' ? anyErr.message : String(err);
  const m = message.toLowerCase();

  if (status === 429) return true;
  if (m.includes('rate limit')) return true;
  if (m.includes('too many requests')) return true;
  if (m.includes('quota')) return true;
  if (m.includes('429')) return true;
  return false;
};

const getDefaultMaxTokens = (mode: GroqResponseMode): number => {
  const envKey = mode === 'short' ? process.env.GROQ_MAX_TOKENS_SHORT : process.env.GROQ_MAX_TOKENS_NORMAL;
  const parsed = envKey ? parseInt(envKey, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return mode === 'short' ? 300 : 700;
};

const getGroqModel = (): string => {
  const model = process.env.GROQ_MODEL;
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : 'llama-3.3-70b-versatile';
};

const loadKeys = (): KeyState[] => {
  const keys: string[] = [];

  const legacy = process.env.GROQ_API_KEY;
  if (typeof legacy === 'string' && legacy.trim()) keys.push(legacy.trim());

  for (let i = 1; i <= 5; i++) {
    const v = (process.env as any)[`GROQ_API_KEY_${i}`];
    if (typeof v === 'string' && v.trim()) keys.push(v.trim());
  }

  // De-dupe while keeping order
  const unique = Array.from(new Set(keys));
  return unique.map((k) => ({ key: k, cooldownUntilMs: 0 }));
};

export class GroqService {
  private static keyStates: KeyState[] = loadKeys();
  private static rrIndex = 0;

  static isConfigured(): boolean {
    if (!this.keyStates || this.keyStates.length === 0) {
      this.keyStates = loadKeys();
    }
    return this.keyStates.length > 0;
  }

  private static pickNextKeyIndex(nowMs: number): number | undefined {
    if (!this.keyStates || this.keyStates.length === 0) this.keyStates = loadKeys();
    if (this.keyStates.length === 0) return undefined;

    const n = this.keyStates.length;
    for (let step = 0; step < n; step++) {
      const idx = (this.rrIndex + step) % n;
      if (this.keyStates[idx].cooldownUntilMs <= nowMs) {
        this.rrIndex = (idx + 1) % n;
        return idx;
      }
    }

    // All keys on cooldown -> take next in round-robin anyway
    const idx = this.rrIndex % n;
    this.rrIndex = (idx + 1) % n;
    return idx;
  }

  static async chatCompletion(messages: GroqChatMessage[], options: GroqCallOptions = {}): Promise<GroqCallResult> {
    if (!this.isConfigured()) {
      const err = new Error('LLM not configured');
      (err as any).code = 'MISSING_API_KEY';
      (err as any).status = 503;
      throw err;
    }

    const model = getGroqModel();
    const responseMode: GroqResponseMode = options.response_mode ?? 'normal';

    const maxTokens = typeof options.max_tokens === 'number' && options.max_tokens > 0
      ? options.max_tokens
      : getDefaultMaxTokens(responseMode);

    const nowMs = Date.now();
    const maxAttempts = Math.max(1, this.keyStates.length);

    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const idx = this.pickNextKeyIndex(Date.now());
      if (typeof idx !== 'number') break;

      const keyState = this.keyStates[idx];
      const groq = new Groq({ apiKey: keyState.key });

      try {
        const startMs = Date.now();
        if (process.env.CHAT_DEBUG) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: 'groq.call.start',
            requestId: options.request_id,
            model,
            attempt,
            keyIndex: idx + 1,
            keyCount: this.keyStates.length,
            maxTokens,
          }));
        } else if (process.env.NODE_ENV !== 'production') {
          console.log(`[Groq] key=${idx + 1}/${this.keyStates.length} model=${model} attempt=${attempt}`);
        } else {
          console.log('[Groq] call');
        }

        const completion = await groq.chat.completions.create({
          messages,
          model,
          temperature: options.temperature ?? 0.5,
          top_p: options.top_p ?? 1,
          max_tokens: maxTokens,
        });

        const content = completion?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('Groq response missing choices[0].message.content');
        }

        const ms = Date.now() - startMs;
        if (process.env.CHAT_DEBUG) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: 'groq.call.success',
            requestId: options.request_id,
            model,
            attempt,
            keyIndex: idx + 1,
            ms,
          }));
        }

        return {
          content,
          model,
          usage: completion?.usage,
        };
      } catch (err) {
        lastErr = err;

        if (process.env.CHAT_DEBUG) {
          const anyErr = err as any;
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: 'groq.call.error',
            requestId: options.request_id,
            model,
            attempt,
            keyIndex: idx + 1,
            status: anyErr?.status ?? anyErr?.response?.status,
            message: anyErr?.message ? String(anyErr.message).slice(0, 200) : String(err).slice(0, 200),
          }));
        }

        if (looksLikeRateLimit(err)) {
          // Cooldown this key briefly and rotate
          const cooldownMsRaw = process.env.GROQ_KEY_COOLDOWN_MS;
          const cooldownMsParsed = cooldownMsRaw ? parseInt(cooldownMsRaw, 10) : NaN;
          const cooldownMs = Number.isFinite(cooldownMsParsed) && cooldownMsParsed > 0 ? cooldownMsParsed : 15000;

          this.keyStates[idx].cooldownUntilMs = Math.max(this.keyStates[idx].cooldownUntilMs, Date.now() + cooldownMs);

          console.warn('[Groq] rate limit/quota -> rotate key', { keyIndex: idx + 1 });
          if (process.env.CHAT_DEBUG) {
            console.log(JSON.stringify({
              ts: new Date().toISOString(),
              event: 'groq.key.cooldown',
              requestId: options.request_id,
              keyIndex: idx + 1,
              cooldownMs,
            }));
          }
          continue;
        }

        throw err;
      }
    }

    // If all attempts were rate-limited, throw last error
    throw lastErr instanceof Error ? lastErr : new Error('Groq call failed');
  }
}
