import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { newCare } from '../../pet/care';
import { applyPlay, newPlay, type PetPlay } from '../../pet/play';
import { fakeFirestore } from '../../tireh/identity/__tests__/fake-firestore';
import { FilePetPlayStore, FirestorePetPlayStore, petPlayStoreFor, sweepPetPlay, type PetPlayStore } from '../pet-play-store';
import { FilePetStore, FirestorePetStore, type PetStore } from '../pet-store';
import { Studio } from '../service';
import { hire, ID, makeStudio, seedOrg, tempDir } from './helpers';

const T = Date.UTC(2026, 9, 20, 12);
const play = (agentId: string, userId: number, over: Partial<PetPlay> = {}): PetPlay => ({ ...newPlay(agentId, userId, T), ...over });
const planted = (agentId: string, userId: number) =>
  applyPlay(play(agentId, userId), { op: 'plantSeed', seed: 'flower' }, { now: T, tz: 'UTC', stage: 1, formed: false, bond: 0 }).play;

function roundTrip(name: string, make: () => { plays: PetPlayStore; pets: PetStore }) {
  describe(name, () => {
    it('creates, reads and updates one record atomically per agent and person; null writes nothing', async () => {
      const { plays } = make();
      expect(await plays.get('agent-a', 7)).toBeNull();
      expect(await plays.update('agent-a', 7, (current) => { expect(current).toBeNull(); return { play: null, result: 'skipped' }; })).toBe('skipped');
      expect(await plays.get('agent-a', 7)).toBeNull();
      expect(await plays.update('agent-a', 7, () => ({ play: planted('agent-a', 7), result: 'made' }))).toBe('made');
      expect(await plays.get('agent-a', 7)).toEqual(planted('agent-a', 7));
      // the path decides identity, and the stored record is sanitized on the way in
      await plays.update('agent-a', 7, (current) => ({ play: { ...current!, agentId: 'agent-b', userId: 8, note: 'free text' } as PetPlay, result: null }));
      expect(await plays.get('agent-b', 8)).toBeNull();
      const stored = await plays.get('agent-a', 7);
      expect(stored?.agentId).toBe('agent-a');
      expect(stored).not.toHaveProperty('note');
    });

    it('serializes concurrent updates without losing a write', async () => {
      const { plays } = make();
      await Promise.all(Array.from({ length: 10 }, (_, i) => plays.update('agent-a', 7, (current) => {
        const base = current ?? play('agent-a', 7);
        return { play: applyPlay(base, { op: 'gameRound', game: 'bop', outcome: 'finished', round: `round-${String(i).padStart(4, '0')}` },
          { now: T, tz: 'UTC', stage: 1, formed: false, bond: 0 }).play, result: null };
      })));
      expect((await plays.get('agent-a', 7))?.games.bop?.rounds).toBe(10);
    });

    it('lists and erases one person across agents, and clears one agent across people', async () => {
      const { plays } = make();
      for (const [agentId, userId] of [['agent-a', 7], ['agent-b', 7], ['agent-a', 8], ['agent-c', 9]] as const) {
        await plays.update(agentId, userId, () => ({ play: play(agentId, userId), result: null }));
      }
      expect((await plays.listForUser(7)).map((p) => p.agentId).sort()).toEqual(['agent-a', 'agent-b']);
      expect(await plays.eraseUser(7)).toBe(2);
      expect(await plays.listForUser(7)).toEqual([]);
      expect(await plays.get('agent-a', 8)).not.toBeNull();
      expect(await plays.clearAgent('agent-a')).toBe(1);
      expect(await plays.get('agent-a', 8)).toBeNull();
      expect(await plays.get('agent-c', 9)).not.toBeNull();
      expect(await plays.eraseUser(7)).toBe(0);
    });

    it('sweeps only records not seen since the cutoff that the caller picks', async () => {
      const { plays } = make();
      for (const [agentId, userId, seen] of [['agent-a', 7, T - 10], ['agent-a', 8, T - 10], ['agent-b', 7, T + 10]] as const) {
        await plays.update(agentId, userId, () => ({ play: play(agentId, userId, { seenAt: seen }), result: null }));
      }
      expect(await plays.sweep(T, (_agentId, userId) => userId === 7)).toBe(1);
      expect(await plays.get('agent-a', 7)).toBeNull();
      expect(await plays.get('agent-a', 8)).not.toBeNull();
      expect(await plays.get('agent-b', 7)).not.toBeNull();
    });

    it('shares the erasure epoch with pet care: a care forget fences play, and a play forget fences care', async () => {
      const { plays, pets } = make();
      const admitted = await pets.erasureEpoch(7);
      await plays.update('agent-a', 7, () => ({ play: play('agent-a', 7), result: null }), admitted);
      await pets.eraseUser(7);
      await expect(plays.update('agent-a', 7, () => ({ play: play('agent-a', 7), result: null }), admitted)).rejects.toThrow('Pet care changed');
      const fresh = await pets.erasureEpoch(7);
      expect(fresh).not.toBe(admitted);
      await plays.update('agent-a', 7, () => ({ play: play('agent-a', 7), result: null }), fresh);
      await plays.eraseUser(7);
      expect(await plays.get('agent-a', 7)).toBeNull();
      // play's erasure rotated the shared generation too: care opened before it cannot write
      expect(await pets.erasureEpoch(7)).not.toBe(fresh);
      await expect(pets.update('agent-a', 7, () => ({ care: newCare('agent-a', 7, T, 'UTC', 1), result: null }), fresh)).rejects.toThrow('Pet care changed');
    });

    it('rejects ids that are not agent ids or Telegram user ids', async () => {
      const { plays } = make();
      await expect(plays.get('../etc', 7)).rejects.toThrow('Invalid agent id');
      await expect(plays.update('agent-a', 0, () => ({ play: null, result: null }))).rejects.toThrow('Invalid user id');
      await expect(plays.listForUser(-1)).rejects.toThrow('Invalid user id');
      await expect(plays.eraseUser(1.5)).rejects.toThrow('Invalid user id');
      await expect(plays.clearAgent('a/b')).rejects.toThrow('Invalid agent id');
    });
  });
}

