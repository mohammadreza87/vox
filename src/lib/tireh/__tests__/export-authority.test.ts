import {afterEach, describe, expect, it, vi} from 'vitest';
import {ElevenLabsStudio, StudioVoiceService} from '../../studio/media';
import {ElevenLabsVoiceService, ExportAuthorityError, type ExportAuthority} from '../voice';
import {TelegramBotClient} from '../telegram/client';

afterEach(() => {vi.useRealTimers();});
const canary = 'SYNTHETIC_AUTHORIZED_SPEECH';
const audio = () => new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'audio/mpeg'}});
const accepted = () => new Response(JSON.stringify({ok: true, result: {message_id: 10, chat: {id: 123, type: 'private'}}}), {headers: {'content-type': 'application/json'}});
const connectTimeout = () => new TypeError('synthetic connect failure', {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}});
function speech(kind: 'studio' | 'gateway' | 'delegated', fetcher: typeof fetch) {
  if (kind === 'studio') {
    const adapter = new ElevenLabsStudio('synthetic-key', fetcher);
    return {qualified: adapter.committedTtsExportFence, run: (text: string, authority?: ExportAuthority) => adapter.speak(text, 'synthetic-voice', authority)};
  }
  const adapter = kind === 'gateway' ? new ElevenLabsVoiceService('synthetic-key', fetcher)
    : new StudioVoiceService(null, new ElevenLabsStudio('synthetic-key', fetcher));
  return {qualified: adapter.committedExportFence, run: (text: string, authority?: ExportAuthority) => adapter.synthesize(text, 'synthetic-voice', authority)};
}

describe.each(['studio', 'gateway', 'delegated'] as const)('%s qualified speech transport', kind => {
  it('checks authority at actual fetch and forwards signal without serializing guards', async () => {
    const events: string[] = [], controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {events.push('fetch'); expect(init?.signal).toBe(controller.signal); expect(JSON.parse(String(init?.body))).toMatchObject({text: canary}); expect(String(init?.body)).not.toMatch(/authorizeNow|signal/); return audio();});
    const adapter = speech(kind, fetcher); expect(adapter.qualified).toBe(true);
    await adapter.run(canary, {signal: controller.signal, authorizeNow: () => {events.push('guard'); return true;}});
    expect(events).toEqual(['guard', 'fetch']); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('denies revocation during payload preparation before the configured fetch', async () => {
    let allowed = true;
    const text = {slice: () => {allowed = false; return canary;}} as unknown as string;
    const fetcher = vi.fn<typeof fetch>(async () => audio());
    await expect(speech(kind, fetcher).run(text, {authorizeNow: () => allowed})).rejects.toBeInstanceOf(ExportAuthorityError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies aborted, throwing and asynchronous guards without transport', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => audio()), adapter = speech(kind, fetcher), controller = new AbortController(); controller.abort();
    await expect(adapter.run(canary, {signal: controller.signal, authorizeNow: () => true})).rejects.toBeInstanceOf(ExportAuthorityError);
    await expect(adapter.run(canary, {authorizeNow: () => {throw Error('synthetic');}})).rejects.toBeInstanceOf(ExportAuthorityError);
    await expect(adapter.run(canary, {authorizeNow: (() => Promise.reject(Error('synthetic async denial'))) as unknown as () => boolean})).rejects.toBeInstanceOf(ExportAuthorityError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('qualified Telegram send transport', () => {
  it('sends text/voice once with the current guard and signal only in transport options', async () => {
    const controller = new AbortController(), guard = vi.fn(() => true), bodies: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {expect(init?.signal).toBe(controller.signal); bodies.push(init?.body); return accepted();});
    const client = new TelegramBotClient('synthetic-token', fetcher); expect(client.committedSendFence).toBe(true);
    await client.sendMessage(123, canary, {authorizeNow: guard, signal: controller.signal});
    await client.sendVoice(123, new Uint8Array([1, 2]).buffer, {authorizeNow: guard, signal: controller.signal});
    expect(fetcher).toHaveBeenCalledTimes(2); expect(guard).toHaveBeenCalledTimes(2);
    expect(String(bodies[0])).not.toMatch(/authorizeNow|signal/); expect(JSON.parse(String(bodies[0]))).toMatchObject({text: canary});
    expect(bodies[1]).toBeInstanceOf(FormData); expect((bodies[1] as FormData).has('authorizeNow')).toBe(false);
  });
  it('rechecks after a known pre-send connect failure and never exports after revocation', async () => {
    vi.useFakeTimers(); let allowed = true;
    const guard = vi.fn(() => allowed), fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(connectTimeout()).mockImplementation(async () => accepted());
    const client = new TelegramBotClient('synthetic-token', fetcher), request = client.sendMessage(123, canary, {authorizeNow: guard});
    const denial = expect(request).rejects.toBeInstanceOf(ExportAuthorityError);
    await Promise.resolve(); allowed = false; await vi.advanceTimersByTimeAsync(250); await denial;
    expect(fetcher).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(2);
  });
  it('allows an authorized connect retry but never retries an ambiguous response failure', async () => {
    vi.useFakeTimers(); const guard = vi.fn(() => true);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(connectTimeout()).mockImplementation(async () => accepted());
    const client = new TelegramBotClient('synthetic-token', fetcher), request = client.sendMessage(123, canary, {authorizeNow: guard});
    await vi.advanceTimersByTimeAsync(250); await request;
    expect(fetcher).toHaveBeenCalledTimes(2); expect(guard).toHaveBeenCalledTimes(2);
    fetcher.mockClear().mockRejectedValueOnce(new TypeError('synthetic read timeout', {cause: {code: 'UND_ERR_HEADERS_TIMEOUT'}}));
    await expect(client.sendMessage(123, canary, {authorizeNow: guard})).rejects.toThrow('synthetic read timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending retry immediately and sends no next attempt', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), fetcher = vi.fn<typeof fetch>().mockRejectedValue(connectTimeout());
    const request = new TelegramBotClient('synthetic-token', fetcher).sendMessage(123, canary, {authorizeNow: () => true, signal: controller.signal});
    const denied = expect(request).rejects.toBeInstanceOf(ExportAuthorityError);
    await Promise.resolve(); controller.abort(); await denied;
    await vi.advanceTimersByTimeAsync(2000); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses an already revoked or aborted send before any fetch', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => accepted()), client = new TelegramBotClient('synthetic-token', fetcher), controller = new AbortController(); controller.abort();
    await expect(client.sendMessage(123, canary, {authorizeNow: () => false})).rejects.toBeInstanceOf(ExportAuthorityError);
    await expect(client.sendVoice(123, new ArrayBuffer(1), {signal: controller.signal})).rejects.toBeInstanceOf(ExportAuthorityError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
