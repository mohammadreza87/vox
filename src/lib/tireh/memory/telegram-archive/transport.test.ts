import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from '../../telegram/client';
import { TelegramArchiveTransport } from './transport';

describe('Telegram archive transport', () => {
  it('uploads an immutable document silently to the fixed owner DM', async () => {
    const fetcher = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 8,
      chat: { id: 42, type: 'private' }, document: { file_id: 'file8' } } }) });
    const transport = new TelegramArchiveTransport(new TelegramBotClient('synthetic', fetcher), () => true);
    expect(await transport.upload(42, 'vox-events-123.json', new Uint8Array([1]), () => true)).toEqual({ fileId: 'file8', messageId: 8 });
    const body = fetcher.mock.calls[0][1].body as FormData;
    expect(body.get('chat_id')).toBe('42'); expect(body.get('disable_notification')).toBe('true');
  });
  it('rejects an upload when the actual dispatch fence is stale', async () => {
    const fetcher = vi.fn();
    const transport = new TelegramArchiveTransport(new TelegramBotClient('synthetic', fetcher), () => false);
    await expect(transport.upload(42, 'vox-events-123.json', new Uint8Array([1]), () => true)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not replay an uncertain document upload', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Socket response lost'));
    const transport = new TelegramArchiveTransport(new TelegramBotClient('synthetic', fetcher), () => true);
    await expect(transport.upload(42, 'vox-events-123.json', new Uint8Array([1]), () => true)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds streamed bytes even when getFile and headers omit the size', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined), reader = { read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(4) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(4) }), cancel, releaseLock: vi.fn() };
    const fetcher = vi.fn().mockResolvedValueOnce({ json: async () => ({ ok: true, result: { file_path: 'safe/file' } }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers(), body: { getReader: () => reader } });
    const bot = new TelegramBotClient('synthetic', fetcher);
    await expect(bot.downloadDocument('file1', { maxBytes: 6, authorizeNow: () => true })).rejects.toThrow('Archive file too large');
    expect(cancel).toHaveBeenCalledOnce(); expect(reader.releaseLock).toHaveBeenCalledOnce();
  });
  it('rechecks current authority after an async file read', async () => {
    let allowed = true;
    const cancel = vi.fn().mockResolvedValue(undefined), reader = { read: async () => { allowed = false; return { done: false, value: new Uint8Array([1]) }; },
      cancel, releaseLock: vi.fn() };
    const fetcher = vi.fn().mockResolvedValueOnce({ json: async () => ({ ok: true, result: { file_path: 'safe/file' } }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers(), body: { getReader: () => reader } });
    await expect(new TelegramBotClient('synthetic', fetcher).downloadDocument('file1', { maxBytes: 6, authorizeNow: () => allowed })).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
