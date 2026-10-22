/**
 * Minimal LLM abstraction so persona identity stays independent of the model
 * powering it (TIREH spec §7.6). Provider is chosen by env:
 *   TIREH_LLM_PROVIDER = anthropic (default) | gemini
 *   TIREH_LLM_MODEL    = model id override
 */

import { measureStage, captureUsage, observedUsage, recordStage, unavailableUsage } from '../adaptive/observation/trace';
import { brandError, namedError } from '../error-contract';
import Anthropic from '@anthropic-ai/sdk';
import { AsyncLocalStorage } from 'node:async_hooks';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logTelegramDiagnostic } from './telegram/diagnostics';
import { systemText, type CacheControl, type LLMMessageExtras, type LLMResponseMeta, type LLMStopReason, type LLMSystem, type SystemBlock } from './llm-content';

export type { CacheControl, SystemBlock, LLMSystem, LLMResponseMeta, LLMStopReason } from './llm-content';

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

export interface LLMMessage extends LLMMessageExtras {
  role: 'user' | 'assistant';
  content: string;
  images?: LLMImage[];
}

/** How hard the model thinks before answering; thinking tokens count toward maxTokens. */
export type LLMEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LLMRequest {
  /** A string keeps cachedSystem() exactly as before; blocks are sent as given. */
  system: LLMSystem;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Anthropic models with effort control only; other providers and older models ignore it. */
  effort?: LLMEffort;
  /** Side-effecting callers must not deliver a provider-truncated completion. */
  requireComplete?: boolean;
  /** Server-only fence, rechecked before every provider request/retry. Never serialized. */
  authorize?: () => Promise<boolean>;
  /** Optional final synchronous committed-authority fence, never serialized. */
  authorizeNow?: () => boolean;
  signal?: AbortSignal;
  /** A/B arm TIREH_PROMPT_SYSTEM_TAIL: Anthropic sends a trailing {role:'system'} message via a narrow body type (like EffortBody); Gemini appends it to systemInstruction. */
  systemTail?: string;
  /** Content-free metadata; called once per provider response (complete, stream at end, completeWithWeb final). Never throws into delivery. */
  onMeta?: (meta: LLMResponseMeta) => void;
}

export class LLMAuthorizationError extends Error {
  constructor() { super('llm_authority_changed'); this.name = 'LLMAuthorizationError'; brandError(this, 'LLMAuthorizationError'); }
  static is(error: unknown): error is LLMAuthorizationError {
    try { return namedError(error, 'LLMAuthorizationError') && Object.getOwnPropertyDescriptor(error, 'message')?.value === 'llm_authority_changed'; }
    catch { return false; }
  }
}
async function authorizeRequest(request: Pick<LLMRequest, 'authorize'>): Promise<void> {
  if (!request.authorize) return;
  try { if (await request.authorize() === true) return; } catch { /* Fail closed. */ }
  throw new LLMAuthorizationError();
}
function authorizeImmediate(request: Pick<LLMRequest, 'authorizeNow' | 'signal'>): void {
  if (request.signal?.aborted) throw new LLMAuthorizationError();
  if (!request.authorizeNow) return;
  try { if (request.authorizeNow() === true) return; } catch { /* Fail closed. */ }
  throw new LLMAuthorizationError();
}

export interface WebSource {
  url: string;
  title: string;
}

export interface LLM {
  readonly identity?: { provider: string; model: string };
  /** Qualified final configured-transport fetch fence for private summary export. */
  readonly committedExportFence?: true;
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
    if (!message.content.trim() && !message.images?.length && !message.trailingText?.length) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
      if (message.role === 'user' && message.images?.length) last.images = [...(last.images ?? []), ...message.images];
      if (message.role === 'user' && message.trailingText?.length) last.trailingText = [...(last.trailingText ?? []), ...message.trailingText];
      if (message.cacheControl) last.cacheControl = { ...message.cacheControl };
    } else {
      // Extras appear only when set, so turns without them stay deep-equal to before.
      merged.push({ role: message.role, content: message.content,
        ...(message.role === 'user' && message.images?.length ? { images: [...message.images] } : {}),
        ...(message.role === 'user' && message.trailingText?.length ? { trailingText: [...message.trailingText] } : {}),
        ...(message.cacheControl ? { cacheControl: { ...message.cacheControl } } : {}) });
    }
  }
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();
  return merged;
}

