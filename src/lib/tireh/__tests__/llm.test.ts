import { TurnTrace } from '../../adaptive/observation/trace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLLM, GeminiLLM, supportsEffort } from '../llm';
import { withSources } from '../gateway';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

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

const request = {
  system: 'Draft a colleague persona as JSON.',
  messages: [{ role: 'user' as const, content: 'A helpful teammate' }],
  maxTokens: 1500,
};

beforeEach(() => {
  vi.clearAllMocks();
  provider.create.mockResolvedValue({ content: [{ type: 'text', text: 'fixture answer' }] });
  provider.getGenerativeModel.mockReturnValue({ startChat: provider.startChat });
  provider.startChat.mockReturnValue({ sendMessage: provider.sendMessage });
  provider.sendMessage.mockResolvedValue({ response: { text: () => ' fixture answer ' } });
});

describe('Anthropic request compatibility', () => {
  it.each(['pause_turn', 'tool_unavailable'])('reauthorizes %s without hidden SDK retries', async kind => {
    let allowed = true;
    provider.create.mockImplementationOnce(async () => {
      allowed = false;
      if (kind === 'tool_unavailable') throw { status: 400, message: 'web_search unavailable' };
      return { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Searching' }] };
    });
    await expect(new AnthropicLLM('fixture-key', 'claude-sonnet-5-5').completeWithWeb({ ...request,
      maxSearches: 1, authorize: async () => allowed })).rejects.toThrow('llm_authority_changed');
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.create.mock.calls[0][1]).toEqual({ maxRetries: 0 });
    expect(provider.create.mock.calls[0][0]).not.toHaveProperty('authorize');
  });
  it('denies initial completion, stream and Gemini export on failed authority', async () => {
    const denied = { ...request, authorize: async () => false };
    const llm = new AnthropicLLM('fixture-key', 'claude-sonnet-5-5');
    await expect(llm.complete(denied)).rejects.toThrow('llm_authority_changed');
    await expect(llm.stream(denied).next()).rejects.toThrow('llm_authority_changed');
    await expect(new GeminiLLM('fixture-key', 'fixture-model').complete(denied)).rejects.toThrow('llm_authority_changed');
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.stream).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });
  it('rejects token-truncated output for a side-effecting caller', async () => {
    provider.create.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'How did your' }] });
    await expect(new AnthropicLLM('fixture-key', 'claude-haiku-5-5').complete({ ...request, requireComplete: true })).rejects.toThrow('completion truncated');
  });
  it.each([
    'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5-20260928',
    'claude-haiku-5-5', 'claude-haiku-5-5-20261014',
    'claude-opus-5', 'claude-opus-5-5', 'claude-opus-5-5-20260922',
    'claude-fable-5-1', 'claude-mythos-5-1',
    'claude-opus-4-7', 'claude-opus-4-8-20260723',
  ])('omits unsupported temperature for %s without changing the requested model or output budget', async model => {
    const llm = new AnthropicLLM('fixture-key', model);
    for (const settings of [{}, { temperature: 0.9 }]) {
      expect(await llm.complete({ ...request, ...settings })).toBe('fixture answer');
      const body = provider.create.mock.lastCall?.[0];
      expect(body).toEqual({ model, max_tokens: 1500, system: request.system, messages: request.messages });
      expect(body).not.toHaveProperty('temperature');
    }
  });

  it.each([
    'claude-3-opus-20240229', 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-20250514', 'claude-sonnet-4-5', 'claude-sonnet-4-6',
    'claude-haiku-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-6',
  ])('preserves custom temperature for the supported older model %s', async model => {
    await new AnthropicLLM('fixture-key', model).complete({ ...request, temperature: 0.25 });
    expect(provider.create).toHaveBeenCalledWith({
      model, max_tokens: 1500, temperature: 0.25, system: request.system, messages: request.messages,
    });
  });

  it('retains the existing default temperature for older Claude models', async () => {
    await new AnthropicLLM('fixture-key', 'claude-sonnet-4-5').complete(request);
    expect(provider.create.mock.lastCall?.[0].temperature).toBe(0.7);
  });
});

