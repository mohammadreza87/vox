/**
 * S03 end-to-end wire test: PersonaGateway with AnthropicLLM('claude-haiku-5-5')
 * over a mocked SDK that captures every create and stream body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacyState } from '../gateway';
import { AnthropicLLM, cachedSystem } from '../llm';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper, type NewMemory } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { MemoryRecord } from '../types';
import { TG, fakeBot, memory, privateText, testOrg } from './fixtures';

const provider = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: provider.create, stream: provider.stream };
  },
}));

const MEMORY_CANARY = 'MEMORY_CANARY_S03_WIRE';
const SAVED_CANARY = 'SAVED_CONTEXT_CANARY_S03_WIRE';
const START = new Date('2026-10-19T10:00:00Z');
const DAY = 86_400_000;

type Cache = { type: string; ttl?: string };
type Block = { type: string; text?: string; cache_control?: Cache } & Record<string, unknown>;
type Body = { system: string | Block[]; messages: Array<{ role: string; content: string | Block[] }>; max_tokens: number; output_config?: { effort: string } } & Record<string, unknown>;

let bodies: Body[] = [];
const isExtraction = (body: Body) => typeof body.system === 'string' && body.system.startsWith('You extract');
beforeEach(() => {
  bodies = [];
  vi.stubEnv('TIREH_CACHED_PROMPT', '1');
  vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
  provider.create.mockReset();
  provider.stream.mockReset();
  provider.create.mockImplementation(async (body: Body) => {
    bodies.push(structuredClone(body));
    if (isExtraction(body)) return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"memories":[]}' }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: `Wire reply ${bodies.length}.` }], usage: { input_tokens: 9, output_tokens: 3 } };
  });
  provider.stream.mockImplementation((body: Body) => {
    bodies.push(structuredClone(body));
    return (async function* () {
      yield { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Live reply.' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } };
      yield { type: 'message_stop' };
    })();
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

function seed(record: MemoryRecord): NewMemory {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))) as NewMemory;
}

function harness(privacy?: Partial<RuntimePrivacyState>) {
  const org = testOrg();
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const bot = fakeBot();
  const clock = { now: START };
  const state: RuntimePrivacyState = { revision: '1', memoryEnabled: true, historyEnabled: true, ...privacy };
  const gateway = new PersonaGateway({
    org, llm: new AnthropicLLM('fixture-key', 'claude-haiku-5-5'), memories, history, offers: new InMemoryShareOfferStore(), deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => clock.now,
    ...(privacy ? { runtimePrivacy: { read: async () => state, validateAudience: async () => true } } : {}),
  });
  return { org, memories, gateway, clock };
}

const replies = () => bodies.filter((b) => !isExtraction(b));
async function drain(parts: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const part of parts) out.push(part);
  return out;
}

/** System blocks, then every message's content blocks (a string content counts as one block), in wire order. */
function wireBlocks(body: Body): Array<{ text: string; cache?: Cache }> {
  const out: Array<{ text: string; cache?: Cache }> = typeof body.system === 'string' ? [{ text: body.system }] : body.system.map((b) => ({ text: String(b.text), cache: b.cache_control }));
  for (const message of body.messages) {
    if (typeof message.content === 'string') out.push({ text: message.content });
    else for (const block of message.content) out.push({ text: block.type === 'text' ? String(block.text) : JSON.stringify(block), cache: block.cache_control });
  }
  return out;
}
function splitAtLastBreakpoint(body: Body): { before: string; after: string } {
  const blocks = wireBlocks(body);
  let last = -1;
  blocks.forEach((b, i) => { if (b.cache) last = i; });
  return { before: blocks.slice(0, last + 1).map((b) => b.text).join('\n'), after: blocks.slice(last + 1).map((b) => b.text).join('\n') };
}

