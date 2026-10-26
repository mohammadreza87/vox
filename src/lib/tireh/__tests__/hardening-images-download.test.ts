/**
 * F262 and F218: an oversize download is classified by TelegramApiError's structural code, not its message;
 * downloadImage cancels a response body it will not read; a deadline that fires while getFile's JSON body is
 * read is reported as a timeout, not as an empty Telegram answer. Offline: fetch is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_DOWNLOAD_TIMEOUT_MS, ingestTelegramImage, type ImageIngestDeps } from '../images';
import { TelegramApiError, TelegramBotClient, type TelegramMessage } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, privateDocument, scriptedDecider, VisionFakeLLM } from './images-fixtures';

const TOKEN = '123456:SECRET-TOKEN-abc';
const org = testOrg();
const persona = org.getPersona('aria')!;
const rezaChat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function ingest(bot: unknown, message: TelegramMessage) {
  const log = { warn: vi.fn() };
  const deps: ImageIngestDeps = {
    org, decider: scriptedDecider({ image: imageAnswers() }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
    bot: bot as ImageIngestDeps['bot'], log,
  };
  return { log, run: () => ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?') };
}

const documentMessage = () => privateDocument(TG.reza, { file_id: 'doc-1', mime_type: 'image/jpeg' }, 'what is this?').message!;

/** A body whose cancel() is a spy; reading it is never needed on the paths under test. */
function cancellableResponse(init: { ok: boolean; status: number; headers?: Record<string, string> }) {
  const cancel = vi.fn(async () => undefined);
  const response = {
    ok: init.ok, status: init.status, headers: new Headers(init.headers ?? {}),
    body: { cancel, getReader: () => { throw new Error('the body must not be read'); } },
    json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
  return { response, cancel };
}

function clientWithFile(download: Response) {
  const fetchFn = vi.fn(async (url: string) => url.includes('/getFile')
    ? new Response(JSON.stringify({ ok: true, result: { file_path: 'documents/a.jpg' } }))
    : download);
  return { fetchFn, bot: new TelegramBotClient(TOKEN, fetchFn as unknown as typeof fetch) };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected a rejection');
}

describe('F262: oversize is read from the structural code', () => {
  it('logs too_large for code file_too_large whatever the message says', async () => {
    const bot = imageBot({});
    bot.downloadImage.mockRejectedValue(Object.assign(new Error('Telegram getFile failed: size limit reached'), { code: 'file_too_large' }));
    const h = ingest(bot, documentMessage());
    expect(await h.run()).toBeNull();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:too_large']]);
  });

  it('a message that only says "file too large" without the code is a plain download failure', async () => {
    const bot = imageBot({});
    bot.downloadImage.mockRejectedValue(new Error('Telegram getFile failed: file too large'));
    const h = ingest(bot, documentMessage());
    expect(await h.run()).toBeNull();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:download_failed']]);
  });

  it('every oversize rejection of downloadImage carries code file_too_large; other failures carry none', async () => {
    const declared = new TelegramBotClient(TOKEN, (async () => new Response(JSON.stringify({ ok: true, result: { file_path: 'a.jpg', file_size: 101 } }))) as unknown as typeof fetch);
    expect(await rejection(declared.downloadImage('f', { maxBytes: 100 }))).toMatchObject({ code: 'file_too_large' });
    const header = clientWithFile(new Response(new Uint8Array(10), { headers: { 'content-length': '5000' } }));
    expect(await rejection(header.bot.downloadImage('f', { maxBytes: 100 }))).toMatchObject({ code: 'file_too_large' });
    const streamed = clientWithFile(new Response(new Uint8Array(101)));
    expect(await rejection(streamed.bot.downloadImage('f', { maxBytes: 100 }))).toMatchObject({ code: 'file_too_large' });
    const failed = clientWithFile(new Response('nope', { status: 500 }));
    const error = await rejection(failed.bot.downloadImage('f', { maxBytes: 100 }));
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect(Object.keys(error as object)).not.toContain('code');
  });
});

describe('F218: response bodies are cancelled before an early throw', () => {
  it('cancels the body on HTTP 500', async () => {
    const { response, cancel } = cancellableResponse({ ok: false, status: 500 });
    const { bot } = clientWithFile(response);
    expect(String(await rejection(bot.downloadImage('f', { maxBytes: 100 })))).toContain('HTTP 500');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the body when content-length is over the cap', async () => {
    const { response, cancel } = cancellableResponse({ ok: true, status: 200, headers: { 'content-length': '5000' } });
    const { bot } = clientWithFile(response);
    expect(await rejection(bot.downloadImage('f', { maxBytes: 100 }))).toMatchObject({ code: 'file_too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('a failing cancel never replaces the error', async () => {
    const { response, cancel } = cancellableResponse({ ok: false, status: 502 });
    cancel.mockRejectedValue(new Error('cancel failed'));
    const { bot } = clientWithFile(response);
    expect(String(await rejection(bot.downloadImage('f', { maxBytes: 100 })))).toContain('HTTP 502');
  });
});

describe('F218: a deadline while getFile is read is a timeout', () => {
  const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  /** getFile answers headers, then its JSON body stalls until the request's signal aborts. */
  function stallingGetFile() {
    return vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true, status: 200, headers: new Headers(),
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true });
      }),
    }) as unknown as Response);
  }

  it('fetchImage logs download_timeout, not download_failed', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => deadline.signal);
    const fetchFn = stallingGetFile();
    const h = ingest(new TelegramBotClient(TOKEN, fetchFn as unknown as typeof fetch), documentMessage());
    const pending = h.run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    deadline.abort(timeoutError());
    expect(await pending).toBeNull();
    expect(timeout).toHaveBeenCalledWith(IMAGE_DOWNLOAD_TIMEOUT_MS);
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:download_timeout']]);
  });

  it('other callers that pass a signal keep their behaviour (an empty answer is a TelegramApiError)', async () => {
    const deadline = new AbortController();
    const fetchFn = stallingGetFile();
    const bot = new TelegramBotClient(TOKEN, fetchFn as unknown as typeof fetch);
    const sending = rejection(bot.sendMessage(TG.reza, 'hello', { signal: deadline.signal }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    deadline.abort(timeoutError());
    expect(await sending).toBeInstanceOf(TelegramApiError);
  });
});
