import { describe, expect, it, vi } from 'vitest';
import { TelegramApiError, TelegramBotClient } from '../telegram/client';

const TOKEN = '123456:S12_FAKE_BOT_TOKEN_CANARY';
const FILE_PATH = 'photos/S12_FILE_PATH_CANARY.jpg';

function getFileResponse(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function fileResponse(options: { status?: number; contentLength?: string; body?: Uint8Array }) {
  const body = options.body ?? new Uint8Array([1, 2, 3]);
  const arrayBuffer = vi.fn(async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  const headers = new Headers(options.contentLength !== undefined ? { 'content-length': options.contentLength } : {});
  return { response: { ok: (options.status ?? 200) < 400, status: options.status ?? 200, headers, arrayBuffer } as unknown as Response, arrayBuffer };
}

function client(...responses: Response[]) {
  const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  });
  return { bot: new TelegramBotClient(TOKEN, fetchFn as unknown as typeof fetch), fetchFn };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error('expected a rejection');
}

describe('TelegramBotClient.downloadImage', () => {
  it('refuses a file whose reported size is over the cap without fetching it', async () => {
    const { bot, fetchFn } = client(getFileResponse({ file_path: FILE_PATH, file_size: 2048 }));
    const error = await rejection(bot.downloadImage('file-1', { maxBytes: 1024 }));
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.message).toContain('file too large');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing file_path', async () => {
    const { bot } = client(getFileResponse({}));
    expect((await rejection(bot.downloadImage('file-1', { maxBytes: 1024 }))).message).toContain('no file_path');
  });

  it('refuses an oversized content-length before reading the body', async () => {
    const file = fileResponse({ contentLength: '4096' });
    const { bot } = client(getFileResponse({ file_path: FILE_PATH }), file.response);
    expect((await rejection(bot.downloadImage('file-1', { maxBytes: 1024 }))).message).toContain('file too large');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses an oversized body without a content-length', async () => {
    const file = fileResponse({ body: new Uint8Array(2048) });
    const { bot } = client(getFileResponse({ file_path: FILE_PATH }), file.response);
    expect((await rejection(bot.downloadImage('file-1', { maxBytes: 1024 }))).message).toContain('file too large');
  });

  it('reports an HTTP failure without the token or file path', async () => {
    const file = fileResponse({ status: 404 });
    const { bot } = client(getFileResponse({ file_path: FILE_PATH }), file.response);
    const error = await rejection(bot.downloadImage('file-1', { maxBytes: 1024 }));
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.message).toContain('HTTP 404');
    const serialized = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain('S12_FAKE_BOT_TOKEN_CANARY');
    expect(serialized).not.toContain('S12_FILE_PATH_CANARY');
  });

  it('passes the abort signal to both requests and returns the body bytes', async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff, 7, 8, 9]);
    const file = fileResponse({ body, contentLength: String(body.length) });
    const { bot, fetchFn } = client(getFileResponse({ file_path: FILE_PATH, file_size: body.length }), file.response);
    const signal = new AbortController().signal;
    const bytes = await bot.downloadImage('file-1', { maxBytes: 1024, signal });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...body]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[0][1] as RequestInit).signal).toBe(signal);
    expect((fetchFn.mock.calls[1][1] as RequestInit).signal).toBe(signal);
    expect(String(fetchFn.mock.calls[0][0])).toMatch(/\/getFile$/);
    expect(JSON.parse(String((fetchFn.mock.calls[0][1] as RequestInit).body))).toEqual({ file_id: 'file-1' });
    expect(String(fetchFn.mock.calls[1][0])).toContain(`/file/bot${TOKEN}/${FILE_PATH}`);
  });
});
