import { describe, it, expect, vi } from 'vitest';
import { TelegramApiError, TelegramBotClient } from '../telegram/client';
import { ElevenLabsVoiceService } from '../voice';
import { createLLMFromEnv, normalizeTurns, AnthropicLLM, GeminiLLM } from '../llm';
import { isValidWebhookSecret } from '../telegram/webhook-auth';
import { botTokenEnvName, getBotToken } from '../runtime';
import { findConflicts, selectMemories } from '../memory/retrieval';
import { memory, testOrg } from './fixtures';
import type { ChatContext } from '../types';

vi.mock('@/lib/firebase-admin', () => ({ getAdminDb: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function okFetch(result: unknown) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, result }), { status: 200 }));
}

describe('TelegramBotClient', () => {
  it('sends messages with reply parameters and keyboards, truncated to 4096 chars', async () => {
    const fetchFn = okFetch({ message_id: 1 });
    const bot = new TelegramBotClient('TOKEN', fetchFn as unknown as typeof fetch);
    await bot.sendMessage(42, 'x'.repeat(5000), {
      replyTo: 7,
      keyboard: { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(init.body as string);
    expect(body.text).toHaveLength(4096);
    expect(body.reply_parameters).toEqual({ message_id: 7, allow_sending_without_reply: true });
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('b');
  });

  it('sends voice as multipart form data', async () => {
    const fetchFn = okFetch({ message_id: 2 });
    const bot = new TelegramBotClient('TOKEN', fetchFn as unknown as typeof fetch);
    await bot.sendVoice(42, new ArrayBuffer(3), { caption: 'hi', mimeType: 'audio/mpeg' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendVoice');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('42');
    expect(form.get('caption')).toBe('hi');
    expect(form.get('voice')).toBeTruthy();
  });

  it('downloads files via getFile and the file endpoint, refusing oversized files', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/1.oga', file_size: 10 } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const bot = new TelegramBotClient('TOKEN', fetchFn as unknown as typeof fetch);
    const data = await bot.downloadFile('f1');
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.telegram.org/file/botTOKEN/voice/1.oga');

    const bigFetch = okFetch({ file_path: 'x', file_size: 30 * 1024 * 1024 });
    await expect(new TelegramBotClient('T', bigFetch as unknown as typeof fetch).downloadFile('f')).rejects.toThrow('too large');
  });

  it('surfaces Telegram errors', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked' }), { status: 403 }));
    const bot = new TelegramBotClient('T', fetchFn as unknown as typeof fetch);
    await expect(bot.sendMessage(1, 'x')).rejects.toBeInstanceOf(TelegramApiError);
  });

  it('registers webhooks with a secret and only the updates personas use', async () => {
    const fetchFn = okFetch(true);
    await new TelegramBotClient('T', fetchFn as unknown as typeof fetch).setWebhook('https://x/y', 's3cret');
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ url: 'https://x/y', secret_token: 's3cret', allowed_updates: ['message', 'callback_query'] });
  });
});

describe('ElevenLabsVoiceService', () => {
  it('transcribes with Scribe', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ text: '  hello  ' })));
    const voice = new ElevenLabsVoiceService('KEY', fetchFn as unknown as typeof fetch);
    expect(await voice.transcribe(new ArrayBuffer(2))).toBe('hello');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
    expect((init.body as FormData).get('model_id')).toBe('scribe_v1');
  });

  it("synthesizes MP3 in the persona's voice", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([9, 9])));
    const voice = new ElevenLabsVoiceService('KEY', fetchFn as unknown as typeof fetch);
    const out = await voice.synthesize('Hi there', 'voice-aria');
    expect(out.mimeType).toBe('audio/mpeg');
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-aria?output_format=mp3_44100_128');
  });

  it('throws on API errors so the gateway can fall back to text', async () => {
    const fetchFn = vi.fn(async () => new Response('no', { status: 401 }));
    const voice = new ElevenLabsVoiceService('KEY', fetchFn as unknown as typeof fetch);
    await expect(voice.synthesize('x', 'v')).rejects.toThrow('HTTP 401');
    await expect(voice.transcribe(new ArrayBuffer(1))).rejects.toThrow('HTTP 401');
  });
});

