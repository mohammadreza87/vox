import { afterEach, describe, it, expect, vi } from 'vitest';
import { TelegramApiError, TelegramBotClient } from '../telegram/client';
import { ElevenLabsVoiceService } from '../voice';
import { createLLMFromEnv, normalizeTurns, AnthropicLLM, GeminiLLM } from '../llm';
import { isValidWebhookSecret } from '../telegram/webhook-auth';
import { botTokenEnvName, getBotToken } from '../runtime';
import { findConflicts, selectMemories } from '../memory/retrieval';
import { memory, testOrg, testOrgConfig } from './fixtures';
import { OrgDirectory } from '../org/directory';
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

  describe('connection timeout retry', () => {
    const fetchFailure = (code = 'UND_ERR_CONNECT_TIMEOUT') => new TypeError('fetch failed', {
      cause: Object.assign(new Error('Synthetic transport failure'), { code }),
    });

    afterEach(() => vi.useRealTimers());

    it('retries two pre-connection failures after 250 ms and 1 second without changing the message', async () => {
      vi.useFakeTimers({ now: 0 });
      const times: number[] = [];
      const fetchFn = vi.fn(async () => {
        times.push(Date.now());
        if (times.length < 3) throw fetchFailure();
        return new Response(JSON.stringify({ ok: true, result: { message_id: 17 } }));
      });
      const bot = new TelegramBotClient('TOKEN', fetchFn as unknown as typeof fetch);
      const result = bot.sendMessage(-42, 'سلام Neda', { replyTo: 7, keyboard: { inline_keyboard: [[{ text: 'OK', callback_data: 'yes' }]] } });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ message_id: 17 });
      expect(times).toEqual([0, 250, 1250]);
      for (const [url, init] of fetchFn.mock.calls as unknown as Array<[string, RequestInit]>) {
        expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({
          chat_id: -42, text: 'سلام Neda',
          reply_parameters: { message_id: 7, allow_sending_without_reply: true },
          reply_markup: { inline_keyboard: [[{ text: 'OK', callback_data: 'yes' }]] },
        });
      }
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops after three attempts and preserves the final original error', async () => {
      vi.useFakeTimers();
      const failures = [fetchFailure(), fetchFailure(), fetchFailure()];
      const fetchFn = vi.fn()
        .mockRejectedValueOnce(failures[0])
        .mockRejectedValueOnce(failures[1])
        .mockRejectedValueOnce(failures[2])
        .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendMessage(42, 'one reply');
      const rejected = expect(result).rejects.toBe(failures[2]);
      await vi.runAllTimersAsync();
      await rejected;
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ['a generic fetch error', new TypeError('fetch failed')],
      ['a code mentioned only in text', new TypeError('UND_ERR_CONNECT_TIMEOUT')],
      ['a socket failure', fetchFailure('UND_ERR_SOCKET')],
      ['a reset connection', fetchFailure('ECONNRESET')],
      ['a response headers timeout', fetchFailure('UND_ERR_HEADERS_TIMEOUT')],
      ['a response body timeout', fetchFailure('UND_ERR_BODY_TIMEOUT')],
      ['an explicit abort', Object.assign(new DOMException('Aborted', 'AbortError'), { cause: fetchFailure().cause })],
      ['an outer timeout', Object.assign(new DOMException('Timed out', 'TimeoutError'), { cause: fetchFailure().cause })],
      ['a wrapped abort', new TypeError('fetch failed', { cause: new DOMException('Aborted', 'AbortError') })],
      ['a mixed aggregate', new TypeError('fetch failed', { cause: new AggregateError([fetchFailure().cause, fetchFailure('UND_ERR_SOCKET').cause]) })],
      ['an unknown nested wrapper', new TypeError('fetch failed', { cause: new Error('Unknown wrapper', { cause: fetchFailure().cause }) })],
    ])('never retries %s because the send outcome is not a known connection timeout', async (_label, failure) => {
      vi.useFakeTimers();
      const fetchFn = vi.fn().mockRejectedValue(failure);
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendMessage(42, 'one reply');
      await expect(result).rejects.toBe(failure);
      await vi.runAllTimersAsync();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops immediately if a retried request then has an ambiguous socket failure', async () => {
      vi.useFakeTimers();
      const ambiguous = fetchFailure('UND_ERR_SOCKET');
      const fetchFn = vi.fn().mockRejectedValueOnce(fetchFailure()).mockRejectedValue(ambiguous);
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendMessage(42, 'one reply');
      const rejected = expect(result).rejects.toBe(ambiguous);
      await vi.runAllTimersAsync();
      await rejected;
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it.each([403, 429, 500])('does not retry a Telegram API response with HTTP %i', async (status) => {
      vi.useFakeTimers();
      const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'Synthetic API refusal' }), { status }));
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendMessage(42, 'one reply');
      await expect(result).rejects.toBeInstanceOf(TelegramApiError);
      await vi.runAllTimersAsync();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('does not resend after receiving a response even if reading its body throws the retry-shaped error', async () => {
      vi.useFakeTimers();
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, 'json').mockRejectedValue(fetchFailure());
      const fetchFn = vi.fn().mockResolvedValue(response);
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendMessage(42, 'already sent');
      await expect(result).rejects.toBeInstanceOf(TelegramApiError);
      await vi.runAllTimersAsync();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('retains multipart audio, caption and reply target when a connection retry succeeds', async () => {
      vi.useFakeTimers();
      const audio = new Uint8Array([3, 1, 4, 1, 5]);
      const fetchFn = vi.fn().mockRejectedValueOnce(fetchFailure()).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 23 } })));
      const result = new TelegramBotClient('T', fetchFn as unknown as typeof fetch).sendVoice(-42, audio.buffer, {
        caption: 'A voice reply', replyTo: 9, mimeType: 'audio/ogg', filename: 'reply.ogg',
      });
      await vi.runAllTimersAsync();
      await expect(result).resolves.toMatchObject({ message_id: 23 });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      // jsdom's File implements FileReader rather than Blob.arrayBuffer().
      vi.useRealTimers();
      for (const [url, init] of fetchFn.mock.calls as Array<[string, RequestInit]>) {
        expect(url).toBe('https://api.telegram.org/botT/sendVoice');
        expect(init.headers).toBeUndefined();
        const body = init.body as FormData;
        expect(body.get('chat_id')).toBe('-42');
        expect(body.get('caption')).toBe('A voice reply');
        expect(JSON.parse(body.get('reply_parameters') as string)).toEqual({ message_id: 9, allow_sending_without_reply: true });
        const file = body.get('voice') as File;
        expect(file.name).toBe('reply.ogg');
        expect(file.type).toBe('audio/ogg');
        const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        });
        expect(new Uint8Array(bytes)).toEqual(audio);
      }
    });
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

  it.each([false, true])('keeps DM and wider-scope memory out of a single-human group (hasGuests=%s)', (hasGuests) => {
    const config = testOrgConfig();
    const room = { id: 'solo', name: 'Solo', telegramChatId: -7001, memberIds: ['reza'], hasGuests };
    config.groups.push(room);
    const directory = new OrgDirectory(config);
    const chat: ChatContext = { kind: 'group', chatKey: 'group-solo', group: room };
    const records = [
      memory({ id: 'private', content: 'PRIVATE_CANARY', scope: { kind: 'private', personId: 'reza' } }),
      memory({ id: 'personal', content: 'PERSONAL_CANARY', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal' }),
      memory({ id: 'project', content: 'PROJECT_CANARY', scope: { kind: 'project', projectId: 'gameend' } }),
      memory({ id: 'company', content: 'COMPANY_CANARY', scope: { kind: 'company', companyId: 'ludaxis' } }),
      memory({ id: 'org', content: 'ORG_CANARY', scope: { kind: 'org' } }),
      memory({ id: 'local', content: 'LOCAL_GROUP_FACT', scope: { kind: 'group', groupId: room.id }, authorizedPersonIds: [...room.memberIds] }),
    ];
    expect(selectMemories(directory, records, chat, { query: 'CANARY', now }).map((m) => m.id)).toEqual(hasGuests ? [] : ['local']);
  });

  it('does not infer cross-group sharing from identical members', () => {
    const config = testOrgConfig();
    const mirror = { id: 'other-leads', name: 'Other leads', telegramChatId: -7002, memberIds: ['reza', 'parastoo'], hasGuests: false };
    config.groups.push(mirror);
    const directory = new OrgDirectory(config);
    const records = [
      memory({ id: 'other', content: 'OTHER_GROUP_CANARY', scope: { kind: 'group', groupId: 'leads' } }),
      memory({ id: 'local', content: 'LOCAL_GROUP_FACT', scope: { kind: 'group', groupId: mirror.id }, authorizedPersonIds: [...mirror.memberIds] }),
    ];
    const chat: ChatContext = { kind: 'group', chatKey: 'group-other-leads', group: mirror };
    expect(selectMemories(directory, records, chat, { query: 'CANARY', now }).map((m) => m.id)).toEqual(['local']);
  });

  it('finds conflicts only when the same topic has different content', () => {
    const a = memory({ content: 'Launch Feb 20', topic: 'launch', scope: { kind: 'org' } });
    const b = memory({ content: 'Launch March 5', topic: 'Launch ', scope: { kind: 'org' } });
    const c = memory({ content: 'launch feb 20', topic: 'launch', scope: { kind: 'org' } });
    expect(findConflicts([a, b])).toHaveLength(1);
    expect(findConflicts([a, c])).toHaveLength(0);
  });
});