roundTrip('FilePetPlayStore', () => { const dir = join(tempDir(), 'pets'); return { plays: new FilePetPlayStore(dir), pets: new FilePetStore(dir) }; });
roundTrip('FirestorePetPlayStore', () => { const { db } = fakeFirestore(); return { plays: new FirestorePetPlayStore(db), pets: new FirestorePetStore(db) }; });

describe('stored layout', () => {
  it('the file store lives in pets/play beside care, which never lists it as an agent', async () => {
    const dir = join(tempDir(), 'pets');
    const plays = new FilePetPlayStore(dir), pets = new FilePetStore(dir);
    await plays.update('agent-a', 7, () => ({ play: play('agent-a', 7), result: null }));
    expect(existsSync(join(dir, 'play', 'agent-a.json'))).toBe(true);
    expect(await pets.listForUser(7)).toEqual([]);
    expect(await pets.sweep(Number.MAX_SAFE_INTEGER, () => true)).toBe(0);
    expect(await plays.get('agent-a', 7)).not.toBeNull();
  });

  it('ignores a corrupt agent file shape', async () => {
    const dir = join(tempDir(), 'pets');
    mkdirSync(join(dir, 'play'), { recursive: true });
    writeFileSync(join(dir, 'play', 'agent-a.json'), '[1,2]');
    const plays = new FilePetPlayStore(dir);
    expect(await plays.get('agent-a', 7)).toBeNull();
    await plays.update('agent-a', 7, () => ({ play: play('agent-a', 7), result: null }));
    expect(await plays.get('agent-a', 7)).not.toBeNull();
  });

  it('the Firestore record is studio_pet_play/{agentId}_{userId}, with queryable agentId, userId and seenAt', async () => {
    const fake = fakeFirestore();
    await new FirestorePetPlayStore(fake.db).update('agent-a', 7, () => ({ play: planted('agent-a', 7), result: null }));
    expect([...fake.data.keys()]).toEqual(['studio_pet_play/agent-a_7']);
    expect(fake.data.get('studio_pet_play/agent-a_7')).toMatchObject({ agentId: 'agent-a', userId: 7, seenAt: T, play: { garden: { seed: 'flower' } } });
    await new FirestorePetPlayStore(fake.db).eraseUser(7);
    expect(fake.data.has('studio_pets_epochs/7')).toBe(true);
  });
});

describe('petPlayStoreFor and the sweep', () => {
  it('uses the wired store, else a file store beside the pet care directory, created once', async () => {
    const h = makeStudio();
    const derived = await petPlayStoreFor(h.studio);
    expect(derived).toBeInstanceOf(FilePetPlayStore);
    expect((derived as FilePetPlayStore).petsDir).toBe(join(h.dir, 'pets'));
    expect(await petPlayStoreFor(h.studio)).toBe(derived);
    const wired = new FilePetPlayStore(join(tempDir(), 'pets'));
    h.studio.deps.petPlay = wired;
    expect(await petPlayStoreFor(h.studio)).toBe(wired);
  });

  it('refuses a Studio store it does not know how to sit beside', async () => {
    const h = makeStudio();
    const studio = new Studio({ ...h.studio.deps, store: { ...h.store, read: () => h.store.read() } as never });
    await expect(petPlayStoreFor(studio)).rejects.toThrow('Pet play storage is unavailable');
  });

  it('clears fired agents and stale guests, keeps members, and never throws', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, 'public');
    const plays = await petPlayStoreFor(h.studio);
    const old = h.clock.now.getTime() - 91 * 24 * 3_600_000;
    for (const userId of [ID.alice, ID.stranger]) await plays.update(mochi.agent.id, userId, () => ({ play: play(mochi.agent.id, userId, { seenAt: old }), result: null }));
    expect(await sweepPetPlay(h.studio, true)).toEqual({ fired: 0, stale: 1 });
    expect(await plays.get(mochi.agent.id, ID.stranger)).toBeNull();
    expect(await plays.get(mochi.agent.id, ID.alice)).not.toBeNull();
    expect(await sweepPetPlay(h.studio)).toBeNull(); // throttled
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.status = 'fired'; });
    expect(await sweepPetPlay(h.studio, true)).toEqual({ fired: 1, stale: 0 });
    h.studio.deps.petPlay = { clearAgent: async () => { throw new Error('disk'); } } as never;
    expect(await sweepPetPlay(h.studio, true)).toBeNull();
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] pet_play_sweep_failed');
  });
});