/** Provider wire formats contain only the explicit current user's attachments. */
export function anthropicTurns(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return normalizeTurns(messages).map((message): Anthropic.MessageParam => {
    const imageBlocks = (message.images ?? []).map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mimeType, data: image.data } }));
    if (!message.trailingText?.length && !message.cacheControl) return { role: message.role,
      content: message.images?.length ? [...imageBlocks, { type: 'text' as const, text: message.content || 'Describe the shared image.' }] : message.content };
    // Image blocks always come first; trailing text blocks (the per-turn block)
    // follow the message text. Anthropic rejects empty text blocks, so none is sent.
    const texts = [message.content || (message.images?.length ? 'Describe the shared image.' : ''), ...(message.trailingText ?? [])]
      .filter((text) => text !== '')
      .map((text): Anthropic.TextBlockParam => ({ type: 'text', text }));
    const content: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [...imageBlocks, ...texts];
    if (message.cacheControl && content.length) content[content.length - 1] = { ...content[content.length - 1], cache_control: anthropicCache(message.cacheControl) };
    return { role: message.role, content };
  });
}

/** Anthropic cache marker; ttl is serialized only when set. */
export function anthropicCache(c: CacheControl): Anthropic.CacheControlEphemeral {
  return { type: 'ephemeral', ...(c.ttl ? { ttl: c.ttl } : {}) };
}

/** Array system: blocks in the given order, empty-text blocks dropped, cache_control kept. */
export function anthropicSystem(blocks: SystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.filter((b) => b.text !== '').map((b): Anthropic.TextBlockParam => ({ type: 'text', text: b.text, ...(b.cache_control ? { cache_control: anthropicCache(b.cache_control) } : {}) }));
}

/**
 * A mid-conversation `{role:'system'}` message (the TIREH_PROMPT_SYSTEM_TAIL
 * A/B arm). @anthropic-ai/sdk 0.71 types only user and assistant roles on
 * MessageParam but serializes the body as given, so the tail is added through
 * this narrow type, like EffortBody.
 */
type SystemTailParam = { role: 'system'; content: string };

/** Appends the system tail after the last turn; a missing or blank tail changes nothing. */
export function withSystemTail(turns: Anthropic.MessageParam[], tail?: string): Anthropic.MessageParam[] {
  if (!tail?.trim()) return turns;
  // The single narrowing cast for the system-tail turn.
  return [...turns, { role: 'system', content: tail } as SystemTailParam as unknown as Anthropic.MessageParam];
}

const STOP_REASONS: readonly LLMStopReason[] = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal'];
/** One of the six SDK stop reasons; null and anything else read as 'unknown'. */
export function stopReason(value: unknown): LLMStopReason {
  return STOP_REASONS.find((reason) => reason === value) ?? 'unknown';
}

/** Message text plus any trailing text, for providers without content blocks. */
export function geminiText(message: LLMMessage): string {
  return [message.content, ...(message.trailingText ?? [])].join('\n\n');
}

