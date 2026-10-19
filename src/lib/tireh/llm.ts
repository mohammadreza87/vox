/**
 * Minimal LLM abstraction so persona identity stays independent of the model
 * powering it (TIREH spec §7.6). Provider is chosen by env:
 *   TIREH_LLM_PROVIDER = anthropic (default) | gemini
 *   TIREH_LLM_MODEL    = model id override
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLM {
  complete(request: LLMRequest): Promise<string>;
}

/** Models require alternating turns starting with the user; merge and trim. */
export function normalizeTurns(messages: LLMMessage[]): LLMMessage[] {
  const merged: LLMMessage[] = [];
  for (const message of messages) {
    if (!message.content.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
  return merged;
}

export class AnthropicLLM implements LLM {
  private client: Anthropic | null = null;

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async complete({ system, messages, maxTokens = 1024, temperature = 0.7 }: LLMRequest): Promise<string> {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: normalizeTurns(messages),
    });
    return response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
  }
}

export class GeminiLLM implements LLM {
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async complete({ system, messages, maxTokens = 1024, temperature = 0.7 }: LLMRequest): Promise<string> {
    const turns = normalizeTurns(messages);
    const last = turns.pop();
    if (!last) return '';
    this.client ??= new GoogleGenerativeAI(this.apiKey);
    const model = this.client.getGenerativeModel({ model: this.model, systemInstruction: system });
    const chat = model.startChat({
      history: turns.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    });
    const result = await chat.sendMessage(last.content);
    return result.response.text().trim();
  }
}

export function createLLMFromEnv(env: NodeJS.ProcessEnv = process.env): LLM {
  const provider = env.TIREH_LLM_PROVIDER ?? 'anthropic';
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for TIREH_LLM_PROVIDER=gemini');
    return new GeminiLLM(env.GEMINI_API_KEY, env.TIREH_LLM_MODEL ?? 'gemini-2.0-flash-001');
  }
  if (provider !== 'anthropic') throw new Error(`Unknown TIREH_LLM_PROVIDER "${provider}"`);
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for TIREH personas');
  return new AnthropicLLM(env.ANTHROPIC_API_KEY, env.TIREH_LLM_MODEL ?? 'claude-sonnet-5-5');
}