describe('cache breakpoints on the real Anthropic body', () => {
  it('puts no date, memory, saved context or per-turn text before the last breakpoint', async () => {
    const ctx = harness();
    await ctx.memories.add(seed(memory({ content: MEMORY_CANARY, scope: { kind: 'private', personId: 'reza' }, source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-10T10:00:00Z') } })));
    for (const text of ['first', 'second', 'third']) await ctx.gateway.handleUpdate('aria', privateText(TG.reza, text));
    const saved = harness({ context: [SAVED_CANARY] });
    for (const text of ['one', 'two']) await saved.gateway.converse('aria', 'reza', text);
    const sent = replies();
    expect(sent).toHaveLength(5);
    for (const body of sent) {
      const { before, after } = splitAtLastBreakpoint(body);
      for (const forbidden of ['Today is', '2026-10-19', MEMORY_CANARY, '## What you remember', 'Server-authorized saved context', '## For this turn', SAVED_CANARY]) expect(before).not.toContain(forbidden);
      expect(after).toContain('Today is 2026-10-19.');
      expect(after).toContain('## For this turn');
      const markers = wireBlocks(body).filter((b) => b.cache).map((b) => b.cache!);
      expect(markers.length).toBeLessThanOrEqual(4);
      const lastHour = markers.map((m) => m.ttl === '1h').lastIndexOf(true);
      const firstShort = markers.findIndex((m) => m.ttl !== '1h');
      expect(lastHour).toBeLessThan(firstShort);
    }
    for (const body of sent.slice(0, 3)) expect(splitAtLastBreakpoint(body).after).toContain(MEMORY_CANARY);
    expect(splitAtLastBreakpoint(sent[4]).after).toContain(SAVED_CANARY);
    expect(wireBlocks(sent[2]).filter((b) => b.cache)).toHaveLength(4);
  });

  it('keeps the live call body clean before its breakpoints', async () => {
    const ctx = harness();
    await ctx.memories.add(seed(memory({ content: MEMORY_CANARY, scope: { kind: 'private', personId: 'reza' } })));
    await drain(ctx.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'live question' }]));
    const live = provider.stream.mock.lastCall![0] as Body;
    expect(live.max_tokens).toBe(800);
    expect(live.output_config).toEqual({ effort: 'low' });
    const { before, after } = splitAtLastBreakpoint(live);
    expect(before).not.toContain('Today is');
    expect(before).not.toContain(MEMORY_CANARY);
    expect(after).toContain(MEMORY_CANARY);
    expect(live.messages.at(-1)!.role).toBe('user');
    expect((live.system as Block[]).at(-1)!.text).toContain('## Live voice call');
  });

  it('orders converse images first, then the text and the per-turn block, with the breakpoint on the previous assistant', async () => {
    const ctx = harness();
    await ctx.gateway.converse('aria', 'reza', 'Earlier turn');
    await ctx.gateway.converse('aria', 'reza', 'What is in this picture?', { images: [{ mimeType: 'image/png', data: 'synthetic-image-bytes' }] });
    const body = replies().at(-1)!;
    const user = body.messages.at(-1)!;
    const content = user.content as Block[];
    expect(user.role).toBe('user');
    expect(content.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(content[1]).toEqual({ type: 'text', text: 'What is in this picture?' });
    expect(String(content[2].text).startsWith('## For this turn')).toBe(true);
    expect(JSON.stringify(user)).not.toContain('cache_control');
    expect(body.messages.at(-2)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Wire reply 1.', cache_control: { type: 'ephemeral' } }] });
    expect(splitAtLastBreakpoint(body).before).not.toContain('synthetic-image-bytes');
  });

  it('serializes the system-tail arm as a trailing system message', async () => {
    vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '1');
    const ctx = harness();
    await ctx.gateway.converse('aria', 'reza', 'first');
    const body = replies().at(-1)!;
    expect(body.messages.at(-1)!.role).toBe('system');
    expect(String(body.messages.at(-1)!.content).startsWith('## For this turn')).toBe(true);
    expect(body.messages.at(-2)).toEqual({ role: 'user', content: 'first' });
  });
});

describe('stability and flag-off parity', () => {
  it('sends a deep-equal body.system across two turns on two days, always at effort low', async () => {
    const ctx = harness();
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'day one'));
    ctx.clock.now = new Date(START.getTime() + DAY);
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'day two'));
    const [one, two] = replies();
    expect(two.system).toEqual(one.system);
    for (const body of [one, two]) expect(body.output_config).toEqual({ effort: 'low' });
    expect(JSON.stringify(two)).toContain('Today is 2026-10-20.');
  });

  it('flag off: a string system split at </rules>, base-shaped messages and no ttl', async () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '');
    const ctx = harness({ context: [SAVED_CANARY] });
    await ctx.gateway.converse('aria', 'reza', 'first');
    await ctx.gateway.converse('aria', 'reza', 'second');
    for (const body of replies()) {
      const system = body.system as Block[];
      expect(system).toHaveLength(2);
      expect(String(system[0].text).endsWith('</rules>')).toBe(true);
      expect(system).toEqual(cachedSystem(system.map((b) => b.text).join('')));
      expect(JSON.stringify(body)).not.toContain('"ttl"');
      expect(JSON.stringify(body)).not.toContain('## For this turn');
      for (const message of body.messages) expect(typeof message.content).toBe('string');
      expect(body.messages[0].content).toContain(SAVED_CANARY);
      expect(body.output_config).toEqual({ effort: 'low' });
    }
  });
});
