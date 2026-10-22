/**
 * Provider-neutral content shapes shared by llm.ts, the cache-stable prompt
 * (conversation/prompt.ts) and image ingestion (images/). Types and pure
 * helpers only: no provider SDK, no I/O, no logging. Created byte-identically
 * by steps S03 and S12 of docs/AGENT_INTELLIGENCE_SOLUTION.md; change it only
 * in a follow-up commit after both merge.
 */

/** Anthropic prompt-cache marker. An omitted ttl means the provider default (5 minutes). */
export interface CacheControl {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

/** One system content block. Text only: images never enter system blocks. */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

/** LLMRequest.system: a plain string (the unchanged legacy path) or ordered blocks. */
export type LLMSystem = string | SystemBlock[];

/** Joins blocks for providers without block support and for tests; a string is returned unchanged. */
export function systemText(system: LLMSystem): string {
  return typeof system === 'string' ? system : system.map((block) => block.text).join('\n\n');
}

/** Extras an LLMMessage may carry; llm.ts LLMMessage extends this. Absent fields change nothing. */
export interface LLMMessageExtras {
  /** User turns only: text blocks sent after `content`, e.g. "## For this turn". Never retained in history. */
  trailingText?: string[];
  /** Anthropic only: cache breakpoint on this message's last content block. Other providers ignore it. */
  cacheControl?: CacheControl;
}

export type LLMStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal' | 'unknown';

/** Content-free metadata for one provider response. Never contains prompt or reply text. */
export interface LLMResponseMeta {
  provider: string;
  model: string;
  stopReason: LLMStopReason;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** Thrown before any provider call when an image turn targets a provider this path does not approve for vision. */
export class VisionUnsupportedError extends Error {
  constructor(provider: string) {
    super(`vision_unsupported:${provider}`);
    this.name = 'VisionUnsupportedError';
  }
}

/** Only the Anthropic adapter is approved for Telegram image turns. */
export function isVisionCapable(llm: { readonly identity?: { provider: string; model: string } }): boolean {
  return llm.identity?.provider === 'anthropic';
}

/** chars / 3.5 approximation used for the 512-token cache floor; not a billing count. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
