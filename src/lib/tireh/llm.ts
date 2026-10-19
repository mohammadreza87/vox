/**
 * Minimal LLM abstraction so persona identity stays independent of the model
 * powering it (TIREH spec §7.6). Provider is chosen by env:
 *   TIREH_LLM_PROVIDER = anthropic (default) | gemini
 *   TIREH_LLM_MODEL    = model id override
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logTelegramDiagnostic } from './telegram/diagnostics';

function isUnavailableWebTool(error: unknown): boolean {
  // Provider content is used only for the existing fallback decision, never
  // exported. Hostile accessors must preserve the original thrown exception.
  try {
    return !!error && typeof error === 'object' && 'status' in error && error.status === 400
      && 'message' in error && /web_search|tool/i.test(String(error.message));
  } catch { return false; }
}

export interface LLMImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Validated, minimized current-turn bytes. Never a remote URL or retained history. */
  data: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: LLMImage[];
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Side-effecting callers must not deliver a provider-truncated completion. */
  requireComplete?: boolean;
  /** Server-only fence, rechecked before every provider request/retry. Never serialized. */
  authorize?: () => Promise<boolean>;
}

export class LLMAuthorizationError extends Error {
  constructor() { super('llm_authority_changed'); this.name = 'LLMAuthorizationError'; }
}
async function authorizeRequest(request: Pick<LLMRequest, 'authorize'>): Promise<void> {
  if (!request.authorize) return;
  try { if (await request.authorize() === true) return; } catch { /* Fail closed. */ }
  throw new LLMAuthorizationError();
}

export interface WebSource {
  url: string;
  title: string;
}

export interface LLM {
  complete(request: LLMRequest): Promise<string>;
  /**
   * Like `complete`, but the model may search the web for live information.
   * Optional: providers without web search simply don't implement it.
   */
  completeWithWeb?(request: LLMRequest & { maxSearches: number }): Promise<{ text: string; sources: WebSource[] }>;
  /** Text as it is generated, for live voice. Optional: callers fall back to `complete`. */
  stream?(request: LLMRequest): AsyncIterable<string>;
}

/** Streams when the provider can, else yields the whole reply at once. */
export async function* streamText(llm: LLM, request: LLMRequest): AsyncIterable<string> {
  if (llm.stream) yield* llm.stream(request);
  else yield await llm.complete(request);
}

/** Models require alternating turns starting with the user; merge and trim. */
export function normalizeTurns(messages: LLMMessage[]): LLMMessage[] {
  const merged: LLMMessage[] = [];
  for (const message of messages) {
    if (!message.content.trim() && !message.images?.length) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
      if (message.role === 'user' && message.images?.length) last.images = [...(last.images ?? []), ...message.images];
    } else {
      merged.push({ role: message.role, content: message.content,
        ...(message.role === 'user' && message.images?.length ? { images: [...message.images] } : {}) });
    }
  }
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
  return merged;
}

/** Provider wire formats contain only the explicit current user's attachments. */
export function anthropicTurns(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return normalizeTurns(messages).map(message => ({ role: message.role,
    content: message.images?.length ? [
      ...message.images.map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mimeType, data: image.data } })),
      { type: 'text' as const, text: message.content || 'Describe the shared image.' },
    ] : message.content,
  }));
}

