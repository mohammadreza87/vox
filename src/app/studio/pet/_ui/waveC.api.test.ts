import { describe, expect, it, vi } from 'vitest';
import { ciRef, createHttpApi, isPetError, mockOptions } from './api';
import { createMockApi } from './mock';
import { addToHomeScreen, canWrite, homeScreenStatus, requestWriteAccess, shareLink, shareMessage, shareToStory } from './telegram-more';
import type { PetTelegram } from './telegram';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Wave C api (§5, §8.4)', () => {
  it('a check-in\'s ?ci= reference rides on the open (validated: an opaque id, never anything else)', async () => {
    expect(ciRef('?ci=abc_D-9')).toBe('abc_D-9');
    expect(ciRef('?ci=<script>')).toBeNull();
    expect(ciRef(`?ci=${'x'.repeat(65)}`)).toBeNull();
    const fetch = vi.fn(async () => json(200, {}));
    await createHttpApi({ fetch, initData: () => 's', search: () => '?ci=r1&mock=0' }).get('a');
    await createHttpApi({ fetch, initData: () => 's', search: () => '' }).get('a');
    expect((fetch.mock.calls as unknown as [string][]).map((c) => c[0])).toEqual(['/api/studio/pet/a?ci=r1', '/api/studio/pet/a']);
  });

  it('checkins: GET with no request, POST with one; a server without the route never answers pet_unavailable (it would end the pet)', async () => {
    const fetch = vi.fn(async () => json(200, { enabled: true, types: {} }));
    const api = createHttpApi({ fetch, initData: () => 's' });
    await api.checkins!('a');
    await api.checkins!('a', { op: 'stop' });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => [u, i.method, i.body])).toEqual([['/api/studio/pet/a/checkins', 'GET', undefined], ['/api/studio/pet/a/checkins', 'POST', '{"op":"stop"}']]);
    const missing = createHttpApi({ fetch: vi.fn(async () => json(404, { error: 'pet_unavailable' })), initData: () => 's' });
    const e = await missing.checkins!('a').catch((x: unknown) => x);
    expect(isPetError(e) && e.code).toBe('checkins_unavailable');
    expect(isPetError(e) && e.message).toBe('checkins_unavailable');
  });

  it('POSTs to …/checkins and …/look carry the care epoch of the last open (the server fences every pet mutation on it)', async () => {
    const fetch = vi.fn(async (u: string) => json(200, u.endsWith('/look') ? { look: { accessory: 'cap' } } : u.endsWith('/checkins') ? { enabled: true, types: {} } : { careEpoch: 'e7' }));
    const api = createHttpApi({ fetch: fetch as unknown as typeof globalThis.fetch, initData: () => 's', search: () => '' });
    await api.get('a');
    await api.checkins!('a');
    await api.checkins!('a', { op: 'keepPaused' });
    expect(await api.look!('a', { look: { accessory: 'cap' } })).toEqual({ look: { accessory: 'cap' } });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const epoch = (i: number) => (calls[i][1].headers as Record<string, string>)['x-pet-care-epoch'];
    expect(calls.map(([u, i]) => [u, i.method])).toEqual([['/api/studio/pet/a', 'GET'], ['/api/studio/pet/a/checkins', 'GET'], ['/api/studio/pet/a/checkins', 'POST'], ['/api/studio/pet/a/look', 'POST']]);
    expect([epoch(1), epoch(2), epoch(3)]).toEqual([undefined, 'e7', 'e7']);
    expect(calls[3][1].body).toBe('{"look":{"accessory":"cap"}}');
    expect((calls[3][1].headers as Record<string, string>)['X-Telegram-Init-Data']).toBe('s');
  });

  it('the mock: ?garden, ?ci, ?checkins, ?items demos; a check-in replays once; talk turns carry a pet_action', async () => {
    expect(mockOptions('?mock=1&garden=ready&ci=C5&checkins=paused&items=1')).toMatchObject({ garden: 'ready', ci: 'C5', checkins: 'paused', items: true });
    const api = createMockApi({ ci: 'C5', garden: 'ready', checkins: 'paused', items: true, latency: { care: 0, talk: 0 } });
    const v = await api.get('a');
    expect(v).toMatchObject({ checkin: { momentId: 'C5' } });
    expect(v.play?.garden?.state).toBe('ready');
    expect(v.play?.items.map((i) => i.id)).toEqual(['bloomPin', 'starPin']);
    expect((await api.get('a') as { checkin?: unknown }).checkin).toBeUndefined();
    expect(v.checkins).toMatchObject({ pausedNote: true });
    expect((await api.checkins!('a')).pausedNote).toBeUndefined();
    const on = await api.checkins!('a', { op: 'resume' });
    expect(on.enabled).toBe(true);
    expect(on.pausedAt).toBeUndefined();
    expect((await api.checkins!('a', { op: 'stop' })).enabled).toBe(false);
    expect(await api.talk('a', { text: 'time for bed' })).toMatchObject({ action: { kind: 'sleep', confidence: 0.9 } });
    expect(await api.talk('a', { text: 'hello' })).not.toHaveProperty('action');
    const w = await api.play!('a', { op: 'waterSeed' });
    expect(w.play.garden?.state).toBe('blooming');
  });
});

