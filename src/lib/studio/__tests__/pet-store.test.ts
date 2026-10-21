import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { newCare } from '../../pet/care';
import { NEED_FLOOR, type PetCare } from '../../pet/types';
import { fakeFirestore } from '../../tireh/identity/__tests__/fake-firestore';
import { FilePetStore, FirestorePetStore, petStoreFor, sanitizeCare, type PetStore } from '../pet-store';
import { Studio } from '../service';
import { makeStudio, tempDir } from './helpers';

const T = Date.UTC(2026, 9, 20, 12);
const care = (agentId: string, userId: number, over: Partial<PetCare> = {}): PetCare => ({ ...newCare(agentId, userId, T, 'Asia/Tehran', 2), ...over });

function roundTrip(name: string, make: () => PetStore) {
  describe(name, () => {
    it('creates, reads and updates one record atomically per agent and user', async () => {
      const store = make();
      expect(await store.get('agent-a', 7)).toBeNull();
      const created = await store.update('agent-a', 7, (current) => {
        expect(current).toBeNull();
        return { care: care('agent-a', 7, { tummy: 40 }), result: 'made' };
      });
      expect(created).toBe('made');
      expect(await store.get('agent-a', 7)).toEqual(care('agent-a', 7, { tummy: 40 }));
      await store.update('agent-a', 7, (current) => ({ care: { ...current!, tummy: current!.tummy + 35, asleep: true, sleptAt: T }, result: null }));
      expect(await store.get('agent-a', 7)).toMatchObject({ tummy: 75, asleep: true, sleptAt: T, tz: 'Asia/Tehran' });
      // the path decides the record's identity, never the returned care
      await store.update('agent-a', 7, (current) => ({ care: { ...current!, agentId: 'agent-b', userId: 8 }, result: null }));
      expect(await store.get('agent-b', 8)).toBeNull();
      expect((await store.get('agent-a', 7))?.agentId).toBe('agent-a');
    });

    it('serializes concurrent updates without losing a write', async () => {
      const store = make();
      await store.update('agent-a', 7, () => ({ care: care('agent-a', 7, { bond: 0 }), result: null }));
      await Promise.all(Array.from({ length: 10 }, () =>
        store.update('agent-a', 7, (current) => ({ care: { ...current!, bond: current!.bond + 1 }, result: null }))));
      expect((await store.get('agent-a', 7))?.bond).toBe(10);
    });

    it('lists and erases one person across agents, and clears one agent across people', async () => {
      const store = make();
      for (const [agentId, userId] of [['agent-a', 7], ['agent-b', 7], ['agent-a', 8], ['agent-c', 9]] as const) {
        await store.update(agentId, userId, () => ({ care: care(agentId, userId), result: null }));
      }
      expect((await store.listForUser(7)).map((c) => c.agentId).sort()).toEqual(['agent-a', 'agent-b']);
      expect(await store.eraseUser(7)).toBe(2);
      expect(await store.listForUser(7)).toEqual([]);
      expect(await store.get('agent-a', 8)).not.toBeNull();
      expect(await store.clearAgent('agent-a')).toBe(1);
      expect(await store.get('agent-a', 8)).toBeNull();
      expect(await store.get('agent-c', 9)).not.toBeNull();
      expect(await store.eraseUser(7)).toBe(0);
      expect(await store.clearAgent('agent-z')).toBe(0);
    });

    it('sweeps only records not seen since the cutoff that the caller picks', async () => {
      const store = make();
      for (const [agentId, userId, seen] of [['agent-a', 7, T - 10], ['agent-a', 8, T - 10], ['agent-b', 7, T + 10]] as const) {
        await store.update(agentId, userId, () => ({ care: care(agentId, userId, { lastSeenAt: seen }), result: null }));
      }
      expect(await store.sweep(T, (_agentId, userId) => userId === 7)).toBe(1);
      expect(await store.get('agent-a', 7)).toBeNull();
      expect(await store.get('agent-a', 8)).not.toBeNull();
      expect(await store.get('agent-b', 7)).not.toBeNull();
      expect(await store.sweep(T, () => true)).toBe(1);
      expect(await store.sweep(T, () => true)).toBe(0);
    });

    it('rejects an old in-flight care write after erasure, while a new visit can begin again', async () => {
      const store = make();
      const admitted = await store.erasureEpoch(7);
      await store.update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }), admitted);
      await store.eraseUser(7);
      expect(await store.get('agent-a', 7)).toBeNull();
      await expect(store.update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }), admitted)).rejects.toThrow('Pet care changed');
      expect(await store.listForUser(7)).toEqual([]);
      const fresh = await store.erasureEpoch(7);
      expect(fresh).not.toBe(admitted);
      await store.update('agent-a', 7, () => ({ care: care('agent-a', 7, { bond: 0 }), result: null }), fresh);
      expect((await store.get('agent-a', 7))?.bond).toBe(0);
    });

    it('rejects ids that are not agent ids or Telegram user ids', async () => {
      const store = make();
      await expect(store.get('../etc', 7)).rejects.toThrow('Invalid agent id');
      await expect(store.update('agent-a', 0, () => ({ care: care('agent-a', 0), result: null }))).rejects.toThrow('Invalid user id');
      await expect(store.listForUser(-1)).rejects.toThrow('Invalid user id');
      await expect(store.eraseUser(1.5)).rejects.toThrow('Invalid user id');
      await expect(store.clearAgent('a/b')).rejects.toThrow('Invalid agent id');
    });
  });
}