describe('reply effort', () => {
  it.each([
    'claude-sonnet-5-5', 'claude-sonnet-5-5-20260928', 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-5-5',
    'claude-fable-5-1', 'claude-opus-4-5-20251101', 'claude-opus-4-8', 'claude-sonnet-4-6',
  ])('sends output_config.effort to %s', async model => {
    await new AnthropicLLM('fixture-key', model).complete({ ...request, effort: 'low' });
    expect(provider.create.mock.lastCall?.[0].output_config).toEqual({ effort: 'low' });
    provider.stream.mockReturnValueOnce((async function* () { /* no events */ })());
    for await (const part of new AnthropicLLM('fixture-key', model).stream({ ...request, effort: 'low' })) void part;
    expect(provider.stream.mock.lastCall?.[0].output_config).toEqual({ effort: 'low' });
  });

  it.each(['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'gpt-4o'])(
    'leaves effort out for %s, which rejects it', async model => {
      expect(supportsEffort(model)).toBe(false);
      await new AnthropicLLM('fixture-key', model).complete({ ...request, effort: 'low' });
      expect(provider.create.mock.lastCall?.[0]).not.toHaveProperty('output_config');
    });

  it('sends nothing extra without an effort, and Gemini ignores it', async () => {
    await new AnthropicLLM('fixture-key', 'claude-sonnet-5-5').complete(request);
    expect(provider.create.mock.lastCall?.[0]).not.toHaveProperty('output_config');
    expect(await new GeminiLLM('fixture-key', 'fixture-model').complete({ ...request, effort: 'low' })).toBe('fixture answer');
    expect(JSON.stringify(provider.getGenerativeModel.mock.lastCall)).not.toContain('effort');
  });
});

it('preserves Gemini sampling and output settings', async () => {
  expect(await new GeminiLLM('fixture-key', 'gemini-2.0-flash-001').complete({ ...request, temperature: 0.15 }))
    .toBe('fixture answer');
  expect(provider.startChat).toHaveBeenCalledWith({
    history: [], generationConfig: { maxOutputTokens: 1500, temperature: 0.15 },
  });
  expect(provider.sendMessage).toHaveBeenCalledWith('A helpful teammate');
  expect(provider.create).not.toHaveBeenCalled();
});

it('serializes current-turn images in the provider wire format without exposing internal fields', async () => {
  const images = [{ mimeType: 'image/png' as const, data: 'synthetic-image-bytes' }];
  const multimodal = { ...request, messages: [{ role: 'user' as const, content: 'Describe this.', images }] };
  await new AnthropicLLM('fixture-key', 'claude-sonnet-5-5').complete(multimodal);
  expect(provider.create.mock.lastCall?.[0].messages).toEqual([{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'synthetic-image-bytes' } }, { type: 'text', text: 'Describe this.' },
  ] }]);
  await new GeminiLLM('fixture-key', 'gemini-test').complete(multimodal);
  expect(provider.sendMessage).toHaveBeenLastCalledWith([{ text: 'Describe this.' }, { inlineData: { mimeType: 'image/png', data: 'synthetic-image-bytes' } }]);
  expect(multimodal.messages[0].images).toEqual(images);
});

it('rejects Gemini token-truncated output for a side-effecting caller', async () => {
  provider.sendMessage.mockResolvedValueOnce({ response: { text: () => 'How did your', candidates: [{ finishReason: 'MAX_TOKENS' }] } });
  await expect(new GeminiLLM('fixture-key', 'gemini-2.0-flash-001').complete({ ...request, requireComplete: true })).rejects.toThrow('completion truncated');
});

