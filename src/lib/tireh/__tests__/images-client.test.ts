import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from '../telegram/client';

const TOKEN = '123456:SECRET-TOKEN-abc';

function fakeResponse(opts: { json?: unknown; body?: Uint8Array; ok?: boolean; status?: number; headers?: Record<string, string> }) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: new Headers(opts.headers ?? {}),
    json: async () => opts.json,
    arrayBuffer: async () => (opts.body ?? new Uint8Array()).slice().buffer,
  } as unknown as Response;
}

function client(file: { file_path?: string; file_size?: number }, download: Parameters<typeof fakeResponse>[0]) {
  const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => url.includes('/getFile')
    ? fakeResponse({ json: { ok: true, result: file } })
    : fakeResponse(download));
  return { fetchFn, bot: new TelegramBotClient(TOKEN, fetchFn as unknown as typeof fetch) };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error('expected a failure');
}

describe('TelegramBotClient.downloadImage', () => {
  it('calls getFile and then the file URL, returning bytes', async () => {
    const body = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    const { bot, fetchFn } = client({ file_path: 'photos/a.jpg', file_size: 6 }, { body });
    const bytes = await bot.downloadImage('file-1', { maxBytes: 100 });
    expect(Array.from(bytes)).toEqual(Array.from(body));
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      `https://api.telegram.org/bot${TOKEN}/getFile`, `https://api.telegram.org/file/bot${TOKEN}/photos/a.jpg`,
    ]);
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ file_id: 'file-1' });
  });

  it('refuses a declared file_size above maxBytes before downloading', async () => {
    const { bot, fetchFn } = client({ file_path: 'photos/a.jpg', file_size: 101 }, { body: new Uint8Array(10) });
    const error = await failure(bot.downloadImage('file-1', { maxBytes: 100 }));
    expect(error.message).toMatch(/file too large/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a Content-Length above maxBytes', async () => {
    const { bot } = client({ file_path: 'photos/a.jpg' }, { body: new Uint8Array(10), headers: { 'content-length': '5000' } });
    expect((await failure(bot.downloadImage('file-1', { maxBytes: 100 }))).message).toMatch(/file too large/);
  });

  it('refuses a body longer than maxBytes', async () => {
    const { bot } = client({ file_path: 'photos/a.jpg' }, { body: new Uint8Array(101) });
    expect((await failure(bot.downloadImage('file-1', { maxBytes: 100 }))).message).toMatch(/file too large/);
  });

  it('fails without a file_path and on HTTP errors', async () => {
    expect((await failure(client({}, {}).bot.downloadImage('f', { maxBytes: 10 }))).message).toMatch(/no file_path/);
    expect((await failure(client({ file_path: 'x.jpg' }, { ok: false, status: 404 }).bot.downloadImage('f', { maxBytes: 10 }))).message).toMatch(/HTTP 404/);
  });

  it('passes the AbortSignal to both requests', async () => {
    const { bot, fetchFn } = client({ file_path: 'photos/a.jpg' }, { body: new Uint8Array(3) });
    const controller = new AbortController();
    await bot.downloadImage('file-1', { maxBytes: 100, signal: controller.signal });
    expect(fetchFn.mock.calls.map((c) => c[1]?.signal)).toEqual([controller.signal, controller.signal]);
  });

  it('never puts the token or the file URL in an error message', async () => {
    const cases = [
      client({ file_path: 'photos/a.jpg', file_size: 500 }, {}),
      client({ file_path: 'photos/a.jpg' }, { body: new Uint8Array(10), headers: { 'content-length': '500' } }),
      client({ file_path: 'photos/a.jpg' }, { body: new Uint8Array(500) }),
      client({ file_path: 'photos/a.jpg' }, { ok: false, status: 500 }),
      client({}, {}),
    ];
    for (const { bot } of cases) {
      const error = await failure(bot.downloadImage('file-1', { maxBytes: 100 }));
      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain('SECRET');
      expect(error.message).not.toContain('api.telegram.org');
      expect(error.message).not.toContain('photos/a.jpg');
    }
  });
});

describe('TelegramBotClient.downloadFile is unchanged', () => {
  it('still fetches the file URL with no options and returns an ArrayBuffer', async () => {
    const { bot, fetchFn } = client({ file_path: 'voice/a.ogg', file_size: 3 }, { body: Uint8Array.from([1, 2, 3]) });
    const buffer = await bot.downloadFile('voice-1');
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
    expect(fetchFn.mock.calls[1]).toEqual([`https://api.telegram.org/file/bot${TOKEN}/voice/a.ogg`]);
    expect((await failure(client({ file_path: 'v', file_size: 30 * 1024 * 1024 }, {}).bot.downloadFile('v'))).message).toMatch(/file too large/);
  });
});
