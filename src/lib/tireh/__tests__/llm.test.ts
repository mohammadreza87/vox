import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLLM, GeminiLLM } from '../llm';

const provider = vi.hoisted(() => ({
  create: vi.fn(),
  getGenerativeModel: vi.fn(),
  startChat: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: provider.create };
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

it('preserves Gemini sampling and output settings', async () => {
  expect(await new GeminiLLM('fixture-key', 'gemini-2.0-flash-001').complete({ ...request, temperature: 0.15 }))
    .toBe('fixture answer');
  expect(provider.startChat).toHaveBeenCalledWith({
    history: [], generationConfig: { maxOutputTokens: 1500, temperature: 0.15 },
  });
  expect(provider.sendMessage).toHaveBeenCalledWith('A helpful teammate');
  expect(provider.create).not.toHaveBeenCalled();
});