describe('live web search', () => {
  const cite = (url: string) => ({ type: 'web_search_result_location', url, title: url, cited_text: '', encrypted_index: '' });
  const searched = {
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Tehran weather' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'text', text: 'It is 18°C and sunny ', citations: [cite('https://weather.example/teh'), cite('https://weather.example/teh')] },
      { type: 'text', text: 'right now.', citations: [cite('https://news.example/a')] },
    ],
  };

  it('offers the search tool, keeps only the answer after the results and collects unique sources', async () => {
    provider.create.mockResolvedValueOnce(searched);
    const reply = await new AnthropicLLM('fixture-key', 'claude-haiku-5-5').completeWithWeb({ ...request, maxSearches: 3 });
    expect(provider.create.mock.lastCall?.[0].tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(reply).toEqual({
      text: 'It is 18°C and sunny right now.',
      sources: [{ url: 'https://weather.example/teh', title: 'https://weather.example/teh' }, { url: 'https://news.example/a', title: 'https://news.example/a' }],
    });
    expect(withSources(reply.text, reply.sources)).toBe('It is 18°C and sunny right now.\n\nSources:\nhttps://weather.example/teh\nhttps://news.example/a');
  });

  it('continues a paused search turn with the partial answer', async () => {
    const paused = { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }] };
    provider.create.mockResolvedValueOnce(paused).mockResolvedValueOnce(searched);
    const { text } = await new AnthropicLLM('fixture-key', 'claude-haiku-5-5').completeWithWeb({ ...request, maxSearches: 1 });
    expect(text).toBe('It is 18°C and sunny right now.');
    const second = provider.create.mock.calls[1][0];
    expect(second.messages.at(-1)).toEqual({ role: 'assistant', content: paused.content });
  });

  it('answers without the web, and stops offering it, when the model refuses the tool', async () => {
    const llm = new AnthropicLLM('fixture-key', 'claude-haiku-5-5');
    provider.create.mockRejectedValueOnce(Object.assign(new Error('web_search is not supported on this model'), { status: 400 }));
    expect(await llm.completeWithWeb({ ...request, maxSearches: 3 })).toEqual({ text: 'fixture answer', sources: [] });
    await llm.completeWithWeb({ ...request, maxSearches: 3 });
    expect(provider.create).toHaveBeenCalledTimes(3);
    expect(provider.create.mock.lastCall?.[0]).not.toHaveProperty('tools');
  });

  it('keeps fallback provider content and configured model identifiers out of diagnostic arguments', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = telegramCanaryError();
      error.message += ' web_search is not supported';
      provider.create.mockRejectedValueOnce(Object.assign(error, { status: 400 }));
      const llm = new AnthropicLLM(telegramCanary.credential, telegramCanary.persona);
      expect(await llm.completeWithWeb({ ...request, maxSearches: 3 })).toEqual({ text: 'fixture answer', sources: [] });
      await llm.completeWithWeb({ ...request, maxSearches: 3 });
      expect(provider.create).toHaveBeenCalledTimes(3);
      expect(provider.create.mock.lastCall?.[0]).not.toHaveProperty('tools');
      expect(warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'web_search', reason: 'tool_unavailable', outcome: 'reply_without_search' });
      expectContentFreeTelegramLogs(warn.mock.calls);
    } finally { warn.mockRestore(); }
  });

  it('does not swallow other failures', async () => {
    provider.create.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(new AnthropicLLM('fixture-key', 'claude-haiku-5-5').completeWithWeb({ ...request, maxSearches: 3 })).rejects.toThrow('overloaded');
  });

  it.each(['status', 'message'])('preserves the original provider exception when its %s accessor throws', async (property) => {
    const error = Object.assign(telegramCanaryError(), { status: 400 });
    Object.defineProperty(error, property, { get: () => { throw new Error('synthetic getter failure'); } });
    provider.create.mockRejectedValueOnce(error);
    await expect(new AnthropicLLM('fixture-key', 'claude-haiku-5-5').completeWithWeb({ ...request, maxSearches: 3 })).rejects.toBe(error);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
});

