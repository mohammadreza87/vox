/**
 * H5 (F032, F078, F087, F133, F178, F217): the voiceprint retention sweep reads membership once per sweep, iterates
 * key fields only (never a sealed template), deletes expired and non-member rows, runs daily on an unref'd timer and
 * reports a content-free 'sweep_failed' instead of failing silently.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioState } from '../types';
import { eligibleMembers } from '../identity';
import { FirestoreVoiceprintStore, InMemoryVoiceprintStore, VOICEPRINT_KEY_PAGE, type VoiceprintRow, type VoiceSpace } from '../identity/store';
import { MAX_TEMPLATE_AGE_MS, startVoiceprintSweep, VoiceprintService, VOICEPRINT_SWEEP_EVERY_MS } from '../identity/voice';
import { fakeFirestore } from './fake-firestore';
import { setupVoiceprints, VP_NOW } from './voiceprint-fixtures';

const row = (telegramId: number, space: VoiceSpace = 'work', createdAt = new Date(VP_NOW)): VoiceprintRow => ({
  personId: `tg-${telegramId}`, space, provider: 'fake-vp', modelVersion: 'fake-vp:1', channel: 'mini_app',
  consentEventId: `event-${telegramId}`, createdAt, template: `vp1.k.iv.tag.TEMPLATE_CANARY_${telegramId}`,
});

/** A sweep-only service: the sweep touches nothing but the store and membership. */
function sweeper(store: InMemoryVoiceprintStore | FirestoreVoiceprintStore, o: {
  eligiblePeople?: () => Promise<ReadonlySet<number>>; eligiblePerson?: (id: number) => Promise<boolean>; now?: number;
} = {}) {
  return new VoiceprintService({
    adaptive: {} as never, store, cipher: {} as never, thresholds: null, orgKey: 'HOOR',
    eligiblePerson: o.eligiblePerson ?? (async () => true),
    ...(o.eligiblePeople ? { eligiblePeople: o.eligiblePeople } : {}),
    now: () => o.now ?? VP_NOW,
  });
}

afterEach(() => { vi.useRealTimers(); });

describe('voiceprint sweep: one membership read, key fields only (H5)', () => {
  it('reads membership once for N rows and deletes expired and demoted rows only', async () => {
    const store = new InMemoryVoiceprintStore();
    for (const id of [1, 2, 3, 4, 5]) await store.put(row(id));
    await store.put(row(6, 'personal', new Date(VP_NOW - MAX_TEMPLATE_AGE_MS - 1)));
    // 1-4 and 6 are members, 5 was demoted to pending.
    const state = { members: [1, 2, 3, 4, 6].map(telegramId => ({ telegramId, role: 'member' })).concat([{ telegramId: 5, role: 'pending' }]) };
    const readState = vi.fn(async () => state);
    const eligiblePerson = vi.fn(async () => true);
    const service = sweeper(store, { eligiblePerson, eligiblePeople: async () => eligibleMembers((await readState()).members as StudioState['members']) });
    expect(await service.sweep()).toBe(2);
    expect(readState).toHaveBeenCalledTimes(1);
    expect(eligiblePerson).not.toHaveBeenCalled();
    expect((await store.list()).map(r => r.personId).sort()).toEqual(['tg-1', 'tg-2', 'tg-3', 'tg-4']);
  });

  it('eligibleMembers keeps eligiblePerson\'s rule: pending and duplicated ids are not eligible', () => {
    const people = eligibleMembers([
      { telegramId: 1, role: 'owner' }, { telegramId: 2, role: 'member' }, { telegramId: 3, role: 'pending' },
      { telegramId: 4, role: 'admin' }, { telegramId: 4, role: 'member' },
    ] as StudioState['members']);
    expect([...people].sort()).toEqual([1, 2]);
  });

  it('a failed membership read deletes only expired rows, then rejects so the caller gets a signal', async () => {
    const store = new InMemoryVoiceprintStore();
    await store.put(row(1));
    await store.put(row(2, 'work', new Date(VP_NOW - MAX_TEMPLATE_AGE_MS - 1)));
    const service = sweeper(store, { eligiblePeople: async () => { throw new Error('state unavailable'); }, eligiblePerson: async () => false });
    await expect(service.sweep()).rejects.toThrow('voiceprint_membership_unavailable');
    expect((await store.list()).map(r => r.personId)).toEqual(['tg-1']);
  });

  it('without eligiblePeople it falls back to eligiblePerson per row (existing behaviour)', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.members.set(s.telegramId, false);
    s.eligiblePerson.mockClear();
    expect(await s.service.sweep()).toBe(1);
    expect(s.eligiblePerson).toHaveBeenCalledTimes(1);
  });

  it('never calls store.list() (which returns sealed templates)', async () => {
    const store = new InMemoryVoiceprintStore();
    await store.put(row(1));
    const list = vi.spyOn(store, 'list');
    await sweeper(store, { eligiblePeople: async () => new Set<number>() }).sweep();
    expect(list).not.toHaveBeenCalled();
    expect(await store.get('tg-1', 'work')).toBeNull();
  });
});

