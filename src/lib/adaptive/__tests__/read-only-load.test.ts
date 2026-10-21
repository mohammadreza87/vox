import { afterEach, describe, expect, it, vi } from 'vitest';
import { stat } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { accountIdFor, AdaptiveRepository } from '../persistence/repository';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage, MemoryAdaptiveStorage } from '../persistence/storage';
import { AdaptiveRelationshipService } from '../relationships/service';
import { SharedMemoryRepository } from '../shared/repository';
import { preferenceFixture, NOW } from '../personalization/__tests__/fixtures';
import { readOnce, TurnReadScope } from '../../tireh/privacy/read-scope';

const fixtures: Awaited<ReturnType<typeof preferenceFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });

async function consented() {
  const f = await preferenceFixture({ file: true, telegramId: 77, agentId: 'agent-read' }); fixtures.push(f);
  await f.grant(); await f.agent(); await f.save({ key: 'response_length', value: 'brief' });
  const state = await f.adaptive.read(f.telegramId, 'work');
  await f.adaptive.createMemory(f.telegramId, { space: 'work', text: 'Synthetic read-only note', eventId: randomUUID(), expectedRevision: state.revision });
  const storage = f.adaptive.repository.storage as FileAdaptiveStorage;
  const file = join(f.directory!, `${createHash('sha256').update(accountIdFor(f.telegramId)).digest('hex')}.json`);
  return { f, storage, file };
}

/** Every reader the turn boundary uses, through its public read path. */
async function readAll(f: Awaited<ReturnType<typeof consented>>['f']) {
  const relationships = new AdaptiveRelationshipService(f.adaptive);
  return {
    privacy: await f.adaptive.runtimePrivacy.read(f.agentId, `tg-${f.telegramId}`, 'work'),
    context: await f.adaptive.readPrivateContext(f.telegramId, 'work', f.agentId),
    preferences: await f.experience.readPreferences(f.telegramId, 'work', f.agentId),
    confirmed: await f.adaptive.withAccountView(f.telegramId, (d, now) => f.adaptive.isProfileConfirmed(d, now)),
    permit: await relationships.resolve(f.telegramId, f.agentId, 'work'),
  };
}