describe('streaming', () => {
  it('yields text deltas as they arrive', async () => {
    const events = [
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } },
    ];
    provider.stream.mockReturnValue((async function* () { yield* events; })());
    const parts: string[] = [];
    for await (const p of new AnthropicLLM('fixture-key', 'claude-haiku-5-5').stream(request)) parts.push(p);
    expect(parts).toEqual(['Hi ', 'there']);
    expect(provider.stream.mock.lastCall?.[0]).toEqual({ model: 'claude-haiku-5-5', max_tokens: 1500, system: request.system, messages: request.messages });
  });
});


describe('returned provider usage without response interference', () => {
  it('records Anthropic actual zero/cache fields and never guesses missing fields', async () => {
    provider.create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: 4 } });
    const trace = new TurnTrace(true);
    expect(await trace.run(() => new AnthropicLLM('test', 'claude-haiku-5-5').complete(request))).toBe('answer');
    expect(trace.snapshot()?.usage).toEqual([{ provider: 'anthropic', modelFamily: 'claude', inputTokens: 0, outputTokens: 7, cacheReadTokens: 4, cacheWriteTokens: null, status: 'complete' }]);
    expect(trace.snapshot()?.stages[0]).toMatchObject({ stage: 'generation', outcome: 'succeeded' });
  });
  it('captures each web continuation and failure separately; failed requests have unavailable usage', async () => {
    provider.create.mockResolvedValueOnce({ stop_reason: 'pause_turn', content: [], usage: { input_tokens: 2, output_tokens: 3 } })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 5, output_tokens: 6 } });
    const trace = new TurnTrace(true);
    await trace.run(() => new AnthropicLLM('test', 'claude-haiku-5-5').completeWithWeb({ ...request, maxSearches: 1 }));
    expect(trace.snapshot()?.usage.map(u => u.inputTokens)).toEqual([2, 5]);
    provider.create.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR'));
    await expect(trace.run(() => new AnthropicLLM('test', 'claude-haiku-5-5').complete(request))).rejects.toThrow('PRIVATE_PROVIDER_ERROR');
    expect(trace.snapshot()?.usage.at(-1)?.status).toBe('unavailable'); expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_PROVIDER_ERROR');
  });
  it('emits one cumulative stream receipt and captures Gemini returned metadata', async () => {
    provider.stream.mockReturnValue((async function* () { yield { type: 'message_start', message: { usage: { input_tokens: 8, output_tokens: 0 } } };
      yield { type: 'message_delta', usage: { output_tokens: 3 } }; yield { type: 'message_delta', usage: { output_tokens: 5 } }; yield { type: 'message_stop' }; })());
    const trace = new TurnTrace(true);
    await trace.run(async () => { for await (const part of new AnthropicLLM('test', 'claude-haiku-5-5').stream(request)) { expect(typeof part).toBe('string'); } });
    expect(trace.snapshot()?.usage).toMatchObject([{ inputTokens: 8, outputTokens: 5 }]);
    provider.sendMessage.mockResolvedValueOnce({ response: { text: () => 'answer', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, cachedContentTokenCount: 2 } } });
    await trace.run(() => new GeminiLLM('test', 'gemini-test').complete(request));
    expect(trace.snapshot()?.usage.at(-1)).toMatchObject({ provider: 'gemini', inputTokens: 12, outputTokens: 6, cacheReadTokens: 2 });
  });
  it('ignores malformed usage accessors and keeps the original answer', async () => {
    const response = { content: [{ type: 'text', text: 'same answer' }] };
    Object.defineProperty(response, 'usage', { get: () => { throw new Error('PRIVATE_USAGE_GETTER'); } });
    provider.create.mockResolvedValue(response);
    expect(await new AnthropicLLM('test', 'claude-haiku-5-5').complete(request)).toBe('same answer');
    const trace = new TurnTrace(true);
    expect(await trace.run(() => new AnthropicLLM('test', 'claude-haiku-5-5').complete(request))).toBe('same answer');
    expect(trace.snapshot()?.usage[0].status).toBe('unavailable');
  });
});