export function geminiParts(message: LLMMessage) {
  return [{ text: message.content }, ...(message.role === 'user' ? message.images ?? [] : []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];
}

function supportsCustomSampling(model: string): boolean {
  // Claude 5 families and Opus 4.7+ reject non-default sampling parameters.
  // Match the family/version prefix so dated IDs and aliases follow the same
  // contract, while older Claude models keep the caller's temperature.
  const familyVersion = /^claude-(?:sonnet|haiku|opus|fable|mythos)-(\d+)(?:-|$)/.exec(model);
  if (familyVersion && Number(familyVersion[1]) >= 5) return false;
  return !/^claude-opus-4-(?:[7-9]|[1-9]\d)(?:-|$)/.test(model);
}

/** Server-side web search continues in a new request when a turn pauses. */
const MAX_WEB_CONTINUATIONS = 3;

/**
 * The answer is the text after the last search result: text before it is the
 * model narrating its search ("Let me look that up"), not the reply.
 */
export function webAnswer(content: Anthropic.ContentBlock[]): { text: string; sources: WebSource[] } {
  let start = 0;
  content.forEach((block, i) => { if (block.type === 'web_search_tool_result') start = i + 1; });
  const sources: WebSource[] = [];
  const text = content.slice(start).flatMap((block) => {
    if (block.type !== 'text') return [];
    for (const c of block.citations ?? []) {
      if (c.type === 'web_search_result_location' && !sources.some((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title ?? c.url });
    }
    return [block.text];
  }).join('').trim();
  return { text, sources };
}

export class AnthropicLLM implements LLM {
  private client: Anthropic | null = null;
  /** Set once the API refuses the web search tool for this model. */
  private webUnavailable = false;

  constructor(private readonly apiKey: string, private readonly model: string) {}

  private params({ system, maxTokens = 1024, temperature = 0.7 }: LLMRequest) {
    return {
      model: this.model,
      max_tokens: maxTokens,
      ...(supportsCustomSampling(this.model) ? { temperature } : {}),
      system,
    };
  }

  private async create(request: LLMRequest, body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    await authorizeRequest(request);
    // Hidden SDK retries cannot recheck current authority. Scoped requests use
    // no automatic retry; explicit web continuations pass through this fence.
    return request.authorize ? this.client.messages.create(body, { maxRetries: 0 }) : this.client.messages.create(body);
  }

  async complete(request: LLMRequest): Promise<string> {
    const response = await this.create(request, { ...this.params(request), messages: anthropicTurns(request.messages) });
    if (request.requireComplete && response.stop_reason === 'max_tokens') throw new Error('LLM completion truncated');
    return response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
  }

  async *stream(request: LLMRequest): AsyncIterable<string> {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    await authorizeRequest(request);
    const body = { ...this.params(request), messages: anthropicTurns(request.messages) };
    const stream = request.authorize ? this.client.messages.stream(body, { maxRetries: 0 }) : this.client.messages.stream(body);
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
    }
  }

  async completeWithWeb(request: LLMRequest & { maxSearches: number }): Promise<{ text: string; sources: WebSource[] }> {
    if (this.webUnavailable || request.maxSearches < 1) return { text: await this.complete(request), sources: [] };
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    const messages: Anthropic.MessageParam[] = anthropicTurns(request.messages);
    const tools: Anthropic.ToolUnion[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: request.maxSearches }];
    try {
      let response = await this.create(request, { ...this.params(request), messages, tools });
      for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_WEB_CONTINUATIONS; i++) {
        messages.push({ role: 'assistant', content: response.content });
        response = await this.create(request, { ...this.params(request), messages, tools });
      }
      return webAnswer(response.content);
    } catch (error) {
      // A model or account without web search answers from what it knows.
      if (isUnavailableWebTool(error)) {
        this.webUnavailable = true;
        logTelegramDiagnostic(console, 'web_search_unavailable');
        return { text: await this.complete(request), sources: [] };
      }
      throw error;
    }
  }
}

export class GeminiLLM implements LLM {
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async complete({ system, messages, maxTokens = 1024, temperature = 0.7, requireComplete, authorize }: LLMRequest): Promise<string> {
    const turns = normalizeTurns(messages);
    const last = turns.pop();
    if (!last) return '';
    this.client ??= new GoogleGenerativeAI(this.apiKey);
    const model = this.client.getGenerativeModel({ model: this.model, systemInstruction: system });
    const chat = model.startChat({
      history: turns.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: geminiParts(m) })),
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    });
    await authorizeRequest({ authorize });
    const result = await chat.sendMessage(last.images?.length ? geminiParts(last) : last.content);
    if (requireComplete && result.response.candidates?.some((candidate) => candidate.finishReason === 'MAX_TOKENS')) throw new Error('LLM completion truncated');
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