export function geminiParts(message: LLMMessage) {
  return [{ text: geminiText(message) }, ...(message.role === 'user' ? message.images ?? [] : []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];
}

function supportsCustomSampling(model: string): boolean {
  // Claude 5 families and Opus 4.7+ reject non-default sampling parameters.
  // Match the family/version prefix so dated IDs and aliases follow the same
  // contract, while older Claude models keep the caller's temperature.
  const familyVersion = /^claude-(?:sonnet|haiku|opus|fable|mythos)-(\d+)(?:-|$)/.exec(model);
  if (familyVersion && Number(familyVersion[1]) >= 5) return false;
  return !/^claude-opus-4-(?:[7-9]|[1-9]\d)(?:-|$)/.test(model);
}

/**
 * Effort (`output_config.effort`) is accepted by Claude 5 families, Opus 4.5+
 * and Sonnet 4.6+; Haiku 4.5 and Sonnet 4.5 reject it. Unknown or dated IDs
 * follow their family/version prefix.
 */
export function supportsEffort(model: string): boolean {
  const match = /^claude-(sonnet|haiku|opus|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (!match) return false;
  const [, family, major, minor = '0'] = match;
  if (Number(major) >= 5) return true;
  if (Number(major) !== 4) return false;
  return family === 'opus' ? Number(minor) >= 5 : family === 'sonnet' ? Number(minor) >= 6 : false;
}

/**
 * `output_config` is GA on the Messages API, but @anthropic-ai/sdk 0.71 only
 * types it on the beta params. The SDK serializes the body as given, so the
 * field is added through this narrow type instead of a cast to `any`.
 */
type EffortBody = { output_config?: { effort: LLMEffort } };

type TokenMeta = Pick<LLMResponseMeta, 'inputTokens' | 'outputTokens' | 'cacheReadInputTokens' | 'cacheCreationInputTokens'>;
/** Content-free token fields; a null, missing, malformed or throwing value is omitted, never guessed. */
function tokenMeta(read: Record<keyof TokenMeta, () => unknown>): TokenMeta {
  const out: TokenMeta = {};
  for (const key of Object.keys(read) as Array<keyof TokenMeta>) {
    let value: unknown;
    try { value = read[key](); } catch { value = undefined; }
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * The persona system prompt (conversation/prompt.ts) puts everything that is
 * identical for every turn of an agent first and closes it with this tag.
 * Anthropic requests send that prefix as its own cached block, so repeat
 * turns read it at a tenth of the input price; prompts without the tag
 * (persona design, extraction, triage) stay a plain string.
 */
export const SYSTEM_CACHE_BREAK = '</rules>';

export function cachedSystem(system: string): string | Anthropic.TextBlockParam[] {
  const end = system.indexOf(SYSTEM_CACHE_BREAK);
  if (end < 0) return system;
  const cut = end + SYSTEM_CACHE_BREAK.length;
  const rest = system.slice(cut);
  const prefix: Anthropic.TextBlockParam = { type: 'text', text: system.slice(0, cut), cache_control: { type: 'ephemeral' } };
  return rest.trim() ? [prefix, { type: 'text', text: rest }] : [prefix];
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

const transportAuthority = new AsyncLocalStorage<Pick<LLMRequest, 'authorizeNow' | 'signal'>>();

export class AnthropicLLM implements LLM {
  readonly committedExportFence = true as const;
  private client: Anthropic | null = null;
  /** Set once the API refuses the web search tool for this model. */
  private webUnavailable = false;

  constructor(private readonly apiKey: string, private readonly model: string, private readonly transportFetch?: typeof fetch) {}
  get identity() { return { provider: 'anthropic', model: this.model }; }

  private getClient(): Anthropic {
    return this.client ??= new Anthropic({ apiKey: this.apiKey, fetch: (input, init) => {
      // The SDK may await header/body preparation. Check the committed snapshot
      // inside its configured transport, in this request's async context, then
      // invoke fetch in the same call stack. No callback is shared across calls.
      authorizeImmediate(transportAuthority.getStore() ?? {});
      return (this.transportFetch ?? globalThis.fetch)(input, init);
    } });
  }

  private params({ system, maxTokens = 1024, temperature = 0.7, effort }: LLMRequest): Omit<Anthropic.MessageCreateParamsNonStreaming, 'messages'> & EffortBody {
    return {
      model: this.model,
      max_tokens: maxTokens,
      ...(supportsCustomSampling(this.model) ? { temperature } : {}),
      system: typeof system === 'string' ? cachedSystem(system) : anthropicSystem(system),
      ...(effort && supportsEffort(this.model) ? { output_config: { effort } } : {}),
    };
  }

  private async create(request: LLMRequest, body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    this.getClient();
    await authorizeRequest(request);
    // Hidden SDK retries cannot recheck current authority. Scoped requests use
    // no automatic retry; explicit web continuations pass through this fence.
    return measureStage('generation', async () => {
      let returned = false;
      try {
      authorizeImmediate(request);
      const response = await transportAuthority.run({ authorizeNow: request.authorizeNow, signal: request.signal }, () => request.authorize || request.authorizeNow || request.signal
        ? this.client!.messages.create(body, { maxRetries: 0, ...(request.signal ? { signal: request.signal } : {}) }) : this.client!.messages.create(body));
      returned = true;
      captureUsage('anthropic', 'claude', () => ({ inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens,
        cacheReadTokens: response.usage?.cache_read_input_tokens, cacheWriteTokens: response.usage?.cache_creation_input_tokens }));
      return response;
      } finally { if (!returned) unavailableUsage('anthropic', 'claude'); }
    });
  }

  /** The provider turns plus the optional system tail (TIREH_PROMPT_SYSTEM_TAIL arm). */
  private turns(request: LLMRequest): Anthropic.MessageParam[] {
    return withSystemTail(anthropicTurns(request.messages), request.systemTail);
  }

  /**
   * Content-free metadata for one provider response: stop reason and token
   * counts only, never text. A throwing getter or callback never changes delivery.
   */
  private emitMeta(request: LLMRequest, response: { stop_reason?: unknown; usage?: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number | null>> | null }): void {
    if (!request.onMeta) return;
    try {
      let stop: unknown;
      try { stop = response.stop_reason; } catch { stop = undefined; }
      request.onMeta({ provider: 'anthropic', model: this.model, stopReason: stopReason(stop),
        ...tokenMeta({ inputTokens: () => response.usage?.input_tokens, outputTokens: () => response.usage?.output_tokens,
          cacheReadInputTokens: () => response.usage?.cache_read_input_tokens, cacheCreationInputTokens: () => response.usage?.cache_creation_input_tokens }) });
    } catch { /* Metadata is best-effort. */ }
  }

  async complete(request: LLMRequest): Promise<string> {
    const response = await this.create(request, { ...this.params(request), messages: this.turns(request) });
    this.emitMeta(request, response);
    if (request.requireComplete && response.stop_reason === 'max_tokens') throw new Error('LLM completion truncated');
    return response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
  }

  async *stream(request: LLMRequest): AsyncIterable<string> {
    this.getClient();
    await authorizeRequest(request);
    const body = { ...this.params(request), messages: this.turns(request) };
    authorizeImmediate(request);
    const stream = transportAuthority.run({ authorizeNow: request.authorizeNow, signal: request.signal }, () => request.authorize || request.authorizeNow || request.signal
      ? this.client!.messages.stream(body, { maxRetries: 0, ...(request.signal ? { signal: request.signal } : {}) }) : this.client!.messages.stream(body));
    const started = performance.now();
    let completed = false;
    let sawStart = false;
    let stop: unknown;
    let inputTokens: number | undefined, outputTokens: number | undefined, cacheReadTokens: number | null | undefined, cacheWriteTokens: number | null | undefined;
    try {
      for await (const event of stream) {
        try {
          if (event.type === 'message_start') { inputTokens = event.message?.usage?.input_tokens; outputTokens = event.message?.usage?.output_tokens;
            cacheReadTokens = event.message?.usage?.cache_read_input_tokens; cacheWriteTokens = event.message?.usage?.cache_creation_input_tokens; }
          if (event.type === 'message_start') sawStart = true;
          if (event.type === 'message_delta' && event.usage?.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
          if (event.type === 'message_delta' && event.delta?.stop_reason !== undefined) stop = event.delta.stop_reason;
        } catch { /* Optional measurement must not change content delivery. */ }
        if (event.type === 'message_stop') completed = true;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
    } finally {
      // Streaming usage is cumulative, so emit one receipt rather than summing deltas.
      observedUsage('anthropic', 'claude', { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, !completed);
      recordStage('generation', completed ? 'succeeded' : 'unknown', performance.now() - started);
      if (sawStart) this.emitMeta(request, { stop_reason: stop, usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: cacheReadTokens, cache_creation_input_tokens: cacheWriteTokens } });
    }
  }

  async completeWithWeb(request: LLMRequest & { maxSearches: number }): Promise<{ text: string; sources: WebSource[] }> {
    if (this.webUnavailable || request.maxSearches < 1) return { text: await this.complete(request), sources: [] };
    this.getClient();
    const messages: Anthropic.MessageParam[] = this.turns(request);
    const tools: Anthropic.ToolUnion[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: request.maxSearches }];
    try {
      let response = await this.create(request, { ...this.params(request), messages, tools });
      for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_WEB_CONTINUATIONS; i++) {
        messages.push({ role: 'assistant', content: response.content });
        response = await this.create(request, { ...this.params(request), messages, tools });
      }
      this.emitMeta(request, response);
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

/**
 * @deprecated Not used by Vox Studio (src/lib/studio/runtime.ts constructs AnthropicLLM only).
 * Reachable only via createLLMFromEnv with TIREH_LLM_PROVIDER=gemini: the standalone TIREH
 * webhook runtime (src/lib/tireh/runtime.ts, /api/tireh/telegram/[personaId]) and
 * scripts/tireh-local.ts. No web search, no prompt caching, not approved for Telegram image
 * turns. Kept until the standalone runtime is retired or kept by decision; see
 * docs/TIREH_PERSONAS.md.
 */
export class GeminiLLM implements LLM {
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly apiKey: string, private readonly model: string) {}
  get identity() { return { provider: 'gemini', model: this.model }; }

  async complete({ system, systemTail, messages, maxTokens = 1024, temperature = 0.7, requireComplete, authorize, authorizeNow, signal }: LLMRequest): Promise<string> {
    const turns = normalizeTurns(messages);
    const last = turns.pop();
    if (!last) return '';
    this.client ??= new GoogleGenerativeAI(this.apiKey);
    const model = this.client.getGenerativeModel({ model: this.model, systemInstruction: systemText(system) + (systemTail ? '\n\n' + systemTail : '') });
    const chat = model.startChat({
      history: turns.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: geminiParts(m) })),
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    });
    await authorizeRequest({ authorize });
    const result = await measureStage('generation', async () => {
      let returned = false;
      try {
      authorizeImmediate({ authorizeNow, signal });
      const outgoing = last.images?.length ? geminiParts(last) : geminiText(last);
      const result = await (signal ? chat.sendMessage(outgoing, { signal }) : chat.sendMessage(outgoing));
      returned = true;
      captureUsage('gemini', 'gemini', () => ({ inputTokens: result.response.usageMetadata?.promptTokenCount,
        outputTokens: result.response.usageMetadata?.candidatesTokenCount, cacheReadTokens: result.response.usageMetadata?.cachedContentTokenCount }));
      return result;
      } finally { if (!returned) unavailableUsage('gemini', 'gemini'); }
    });
    if (requireComplete && result.response.candidates?.some((candidate) => candidate.finishReason === 'MAX_TOKENS')) throw new Error('LLM completion truncated');
    return result.response.text().trim();
  }
}

/** Fixed string: no env values, keys, model ids or content. */
export const GEMINI_DEPRECATION_WARNING = 'tireh_llm_gemini_deprecated: TIREH_LLM_PROVIDER=gemini is deprecated; Vox Studio runs on Anthropic only. See docs/TIREH_PERSONAS.md.';

export function createLLMFromEnv(env: NodeJS.ProcessEnv = process.env, log: Pick<Console, 'warn'> = console): LLM {
  const provider = env.TIREH_LLM_PROVIDER ?? 'anthropic';
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for TIREH_LLM_PROVIDER=gemini');
    log.warn(GEMINI_DEPRECATION_WARNING);
    return new GeminiLLM(env.GEMINI_API_KEY, env.TIREH_LLM_MODEL ?? 'gemini-2.0-flash-001');
  }
  if (provider !== 'anthropic') throw new Error(`Unknown TIREH_LLM_PROVIDER "${provider}"`);
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for TIREH personas');
  return new AnthropicLLM(env.ANTHROPIC_API_KEY, env.TIREH_LLM_MODEL ?? 'claude-sonnet-5-5');
}