describe('FirestoreVoiceprintStore.listKeys (H5)', () => {
  it('pages by document id with a field mask that leaves the template out, across more than one page', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreVoiceprintStore(fake.db);
    const total = VOICEPRINT_KEY_PAGE + 5;
    for (let id = 1; id <= total; id++) await store.put(row(id));
    const keys = [];
    for await (const key of store.listKeys()) keys.push(key);
    expect(keys).toHaveLength(total);
    expect(new Set(keys.map(k => k.personId)).size).toBe(total);
    for (const key of keys) {
      expect(Object.keys(key).sort()).toEqual(['createdAt', 'personId', 'space']);
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.createdAt.getTime()).toBe(VP_NOW);
    }
    const reads = fake.queries.filter(q => q.collection === 'vox_voiceprints');
    expect(reads).toHaveLength(2);
    for (const q of reads) {
      expect(q.select).toEqual(['personId', 'space', 'createdAt']);
      expect(q.select).not.toContain('template');
      expect(q.orderBy).toBe('__name__');
      expect(q.limit).toBe(VOICEPRINT_KEY_PAGE);
    }
    expect(reads[0].startAfter).toBeUndefined();
    expect(typeof reads[1].startAfter).toBe('string');
    expect(reads.map(q => q.returned)).toEqual([VOICEPRINT_KEY_PAGE, 5]);
    expect(JSON.stringify(keys)).not.toContain('TEMPLATE_CANARY');
  });

  it('the sweep on Firestore deletes expired and non-member rows while it pages', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreVoiceprintStore(fake.db);
    const total = VOICEPRINT_KEY_PAGE + 3;
    for (let id = 1; id <= total; id++) await store.put(row(id, 'work', new Date(id % 2 ? VP_NOW : VP_NOW - MAX_TEMPLATE_AGE_MS - 1)));
    const members = new Set<number>(Array.from({ length: total }, (_, i) => i + 1).filter(id => id !== 1));
    const readState = vi.fn(async () => members);
    const removed = await sweeper(store, { eligiblePeople: readState }).sweep();
    expect(readState).toHaveBeenCalledTimes(1);
    // Every even id is expired; id 1 is not a member.
    const expected = Math.floor(total / 2) + 1;
    expect(removed).toBe(expected);
    const left = [];
    for await (const key of store.listKeys()) left.push(Number(key.personId.slice(3)));
    expect(left.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i + 1).filter(id => id !== 1 && id % 2 === 1));
  });
});

describe('startVoiceprintSweep (H5)', () => {
  it('runs now, then daily on an unref\'d timer, and stops', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn(async () => 0);
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const stop = startVoiceprintSweep({ sweep });
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    const timer = setInterval.mock.results[0].value as { hasRef?: () => boolean };
    expect(setInterval.mock.calls[0][1]).toBe(VOICEPRINT_SWEEP_EVERY_MS);
    expect(VOICEPRINT_SWEEP_EVERY_MS).toBe(86_400_000);
    if (typeof timer.hasRef === 'function') expect(timer.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(VOICEPRINT_SWEEP_EVERY_MS - 1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(VOICEPRINT_SWEEP_EVERY_MS);
    expect(sweep).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(3 * VOICEPRINT_SWEEP_EVERY_MS);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('a failing store reports sweep_failed (content-free) and never throws; the next tick runs again', async () => {
    vi.useFakeTimers();
    const store = new InMemoryVoiceprintStore();
    await store.put(row(1));
    vi.spyOn(store, 'listKeys').mockImplementation(async function* () { throw new Error('PRIVATE_DB_ERROR tg-1'); });
    const onError = vi.fn();
    const service = sweeper(store, { eligiblePeople: async () => new Set([1]) });
    const sweep = vi.spyOn(service, 'sweep');
    const stop = startVoiceprintSweep(service, { onError, everyMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('sweep_failed');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a synchronously throwing sweep or a throwing reporter never escapes; an overlapping tick is skipped', async () => {
    vi.useFakeTimers();
    const throwing = { sweep: vi.fn((): Promise<number> => { throw new Error('sync'); }) };
    const stopA = startVoiceprintSweep(throwing, { onError: () => { throw new Error('reporter'); }, everyMs: 10 });
    await vi.advanceTimersByTimeAsync(0);
    expect(throwing.sweep).toHaveBeenCalledTimes(1);
    stopA();
    let release!: () => void;
    const slow = { sweep: vi.fn(() => new Promise<number>(resolve => { release = () => resolve(0); })) };
    const stopB = startVoiceprintSweep(slow, { everyMs: 10 });
    await vi.advanceTimersByTimeAsync(35);
    expect(slow.sweep).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(slow.sweep).toHaveBeenCalledTimes(2);
    stopB();
  });

  it('now: false waits for the first tick', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn(async () => 0);
    const stop = startVoiceprintSweep({ sweep }, { now: false, everyMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(sweep).toHaveBeenCalledTimes(1);
    stop();
  });
});
