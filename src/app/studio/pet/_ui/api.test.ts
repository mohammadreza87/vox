import { describe, expect, it, vi } from 'vitest';
import { FULL_AT, PET_TZ_HEADER } from '@/lib/pet/types';
import { createHttpApi, createPetApi, isPetError, mockOptions } from './api';
import { createMockApi } from './mock';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('pet api', () => {
  it('signs every call with initData and the zone header, GET included', async () => {
    const fetch = vi.fn(async () => json(200, { reply: 'hi' }));
    const api = createHttpApi({ fetch, initData: () => 'signed', tz: () => 'Asia/Tehran' });
    await api.get('a 1').catch(() => {});
    await api.talk('a 1', { text: 'yo' });
    const [getUrl, getInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const [talkUrl, talkInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(getUrl).toBe('/api/studio/pet/a%201');
    expect(getInit.method).toBe('GET');
    expect(getInit.body).toBeUndefined();
    expect(talkUrl).toBe('/api/studio/pet/a%201/talk');
    for (const init of [getInit, talkInit]) {
      expect((init.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe('signed');
      expect((init.headers as Record<string, string>)[PET_TZ_HEADER]).toBe('Asia/Tehran');
    }
    expect(JSON.parse(talkInit.body as string)).toEqual({ text: 'yo' });
  });

  it('posts voice as multipart `audio`', async () => {
    const fetch = vi.fn(async () => json(200, { transcript: 't', reply: 'r' }));
    await createHttpApi({ fetch, initData: () => 'x' }).talkVoice('a', new Blob(['x'], { type: 'audio/mp4' }));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/studio/pet/a/talk-voice');
    expect((init.body as FormData).get('audio')).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('keeps the private body (look and stage) so the page can draw the sleeper', async () => {
    const body = { error: 'pet_private', name: 'Mochi', look: { hue: 'sky' }, stage: 2 };
    const api = createHttpApi({ fetch: vi.fn(async () => json(403, body)), initData: () => 'x' });
    const err = await api.get('a').catch((e: unknown) => e);
    expect(isPetError(err)).toBe(true);
    expect(err).toMatchObject({ status: 403, code: 'pet_private', body });
  });

  it('reports fetch failures as `network`', async () => {
    const api = createHttpApi({ fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }), initData: () => 'x' });
    await expect(api.care('a', { action: 'feed' })).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('switches to the in-memory fake with ?mock=1', () => {
    expect(mockOptions('?mock=1&look=3&role=guest&stage=2')).toEqual({ look: 3, stage: 2, role: 'guest', welcome: false, stageUp: false });
    expect(mockOptions('?look=3')).toBeNull();
    const fetch = vi.spyOn(globalThis, 'fetch');
    void createPetApi('?mock=1').get('x');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});

describe('mock api', () => {
  // noon UTC: never in quiet hours whatever the test runner's zone offset… unless it is far east/west, so pin the zone
  const day = Date.UTC(2026, 9, 21, 12);

  it('applies care.ts locally: feed fills Tummy, a full tummy answers `full`', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(day);
    try {
      const api = createMockApi({ latency: { care: 0, talk: 0 } });
      const p = api.get('x');
      await vi.runAllTimersAsync();
      const v = await p;
      const before = v.care.tummy;
      const fed = api.care('x', { action: 'feed' });
      await vi.runAllTimersAsync();
      const r = await fed;
      if (before < FULL_AT) expect(r.care.tummy).toBeGreaterThan(before);
      expect(r.now).toBe(Date.now());
      let last = r;
      for (let i = 0; i < 4; i++) { const q = api.care('x', { action: 'feed' }); await vi.runAllTimersAsync(); last = await q; }
      expect(last.guard).toBe('full');
    } finally { vi.useRealTimers(); }
  });

  it('plays welcome-back once and answers talk with canned lines and a goodbye', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(day);
    try {
      const api = createMockApi({ welcome: true, latency: { care: 0, talk: 0 } });
      let p: Promise<unknown> = api.get('x');
      await vi.runAllTimersAsync();
      expect(await p).toMatchObject({ welcome: { souvenir: expect.any(String) } });
      p = api.get('x');
      await vi.runAllTimersAsync();
      expect(await p).not.toHaveProperty('welcome');
      p = api.talk('x', { text: 'good night!' });
      await vi.runAllTimersAsync();
      expect(await p).toMatchObject({ goodbye: true, reply: expect.any(String) });
    } finally { vi.useRealTimers(); }
  });

  it('a private agent answers 403 with the look; a guest cannot talk on the page', async () => {
    vi.useFakeTimers();
    try {
      const priv = createMockApi({ role: 'private' }).get('x').catch((e: unknown) => e);
      const guest = createMockApi({ role: 'guest', latency: { talk: 0 } }).talk('x', { text: 'hi' }).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await priv).toMatchObject({ status: 403, code: 'pet_private', body: { look: expect.any(Object) } });
      expect(await guest).toMatchObject({ status: 403, code: 'guest_talk' });
    } finally { vi.useRealTimers(); }
  });
});
