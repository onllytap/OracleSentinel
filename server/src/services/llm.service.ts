import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn('⚠️ GROQ_API_KEY is not set. LLM calls will fail.');
}

const groq = new Groq({
  apiKey: apiKey || 'dummy-key',
});

// Default to a model that exists on Groq and follows instructions well
const MODEL_NAME = process.env.GROQ_MODEL || 'llama3-70b-8192';

export class LLMService {
  static async generateResponse(
    messages: { role: 'user' | 'assistant'; content: string }[],
    systemPrompt: string
  ): Promise<string> {
    try {
      if (!apiKey) {
        console.warn('⚠️ Using Mock Response (No Groq API Key)');
        return "This is a mock AI response. Please provide GROQ_API_KEY in .env to get real responses.";
      }

      // Llama 3 on Groq expects system message in the array usually
      const conversationMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ];

      const completion = await groq.chat.completions.create({
        messages: conversationMessages as any[], // Casting to avoid strict type mismatch if SDK differs slightly
        model: MODEL_NAME,
        temperature: 0.5, // Professional & Focused
        max_tokens: 150, // Force conciseness
        top_p: 1,
        stream: false,
      });

      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Groq LLM Error:', error);
      throw error;
    }
  }

  static async generateSummary(chatHistory: string): Promise<string> {
    try {
      if (!apiKey) return 'Summary unavailable (No API Key)';

      // For summary, a simple one-shot prompt
      const summarySystemPrompt = `You are an expert sales analyst. Summarize the following chat transcript for a sales team.
      
      Focus strictly on:
      1. What the lead needs (Pain points)
      2. Tools they currently use
      3. Timeline (Urgency)
      
      Format: Concise bullet points. No intro or outro.`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: summarySystemPrompt },
          { role: 'user', content: chatHistory }
        ],
        model: MODEL_NAME,
        temperature: 0.3, // Lower temp for factual summary
        max_tokens: 250,
      });

      return completion.choices[0]?.message?.content || 'Could not generate summary.';
    } catch (error) {
      console.error('Groq LLM Summary Error:', error);
      return 'Error generating summary.';
    }
  }
}
