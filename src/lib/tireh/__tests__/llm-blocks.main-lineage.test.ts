// Main's earlier S03 lineage (488958a/a37fcc2/fd1fc4e) cases that pass against the chosen wave A prompt layout; the rest are recorded in WAVE_A_MAIN_INTEGRATION.md (S03).
/** S03: system blocks, message extras, the system-tail arm and content-free response metadata in llm.ts. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLLM, GeminiLLM, anthropicSystem, anthropicTurns, cachedSystem, normalizeTurns, type LLMMessage, type LLMRequest, type LLMResponseMeta, type SystemBlock } from '../llm';
import { systemText } from '../llm-content';

const provider = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
  getGenerativeModel: vi.fn(),
  startChat: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: provider.create, stream: provider.stream };
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = provider.getGenerativeModel;
  },
}));

const PROMPT_CANARY = 'PROMPT_CANARY_S03';
const REPLY_CANARY = 'REPLY_CANARY_S03';
const RULES = `You are a fixture ${PROMPT_CANARY}.\n<rules>\n- Be brief.\n</rules>\n\n## This turn\nToday is 2026-10-19.`;
const blocks: SystemBlock[] = [
  { type: 'text', text: 'A identity', cache_control: { type: 'ephemeral', ttl: '1h' } },
  { type: 'text', text: 'B org', cache_control: { type: 'ephemeral', ttl: '1h' } },
  { type: 'text', text: 'C frame', cache_control: { type: 'ephemeral' } },
  { type: 'text', text: 'D unmarked' },
];
const userTurn = (content: string, extra: Partial<LLMMessage> = {}): LLMMessage => ({ role: 'user', content, ...extra });
const answer = (extra: Record<string, unknown> = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: REPLY_CANARY }],
  usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 2 }, ...extra });
const haiku = () => new AnthropicLLM('fixture-key', 'claude-haiku-5-5');
const lastBody = () => provider.create.mock.lastCall?.[0];
function streamOf(events: unknown[]) {
  return (async function* () { yield* events; })();
}
async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const parts: string[] = [];
  for await (const part of iterable) parts.push(part);
  return parts;
}

beforeEach(() => {
  vi.clearAllMocks();
  provider.create.mockResolvedValue(answer());
  provider.getGenerativeModel.mockReturnValue({ startChat: provider.startChat });
  provider.startChat.mockReturnValue({ sendMessage: provider.sendMessage });
  provider.sendMessage.mockResolvedValue({ response: { text: () => ' gemini answer ' } });
});

describe('string system keeps the base request shapes', () => {
  const messages = [userTurn('hello')];
  it('splits a </rules> system into a cached prefix plus the rest, for complete, stream and completeWithWeb', async () => {
    const expected = [
      { type: 'text', text: RULES.slice(0, RULES.indexOf('</rules>') + 8), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: RULES.slice(RULES.indexOf('</rules>') + 8) },
    ];
    expect(cachedSystem(RULES)).toEqual(expected);
    await haiku().complete({ system: RULES, messages, maxTokens: 500 });
    expect(lastBody()).toEqual({ model: 'claude-haiku-5-5', max_tokens: 500, system: expected, messages: [{ role: 'user', content: 'hello' }] });
    provider.stream.mockReturnValueOnce(streamOf([]));
    await drain(haiku().stream({ system: RULES, messages, maxTokens: 500 }));
    expect(provider.stream.mock.lastCall?.[0]).toEqual({ model: 'claude-haiku-5-5', max_tokens: 500, system: expected, messages: [{ role: 'user', content: 'hello' }] });
    await haiku().completeWithWeb({ system: RULES, messages, maxTokens: 500, maxSearches: 2 });
    expect(lastBody()).toEqual({ model: 'claude-haiku-5-5', max_tokens: 500, system: expected, messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] });
  });

  it('sends a plain string system unchanged and never serializes local request fields', async () => {
    const request: LLMRequest = { system: 'Plain system', messages, maxTokens: 300, authorize: async () => true, onMeta: () => undefined };
    await haiku().complete(request);
    expect(lastBody().system).toBe('Plain system');
    const serialized = JSON.stringify([...provider.create.mock.calls]);
    for (const key of ['systemTail', 'onMeta', 'authorize', 'trailingText', 'cacheControl']) expect(serialized).not.toContain(key);
  });
});

describe('array system', () => {
  it('passes blocks through in order, keeps cache_control and serializes ttl only when set', async () => {
    expect(anthropicSystem(blocks)).toEqual([
      { type: 'text', text: 'A identity', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'B org', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'C frame', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'D unmarked' },
    ]);
    const sent = anthropicSystem(blocks) as unknown as Array<Record<string, unknown>>;
    expect(sent.map((b) => Object.keys(b).sort())).toEqual([['cache_control', 'text', 'type'], ['cache_control', 'text', 'type'], ['cache_control', 'text', 'type'], ['text', 'type']]);
    expect(Object.keys(sent[2].cache_control as object)).toEqual(['type']);
    await haiku().complete({ system: blocks, messages: [userTurn('hi')] });
    expect(lastBody().system).toEqual(anthropicSystem(blocks));
    expect(systemText(blocks)).toBe('A identity\n\nB org\n\nC frame\n\nD unmarked');
  });

  it('drops empty-text blocks and keeps only type and ttl in cache_control (F145: not an identity function)', async () => {
    const extra = { type: 'ephemeral', ttl: '1h', scope: 'global', debug: 'PRIVATE_CANARY' } as unknown as SystemBlock['cache_control'];
    const noisy: SystemBlock[] = [
      { type: 'text', text: 'A identity', cache_control: extra },
      { type: 'text', text: '', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'B org', cache_control: { type: 'ephemeral', ttl: undefined } },
      { type: 'text', text: 'C plain' },
    ];
    const expected = [
      { type: 'text', text: 'A identity', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'B org', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'C plain' },
    ];
    expect(anthropicSystem(noisy)).toEqual(expected);
    const sent = anthropicSystem(noisy) as unknown as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(3);
    expect(Object.keys(sent[0].cache_control as object).sort()).toEqual(['ttl', 'type']);
    expect(Object.keys(sent[1].cache_control as object)).toEqual(['type']);
    await haiku().complete({ system: noisy, messages: [userTurn('hi')] });
    expect(lastBody().system).toEqual(expected);
    expect(JSON.stringify(lastBody().system)).not.toContain('PRIVATE_CANARY');
  });

  it.each([['claude-haiku-5-5', true], ['claude-sonnet-5-5', true], ['claude-haiku-4-5', false]])('effort low for %s serializes as output_config: %s', async (model, sent) => {
    await new AnthropicLLM('fixture-key', model).complete({ system: blocks, messages: [userTurn('hi')], effort: 'low' });
    if (sent) expect(lastBody().output_config).toEqual({ effort: 'low' });
    else expect(lastBody()).not.toHaveProperty('output_config');
  });
});

describe('normalizeTurns with extras', () => {
  it('keeps the base output for inputs without extras', () => {
    const image = { mimeType: 'image/png' as const, data: 'px' };
    const input: LLMMessage[] = [
      { role: 'assistant', content: 'dropped lead' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b', images: [image] },
      { role: 'user', content: '  ' },
      { role: 'assistant', content: 'c' },
      { role: 'assistant', content: 'd', images: [image] },
      { role: 'user', content: '', images: [image] },
    ];
    expect(normalizeTurns(input)).toEqual([
      { role: 'user', content: 'a\nb', images: [image] },
      { role: 'assistant', content: 'c\nd' },
      { role: 'user', content: '', images: [image] },
    ]);
    for (const turn of normalizeTurns(input)) for (const value of Object.values(turn)) expect(value).not.toBeUndefined();
    expect(Object.keys(normalizeTurns(input)[1])).toEqual(['role', 'content']);
  });

  it('concatenates trailingText, keeps the last cacheControl, drops assistant trailingText and never mutates input', () => {
    const input: LLMMessage[] = [
      { role: 'user', content: 'a', trailingText: ['t1'], cacheControl: { type: 'ephemeral', ttl: '1h' } },
      { role: 'user', content: 'b', trailingText: ['t2', 't3'], cacheControl: { type: 'ephemeral' } },
      { role: 'assistant', content: 'r', trailingText: ['never'] },
      { role: 'assistant', content: 's', cacheControl: { type: 'ephemeral' } },
      { role: 'user', content: 'c' },
    ];
    const before = structuredClone(input);
    expect(normalizeTurns(input)).toEqual([
      { role: 'user', content: 'a\nb', trailingText: ['t1', 't2', 't3'], cacheControl: { type: 'ephemeral' } },
      { role: 'assistant', content: 'r\ns', cacheControl: { type: 'ephemeral' } },
      { role: 'user', content: 'c' },
    ]);
    expect(input).toEqual(before);
    expect(normalizeTurns([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y', trailingText: ['z'] }])[1]).toEqual({ role: 'assistant', content: 'y' });
  });
});

describe('anthropicTurns with extras', () => {
  const image = { mimeType: 'image/png' as const, data: 'synthetic-image-bytes' };
  const imageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'synthetic-image-bytes' } };
  it('sends an image-free user turn with trailingText as text blocks only', () => {
    expect(anthropicTurns([userTurn('question', { trailingText: ['## For this turn\nToday'] })])).toEqual([{ role: 'user', content: [
      { type: 'text', text: 'question' }, { type: 'text', text: '## For this turn\nToday' },
    ] }]);
    expect(JSON.stringify(anthropicTurns([userTurn('question', { trailingText: ['t'] })]))).not.toContain('Describe the shared image.');
  });
  it('puts images first and cache_control only on the last block', () => {
    expect(anthropicTurns([userTurn('Describe this.', { images: [image], trailingText: ['turn'], cacheControl: { type: 'ephemeral', ttl: '5m' } })])).toEqual([{ role: 'user', content: [
      imageBlock, { type: 'text', text: 'Describe this.' }, { type: 'text', text: 'turn', cache_control: { type: 'ephemeral', ttl: '5m' } },
    ] }]);
    expect(anthropicTurns([userTurn('', { images: [image], trailingText: ['turn'] })])[0].content).toEqual([
      imageBlock, { type: 'text', text: 'Describe the shared image.' }, { type: 'text', text: 'turn' }]);
  });
  it('marks an assistant breakpoint as one cached text block and leaves other turns unchanged', () => {
    expect(anthropicTurns([userTurn('q'), { role: 'assistant', content: 'a', cacheControl: { type: 'ephemeral' } }, userTurn('next')])).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'next' },
    ]);
  });
});

describe('system tail (A/B arm)', () => {
  const messages: LLMMessage[] = [userTurn('first'), { role: 'assistant', content: 'reply' }, userTurn('latest')];
  it('ends the Anthropic body with a system message', async () => {
    await haiku().complete({ system: blocks, messages, systemTail: 'TAIL' });
    expect(lastBody().messages.at(-1)).toEqual({ role: 'system', content: 'TAIL' });
    provider.stream.mockReturnValueOnce(streamOf([]));
    await drain(haiku().stream({ system: blocks, messages, systemTail: 'TAIL' }));
    expect(provider.stream.mock.lastCall?.[0].messages.at(-1)).toEqual({ role: 'system', content: 'TAIL' });
  });
  it('keeps the tail before the pushed assistant content on a pause_turn continuation', async () => {
    const paused = { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }] };
    const seen: unknown[] = [];
    provider.create.mockImplementation(async (body: { messages: unknown[] }) => { seen.push(structuredClone(body.messages)); return seen.length === 1 ? paused : answer(); });
    await haiku().completeWithWeb({ system: blocks, messages, systemTail: 'TAIL', maxSearches: 1 });
    expect((seen[0] as unknown[]).at(-1)).toEqual({ role: 'system', content: 'TAIL' });
    expect((seen[1] as unknown[]).slice(-2)).toEqual([{ role: 'system', content: 'TAIL' }, { role: 'assistant', content: paused.content }]);
  });
  it('maps blocks, tail and trailing text onto Gemini text', async () => {
    const turns: LLMMessage[] = [userTurn('first', { trailingText: ['old turn note'] }), { role: 'assistant', content: 'reply', cacheControl: { type: 'ephemeral' } }, userTurn('latest', { trailingText: ['## For this turn'] })];
    expect(await new GeminiLLM('fixture-key', 'gemini-test').complete({ system: blocks, messages: turns, systemTail: 'TAIL' })).toBe('gemini answer');
    expect(provider.getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-test', systemInstruction: `${systemText(blocks)}\n\nTAIL` });
    expect(provider.startChat.mock.lastCall?.[0].history).toEqual([
      { role: 'user', parts: [{ text: 'first\n\nold turn note' }] }, { role: 'model', parts: [{ text: 'reply' }] },
    ]);
    expect(provider.sendMessage).toHaveBeenLastCalledWith('latest\n\n## For this turn');
    await new GeminiLLM('fixture-key', 'gemini-test').complete({ system: 'plain', messages: [userTurn('x', { images: [{ mimeType: 'image/png', data: 'px' }], trailingText: ['t'] })] });
    expect(provider.sendMessage).toHaveBeenLastCalledWith([{ text: 'x\n\nt' }, { inlineData: { mimeType: 'image/png', data: 'px' } }]);
    expect(provider.getGenerativeModel).toHaveBeenLastCalledWith({ model: 'gemini-test', systemInstruction: 'plain' });
  });
});

describe('content-free response metadata', () => {
  const base: LLMRequest = { system: RULES, messages: [userTurn(`hello ${PROMPT_CANARY}`)] };
  it('complete emits once with the stop reason and finite token fields, before a truncation throw', async () => {
    const metas: LLMResponseMeta[] = [];
    expect(await haiku().complete({ ...base, onMeta: (m) => metas.push(m) })).toBe(REPLY_CANARY);
    expect(metas).toEqual([{ provider: 'anthropic', model: 'claude-haiku-5-5', stopReason: 'end_turn', inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 7, cacheCreationInputTokens: 2 }]);
    provider.create.mockResolvedValueOnce(answer({ stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: Number.NaN, cache_read_input_tokens: null } }));
    await expect(haiku().complete({ ...base, requireComplete: true, onMeta: (m) => metas.push(m) })).rejects.toThrow('completion truncated');
    expect(metas[1]).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', stopReason: 'max_tokens', inputTokens: 1 });
    provider.create.mockResolvedValueOnce(answer({ stop_reason: 'something_new' }));
    await haiku().complete({ ...base, onMeta: (m) => metas.push(m) });
    expect(metas[2].stopReason).toBe('unknown');
    for (const meta of metas) {
      expect(JSON.stringify(meta)).not.toContain(PROMPT_CANARY);
      expect(JSON.stringify(meta)).not.toContain(REPLY_CANARY);
    }
  });

  it('a throwing usage getter or onMeta leaves the answer unchanged', async () => {
    const response = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'same answer' }] };
    Object.defineProperty(response, 'usage', { get: () => { throw new Error('PRIVATE_USAGE_GETTER'); } });
    provider.create.mockResolvedValue(response);
    const metas: LLMResponseMeta[] = [];
    expect(await haiku().complete({ ...base, onMeta: (m) => metas.push(m) })).toBe('same answer');
    expect(metas).toEqual([{ provider: 'anthropic', model: 'claude-haiku-5-5', stopReason: 'end_turn' }]);
    expect(await haiku().complete({ ...base, onMeta: () => { throw new Error('observer failure'); } })).toBe('same answer');
  });

  it('stream emits once at the end with the final delta usage and stop reason', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 8, output_tokens: 0, cache_read_input_tokens: 6 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: REPLY_CANARY } },
      { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 3 } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    provider.stream.mockReturnValueOnce(streamOf(events));
    const metas: LLMResponseMeta[] = [];
    expect(await drain(haiku().stream({ ...base, onMeta: (m) => metas.push(m) }))).toEqual([REPLY_CANARY]);
    expect(metas).toEqual([{ provider: 'anthropic', model: 'claude-haiku-5-5', stopReason: 'end_turn', inputTokens: 8, outputTokens: 5, cacheReadInputTokens: 6 }]);
    provider.stream.mockReturnValueOnce(streamOf(events));
    for await (const part of haiku().stream({ ...base, onMeta: (m) => metas.push(m) })) { void part; break; }
    expect(metas).toHaveLength(2);
    expect(metas[1].stopReason).toBe('unknown');
    provider.stream.mockReturnValueOnce(streamOf([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }]));
    await drain(haiku().stream({ ...base, onMeta: (m) => metas.push(m) }));
    expect(metas).toHaveLength(2);
    provider.stream.mockReturnValueOnce(streamOf(events));
    expect(await drain(haiku().stream({ ...base, onMeta: () => { throw new Error('observer failure'); } }))).toEqual([REPLY_CANARY]);
    expect(JSON.stringify(metas)).not.toContain(REPLY_CANARY);
  });

  it('completeWithWeb emits once for the final response and once through complete on the fallback', async () => {
    const paused = { stop_reason: 'pause_turn', content: [], usage: { input_tokens: 2, output_tokens: 3 } };
    provider.create.mockResolvedValueOnce(paused).mockResolvedValueOnce(answer());
    const metas: LLMResponseMeta[] = [];
    await haiku().completeWithWeb({ ...base, maxSearches: 1, onMeta: (m) => metas.push(m) });
    expect(metas).toEqual([{ provider: 'anthropic', model: 'claude-haiku-5-5', stopReason: 'end_turn', inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 7, cacheCreationInputTokens: 2 }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      provider.create.mockRejectedValueOnce(Object.assign(new Error('web_search is not supported'), { status: 400 }));
      const llm = haiku();
      await llm.completeWithWeb({ ...base, maxSearches: 1, onMeta: (m) => metas.push(m) });
      expect(metas).toHaveLength(2);
      await llm.completeWithWeb({ ...base, maxSearches: 1, onMeta: (m) => metas.push(m) });
      expect(metas).toHaveLength(3);
    } finally { warn.mockRestore(); }
    await haiku().completeWithWeb({ ...base, maxSearches: 0, onMeta: (m) => metas.push(m) });
    expect(metas).toHaveLength(4);
  });

  it('GeminiLLM never calls onMeta', async () => {
    const onMeta = vi.fn();
    await new GeminiLLM('fixture-key', 'gemini-test').complete({ ...base, onMeta });
    expect(onMeta).not.toHaveBeenCalled();
  });
});

describe('shared contract files', () => {
  it.each([
    ['flags.ts', '7adeaa35129d3ac610ef67940eff790b49417206ee4ccff3f7b88cc5db806740'],
    ['llm-content.ts', '4c83fe241a05bca3e61a0d2f4470398ccd07d0e20a22527f1537cdd3e548e663'],
  ])('%s is byte-identical to the contract', (file, sha) => {
    expect(createHash('sha256').update(readFileSync(join(__dirname, '..', file))).digest('hex')).toBe(sha);
  });
});
