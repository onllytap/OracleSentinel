import { callWithFallback } from './openrouter.service';
import { GroqService, GroqResponseMode } from './groq.service';

export type ResponseMode = GroqResponseMode;

const getProvider = (): 'groq' | 'openrouter' => {
  const raw = (process.env.LLM_PROVIDER || 'groq').toLowerCase().trim();
  return raw === 'openrouter' ? 'openrouter' : 'groq';
};

export class LLMService {
  static async generateResponse(
    messages: { role: 'user' | 'assistant'; content: string }[],
    systemPrompt: string,
    options?: { maxTokens?: number; temperature?: number; topP?: number; response_mode?: ResponseMode; requestId?: string }
  ): Promise<string> {
    try {
      const conversationMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const provider = getProvider();
      if (provider === 'openrouter') {
        const completion = await callWithFallback(conversationMessages, {
          response_mode: options?.response_mode ?? 'normal',
          temperature: options?.temperature ?? 0.5,
          top_p: options?.topP ?? 1,
          max_tokens: options?.maxTokens,
        });
        return completion.content || '';
      }

      const result = await GroqService.chatCompletion(conversationMessages, {
        response_mode: options?.response_mode ?? 'normal',
        temperature: options?.temperature ?? 0.5,
        top_p: options?.topP ?? 1,
        max_tokens: options?.maxTokens,
        request_id: process.env.CHAT_DEBUG ? options?.requestId : undefined,
      });
      return result.content || '';
    } catch (error) {
      const provider = getProvider();
      console.error(provider === 'openrouter' ? 'OpenRouter LLM Error:' : 'Groq LLM Error:', error);
      throw error;
    }
  }

  static async generateSummary(chatHistory: string): Promise<string> {
    try {
      // For summary, a simple one-shot prompt
      const summarySystemPrompt = `You are an expert sales analyst. Summarize the following chat transcript for a sales team.
      
      Focus strictly on:
      1. What the lead needs (Pain points)
      2. Tools they currently use
      3. Timeline (Urgency)
      
      Format: Concise bullet points. No intro or outro.`;

      const provider = getProvider();
      if (provider === 'openrouter') {
        const completion = await callWithFallback(
          [
            { role: 'system', content: summarySystemPrompt },
            { role: 'user', content: chatHistory },
          ],
          {
            response_mode: 'short',
            temperature: 0.3,
            max_tokens: 250,
          }
        );
        return completion.content || 'Could not generate summary.';
      }

      const completion = await GroqService.chatCompletion(
        [
          { role: 'system', content: summarySystemPrompt },
          { role: 'user', content: chatHistory },
        ],
        {
          response_mode: 'short',
          temperature: 0.3,
          max_tokens: 250,
        }
      );

      return completion.content || 'Could not generate summary.';
    } catch (error) {
      const provider = getProvider();
      console.error(provider === 'openrouter' ? 'OpenRouter LLM Summary Error:' : 'Groq LLM Summary Error:', error);
      return 'Error generating summary.';
    }
  }
}
