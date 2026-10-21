import { describe, expect, it, vi } from 'vitest';
import { TelegramApiError, TelegramBotClient } from './client';

function fakeFetch(result: unknown = true) {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true, result })));
}

/** The test DOM's Blob predates Blob.arrayBuffer(). */
function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('setMyProfilePhoto wire shape (Bot API 9.4, InputProfilePhotoStatic)', () => {
  it('posts multipart with a static photo attached as a JPEG file and no JSON content type', async () => {
    const fetch = fakeFetch();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await new TelegramBotClient('123:abc', fetch).setMyProfilePhoto(jpeg)).toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.telegram.org/bot123:abc/setMyProfilePhoto');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeUndefined();
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('photo')).toBe('{"type":"static","photo":"attach://avatar"}');
    const file = form.get('avatar') as Blob & { name?: string };
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('avatar.jpg');
    expect(Buffer.from(await bytes(file)).equals(jpeg)).toBe(true);
  });

  it('surfaces a refusal as a TelegramApiError', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: PHOTO_INVALID' })));
    await expect(new TelegramBotClient('123:abc', fetch).setMyProfilePhoto(Buffer.from('x'))).rejects.toBeInstanceOf(TelegramApiError);
  });
});