describe('LLM helpers', () => {
  it('normalizeTurns merges consecutive roles and drops leading assistant turns', () => {
    expect(
      normalizeTurns([
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: '' },
        { role: 'assistant', content: 'c' },
      ])
    ).toEqual([
      { role: 'user', content: 'a\nb' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('createLLMFromEnv picks the provider and requires its key', () => {
    expect(createLLMFromEnv({ ANTHROPIC_API_KEY: 'k' })).toBeInstanceOf(AnthropicLLM);
    expect(createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })).toBeInstanceOf(GeminiLLM);
    expect(() => createLLMFromEnv({})).toThrow('ANTHROPIC_API_KEY');
    expect(() => createLLMFromEnv({ TIREH_LLM_PROVIDER: 'gemini' })).toThrow('GEMINI_API_KEY');
    expect(() => createLLMFromEnv({ TIREH_LLM_PROVIDER: 'other' })).toThrow('Unknown');
  });
});

describe('webhook secret + bot tokens', () => {
  it('fails closed', () => {
    expect(isValidWebhookSecret('abc', 'abc')).toBe(true);
    expect(isValidWebhookSecret('abd', 'abc')).toBe(false);
    expect(isValidWebhookSecret('ab', 'abc')).toBe(false);
    expect(isValidWebhookSecret(null, 'abc')).toBe(false);
    expect(isValidWebhookSecret('abc', undefined)).toBe(false);
    expect(isValidWebhookSecret('', '')).toBe(false);
  });

  it('maps persona ids to bot token env vars', () => {
    expect(botTokenEnvName('aria')).toBe('TIREH_BOT_TOKEN_ARIA');
    expect(botTokenEnvName('dev-lead')).toBe('TIREH_BOT_TOKEN_DEV_LEAD');
    expect(getBotToken('aria', { TIREH_BOT_TOKEN_ARIA: 't' })).toBe('t');
  });
});

describe('retrieval', () => {
  const org = testOrg();
  const dm: ChatContext = { kind: 'private', chatKey: 'private-milad', personId: 'milad' };
  const now = new Date('2026-10-19T00:00:00Z');

  it('ranks relevant memories first and respects the limit', () => {
    const memories = [
      memory({ id: 'a', content: 'Office plants need watering', scope: { kind: 'org' } }),
      memory({ id: 'b', content: 'Tutorial length is three steps', scope: { kind: 'project', projectId: 'gameend' } }),
      memory({ id: 'c', content: 'Coffee machine is broken', scope: { kind: 'org' } }),
    ];
    const out = selectMemories(org, memories, dm, { query: 'how long is the tutorial?', limit: 2, now });
    expect(out[0].id).toBe('b');
    expect(out).toHaveLength(2);
  });

  it('never returns superseded or invisible memories', () => {
    const memories = [
      memory({ id: 'old', content: 'Tutorial is five steps', supersededBy: 'new', scope: { kind: 'org' } }),
      memory({ id: 'secret', content: 'Tutorial secret', scope: { kind: 'private', personId: 'reza' } }),
    ];
    expect(selectMemories(org, memories, dm, { query: 'tutorial', now })).toEqual([]);
  });

  it('finds conflicts only when the same topic has different content', () => {
    const a = memory({ content: 'Launch Feb 20', topic: 'launch', scope: { kind: 'org' } });
    const b = memory({ content: 'Launch March 5', topic: 'Launch ', scope: { kind: 'org' } });
    const c = memory({ content: 'launch feb 20', topic: 'launch', scope: { kind: 'org' } });
    expect(findConflicts([a, b])).toHaveLength(1);
    expect(findConflicts([a, c])).toHaveLength(0);
  });
});
