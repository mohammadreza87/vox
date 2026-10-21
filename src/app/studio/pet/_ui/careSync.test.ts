import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareResponse, PetCare } from '@/lib/pet/types';
import { CareSync, type CareUpdate } from './careSync';
import type { PetApi } from './contract';

const T0 = Date.UTC(2026, 9, 21, 12);
const base = (o: Partial<PetCare> = {}): PetCare => ({
  v: 1, agentId: 'a', userId: 1, tummy: 50, joy: 50, energy: 80, bond: 3, asleep: false,
  lastUpdatedAt: T0, lastSeenAt: T0, firstMetAt: T0, tz: 'UTC', quietStart: 22, quietEnd: 8, lastSeenStage: 2,
  caps: { hourStart: T0, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: T0 }, ...o,
});

function deferred<T>() { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; }

describe('CareSync (optimistic care)', () => {
  let updates: CareUpdate[];
  let care: ReturnType<typeof vi.fn>;
  let sync: CareSync;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    updates = [];
    care = vi.fn();
    sync = new CareSync({ api: { care } as unknown as PetApi, agentId: 'a', onCare: (u) => updates.push(u) });
    sync.adopt(base(), T0);
  });
  afterEach(() => { sync.dispose(); vi.useRealTimers(); });

  it('applies a finished action at once, then eases to the server answer', async () => {
    const answer = deferred<CareResponse>();
    care.mockReturnValueOnce(answer.p);
    sync.act('feed');
    expect(updates.at(-1)).toMatchObject({ source: 'local', action: 'feed', care: { tummy: 85 } });
    expect(care).toHaveBeenCalledWith('a', { action: 'feed' });
    answer.resolve({ care: base({ tummy: 84 }), now: T0 });
    await vi.runAllTimersAsync();
    expect(updates.at(-1)).toMatchObject({ source: 'server', care: { tummy: 84 } });
  });

  it('batches pet/tickle taps into one request per kind every 2 s', async () => {
    care.mockResolvedValue({ care: base({ joy: 56 }), now: T0 });
    sync.act('pet');
    sync.act('pet');
    sync.act('pet');
    sync.act('tickle', 2);
    expect(care).not.toHaveBeenCalled();
    expect(updates.at(-1)!.care.joy).toBe(60);
    await vi.advanceTimersByTimeAsync(2000);
    expect(care.mock.calls).toEqual([['a', { action: 'pet', n: 3 }], ['a', { action: 'tickle', n: 2 }]]);
  });

  it('never lets a late answer overwrite a newer one', async () => {
    const first = deferred<CareResponse>(), second = deferred<CareResponse>();
    care.mockReturnValueOnce(first.p).mockReturnValueOnce(second.p);
    sync.act('feed');
    sync.act('play');
    second.resolve({ care: base({ tummy: 85, joy: 75 }), now: T0 });
    await vi.runAllTimersAsync();
    first.resolve({ care: base({ tummy: 85 }), now: T0 });
    await vi.runAllTimersAsync();
    expect(sync.current!.joy).toBe(75);
  });

  it('re-applies taps still waiting for their flush on top of a server answer', async () => {
    care.mockResolvedValueOnce({ care: base({ tummy: 85 }), now: T0 }).mockResolvedValueOnce({ care: base({ tummy: 85, joy: 54 }), now: T0 });
    sync.act('feed');
    sync.act('pet', 2);
    await vi.runAllTimersAsync();
    // the feed answer arrived before the pet flush: Joy keeps the two taps
    const feedAnswer = updates.find((u) => u.source === 'server' && u.action === 'feed');
    expect(feedAnswer!.care.joy).toBe(54);
  });

  it('keeps actions still in flight on top of an older answer (no flicker), and a stale answer still reports its milestone', async () => {
    const first = deferred<CareResponse>(), second = deferred<CareResponse>();
    care.mockReturnValueOnce(first.p).mockReturnValueOnce(second.p);
    sync.act('feed');
    sync.act('play');
    expect(sync.current!.joy).toBe(75);
    first.resolve({ care: base({ tummy: 85, bond: 4 }), now: T0 });
    await vi.runAllTimersAsync();
    // the feed answer lands while play is in flight: Joy does not jump back to 50
    expect(updates.filter((u) => u.source === 'server').map((u) => u.care.joy)).toEqual([50, 75]);
    second.resolve({ care: base({ tummy: 85, joy: 75, bond: 5 }), now: T0 });
    await vi.runAllTimersAsync();
    expect(sync.current).toMatchObject({ joy: 75, bond: 5 });

    // the other order: the newest lands first, the older one is stale but its milestone still plays
    const a = deferred<CareResponse>(), b = deferred<CareResponse>();
    care.mockReturnValueOnce(a.p).mockReturnValueOnce(b.p);
    sync.act('sleep');
    sync.act('wake');
    b.resolve({ care: base({ bond: 6 }), now: T0 });
    await vi.runAllTimersAsync();
    a.resolve({ care: base({ bond: 25, asleep: true }), now: T0, bondMilestone: 0 });
    await vi.runAllTimersAsync();
    expect(updates.at(-1)).toMatchObject({ source: 'server', action: 'sleep', bondMilestone: 0, care: { bond: 6, asleep: false } });
  });

  it('a flush on hide asks for keepalive requests', async () => {
    care.mockResolvedValue({ care: base(), now: T0 });
    sync.act('pet', 2);
    await sync.flush({ keepalive: true });
    expect(care).toHaveBeenCalledWith('a', { action: 'pet', n: 2 }, { keepalive: true });
  });

  it('passes the server guard through so the page can play the cute reaction', async () => {
    care.mockResolvedValueOnce({ care: base({ energy: 20 }), now: T0, guard: 'tired' });
    sync.act('play');
    await vi.runAllTimersAsync();
    expect(updates.at(-1)).toMatchObject({ source: 'server', action: 'play', guard: 'tired' });
  });

  it('keeps the optimistic value when a post fails', async () => {
    const onError = vi.fn();
    const s = new CareSync({ api: { care: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as PetApi, agentId: 'a', onCare: () => {}, onError });
    s.adopt(base(), T0);
    s.act('feed');
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalled();
    expect(s.current!.tummy).toBe(85);
  });
});