describe('read-only adaptive load path', () => {
  it('serves every pure boundary read without a transaction, a rewrite or a revision change', async () => {
    const { f, storage, file } = await consented();
    const transact = vi.spyOn(storage, 'transact');
    const before = await stat(file, { bigint: true });
    const revision = storage.revisions.get(accountIdFor(f.telegramId));
    const values = await readAll(f);
    expect(transact).not.toHaveBeenCalled();
    const after = await stat(file, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
    expect(storage.revisions.get(accountIdFor(f.telegramId))).toBe(revision);
    expect(values.context.memories.map(m => m.text)).toEqual(['Synthetic read-only note']);
    expect(values.preferences.settings).toEqual([{ key: 'response_length', value: 'brief' }]);
    expect(values.confirmed).toBe(true);
    // The same callbacks through the ordinary transaction give identical results.
    transact.mockRestore();
    expect(await f.adaptive.withAccountDocument(f.telegramId, (d, now) => f.adaptive.isProfileConfirmed(d, now))).toBe(true);
    expect(await readAll(f)).toEqual(values);
  });

  it('commits a read that needs normalisation once, then reads without writing', async () => {
    const { f, storage } = await consented();
    f.setNow(NOW + 366 * 86_400_000); // the personalization consent has expired
    const transact = vi.spyOn(storage, 'transact');
    const first = await f.adaptive.readPrivateContext(f.telegramId, 'work', f.agentId);
    expect(transact).toHaveBeenCalledTimes(1);
    expect((await f.adaptive.read(f.telegramId, 'work')).purposes.find(p => p.purpose === 'optional.personalization')?.state).toBe('expired');
    transact.mockClear();
    const second = await f.adaptive.readPrivateContext(f.telegramId, 'work', f.agentId);
    expect(transact).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    expect(second.memories).toEqual([]);
  });

  it('never blocks a genuine write that runs inside a read', async () => {
    const { f, storage } = await consented();
    const revision = storage.revisions.get(accountIdFor(f.telegramId));
    await readOnce(async () => { await f.agent(false); });
    expect(storage.revisions.get(accountIdFor(f.telegramId))).toBe(revision + 1);
    expect((await f.adaptive.read(f.telegramId, 'work')).agents).toEqual([expect.objectContaining({ agentId: f.agentId, allowed: false })]);
  });

  it('re-reads committed state inside a standalone read so its own fences still see concurrent writes', async () => {
    const { f } = await consented();
    const seen = await readOnce(async () => {
      const before = await f.adaptive.withAccountDocument(f.telegramId, d => d.agentGrants.map(g => g.allowed));
      await f.agent(false);
      const after = await f.adaptive.withAccountDocument(f.telegramId, d => d.agentGrants.map(g => g.allowed));
      return { before, after };
    });
    expect(seen).toEqual({ before: [true], after: [false] });
  });

  it('loads one copy per turn snapshot and parses it once', async () => {
    const { f, storage } = await consented();
    const load = vi.spyOn(storage, 'readCommittedForEffect');
    const scope = TurnReadScope.load();
    await scope.run(() => readAll(f));
    scope.close();
    expect(load).toHaveBeenCalledTimes(1);
    expect(scope.wrote).toBe(false);
    expect((await scope.probes()).map(p => p.value)).toEqual([storage.revisions.get(accountIdFor(f.telegramId))]);
  });

  it('reads the shared document without rewriting it', async () => {
    const storage = new MemoryAdaptiveStorage();
    const repository = new SharedMemoryRepository(storage);
    await repository.transaction(d => { d.revision = 3; });
    const transact = vi.spyOn(storage, 'transact');
    expect(await readOnce(() => repository.transaction(d => d.revision))).toBe(3);
    expect(transact).not.toHaveBeenCalled();
    expect(await readOnce(() => repository.transaction(d => { d.revision++; return d.revision; }))).toBe(4);
    expect(transact).toHaveBeenCalledTimes(1);
  });

  it('keeps a storage-level Firestore commit counter and reads without a transaction', async () => {
    const docs = new Map<string, Record<string, unknown>>();
    let transactions = 0;
    const ref = (path: string) => ({ path, get: async () => snapshot(path) });
    const snapshot = (path: string) => ({ exists: docs.has(path), get: (field: string) => docs.get(path)?.[field] });
    const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: async (fn: (tx: unknown) => unknown) => {
        transactions++;
        return fn({ get: async (r: { path: string }) => snapshot(r.path), set: (r: { path: string }, value: Record<string, unknown>) => { docs.set(r.path, value); } });
      } } as unknown as Firestore;
    const storage = new FirestoreAdaptiveStorage(db);
    const repository = new AdaptiveRepository(storage);
    await repository.transaction('telegram-account:5', 100, d => { d.revision++; });
    await repository.transaction('telegram-account:5', 100, () => undefined);
    const loaded = await storage.load('telegram-account:5');
    expect(loaded.probe).toMatchObject({ value: 2, remote: { field: 'rev', path: expect.stringMatching(/^adaptiveAccounts\//) } });
    const count = transactions;
    expect(await readOnce(() => repository.transaction('telegram-account:5', 100, d => d.revision))).toBe(2);
    expect(transactions).toBe(count);
  });
});

describe('committed read seam', () => {
  it('reads file-format accounts through readCommittedForEffect and falls back to the transaction while a writer holds the lock', async () => {
    const { f, storage } = await consented();
    const committed = vi.spyOn(storage, 'readCommittedForEffect');
    const transact = vi.spyOn(storage, 'transact');
    await f.adaptive.readPrivateContext(f.telegramId, 'work', f.agentId);
    expect(committed).toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
    committed.mockReturnValueOnce({ status: 'busy' });
    const scope = TurnReadScope.load();
    const value = await scope.run(() => f.adaptive.readPrivateContext(f.telegramId, 'work', f.agentId));
    scope.close();
    expect(value.memories.map(m => m.text)).toEqual(['Synthetic read-only note']);
    expect(transact).toHaveBeenCalledTimes(1);
    expect(scope.incomplete).toBe(true);
  });
});