describe('Telegram Wave C wrappers (core.telegram.org/bots/webapps)', () => {
  const app = (o: Partial<PetTelegram> & { version?: string } = {}) => ({ initData: 's', ready() {}, expand() {}, isVersionAtLeast: (v: string) => Number(v) <= Number(o.version ?? '9.0'), ...o }) as PetTelegram;

  it('requestWriteAccess (6.9): the callback\'s boolean; an old client is a quiet no', async () => {
    expect(await requestWriteAccess(app({ requestWriteAccess: (cb) => cb?.(true) }))).toBe(true);
    expect(await requestWriteAccess(app({ requestWriteAccess: (cb) => cb?.(false) }))).toBe(false);
    expect(await requestWriteAccess(app({ version: '6.2', requestWriteAccess: (cb) => cb?.(true) }))).toBe(false);
    expect(await requestWriteAccess(null)).toBe(false);
    expect(canWrite(app({ initDataUnsafe: { user: { id: 1, first_name: 'S', allows_write_to_pm: true } } }))).toBe(true);
  });

  it('home screen (8.0): the status; add resolves on homeScreenAdded', async () => {
    expect(await homeScreenStatus(app({ addToHomeScreen() {}, checkHomeScreenStatus: (cb) => cb?.('missed') }))).toBe('missed');
    expect(await homeScreenStatus(app({ version: '7.10', addToHomeScreen() {}, checkHomeScreenStatus: (cb) => cb?.('missed') }))).toBe('unsupported');
    let added: (() => void) | undefined;
    const a = app({ addToHomeScreen: vi.fn(() => added?.()), onEvent: (e, cb) => { if (e === 'homeScreenAdded') added = cb as () => void; }, offEvent: vi.fn() });
    expect(await addToHomeScreen(a)).toBe(true);
    expect(a.offEvent).toHaveBeenCalledWith('homeScreenAdded', expect.any(Function));
  });

  it('share: shareMessage (8.0) with a prepared id, shareToStory (7.8) only with an HTTPS card, the t.me/share chat picker', async () => {
    expect(await shareMessage('m1', app({ shareMessage: (_id, cb) => cb?.(true) }))).toBe(true);
    const story = vi.fn();
    expect(shareToStory('blob:x', 'hi', app({ shareToStory: story }))).toBe(false);
    expect(shareToStory('https://vox/card.png', 'hi', app({ shareToStory: story }))).toBe(true);
    expect(story).toHaveBeenCalledWith('https://vox/card.png', { text: 'hi' });
    const open = vi.fn();
    expect(shareLink('https://t.me/b', 'Our seed bloomed.', app({ openTelegramLink: open }))).toBe(true);
    expect(open).toHaveBeenCalledWith('https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fb&text=Our%20seed%20bloomed.');
    expect(shareLink('https://t.me/b', 'x', null)).toBe(false);
  });
});