roundTrip('FilePetStore', () => new FilePetStore(join(tempDir(), 'pets')));
roundTrip('FirestorePetStore', () => new FirestorePetStore(fakeFirestore().db));

describe('stored records', () => {
  it('re-validates on read: needs inside [floor, 100], a known zone, sane caps', () => {
    const raw = { ...care('agent-a', 7), tummy: -50, joy: 'lots', energy: 900, bond: -3, tz: 'Nowhere/Land', lastSeenStage: 9,
      asleep: true, sleptAt: undefined, caps: null, poop: 3 };
    const clean = sanitizeCare(raw, 'agent-a', 7)!;
    expect(clean).toMatchObject({ tummy: NEED_FLOOR.tummy, joy: 80, energy: 100, bond: 0, tz: 'UTC', lastSeenStage: 1, asleep: true, sleptAt: T,
      caps: { hourStart: 0, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: 0 } });
    expect(clean).not.toHaveProperty('poop');
    expect(sanitizeCare(null, 'agent-a', 7)).toBeNull();
    expect(sanitizeCare({ ...raw, v: 2 }, 'agent-a', 7)).toBeNull();
    expect(sanitizeCare(raw, 'agent-b', 7)).toBeNull();
    expect(sanitizeCare(raw, 'agent-a', 8)).toBeNull();
  });

  it('ignores a corrupt agent file shape and keeps stray files out of listings', async () => {
    const dir = join(tempDir(), 'pets');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-a.json'), '[1,2]');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const store = new FilePetStore(dir);
    expect(await store.get('agent-a', 7)).toBeNull();
    expect(await store.listForUser(7)).toEqual([]);
    await store.update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }));
    await store.eraseUser(7);
    expect(existsSync(join(dir, 'agent-a.json'))).toBe(false);
  });

  it('the Firestore record is studio_pets/{agentId}_{userId} with queryable agentId and userId', async () => {
    const fake = fakeFirestore();
    await new FirestorePetStore(fake.db).update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }));
    expect([...fake.data.keys()]).toEqual(['studio_pets/agent-a_7']);
    expect(fake.data.get('studio_pets/agent-a_7')).toMatchObject({ agentId: 'agent-a', userId: 7, seenAt: T, care: { tummy: 75 } });
    expect(fake.writes[0].care).not.toHaveProperty('sleptAt');
  });
});

describe('petStoreFor', () => {
  it('uses the wired store, else a file store beside studio.json, created once', async () => {
    const h = makeStudio();
    const derived = await petStoreFor(h.studio);
    expect(derived).toBeInstanceOf(FilePetStore);
    expect((derived as FilePetStore).dir).toBe(join(h.dir, 'pets'));
    expect(await petStoreFor(h.studio)).toBe(derived);
    const wired = new FilePetStore(join(tempDir(), 'pets'));
    h.studio.deps.pets = wired;
    expect(await petStoreFor(h.studio)).toBe(wired);
  });

  it('refuses a Studio store it does not know how to sit beside, and retries next time', async () => {
    const h = makeStudio();
    const studio = new Studio({ ...h.studio.deps, store: { ...h.store, read: () => h.store.read() } as never });
    await expect(petStoreFor(studio)).rejects.toThrow('Pet care storage is unavailable');
    await expect(petStoreFor(studio)).rejects.toThrow('Pet care storage is unavailable');
  });
});

it('FILE erasure generation survives another store instance and rejects its old admitted write', async () => {
  const dir = join(tempDir(), 'pets');
  const first = new FilePetStore(dir), second = new FilePetStore(dir);
  const old = await first.erasureEpoch(7);
  await first.update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }), old);
  await second.eraseUser(7);
  const restarted = new FilePetStore(dir);
  expect(await restarted.erasureEpoch(7)).not.toBe(old);
  await expect(first.update('agent-a', 7, () => ({ care: care('agent-a', 7), result: null }), old)).rejects.toThrow('Pet care changed');
  expect(await restarted.listForUser(7)).toEqual([]);
});
