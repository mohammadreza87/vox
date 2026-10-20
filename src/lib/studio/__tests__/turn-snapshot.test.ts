import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { NOW } from '../../adaptive/personalization/__tests__/fixtures';
import { closeFileStudios, fileStudio } from './file-studio';

afterEach(async () => { vi.restoreAllMocks(); await closeFileStudios(); });

describe('Studio.loadTurnSnapshot', () => {
  it('returns exactly the transactional RuntimePrivacyState from one read-only load per document', async () => {
    const { h, agent, chat, accountStorage, sharedStorage } = await fileStudio();
    const evaluate = () => h.studio.adaptiveContext(agent.id, chat.personId, 'work');
    const transact = vi.spyOn(accountStorage, 'transact');
    const sharedTransact = vi.spyOn(sharedStorage, 'transact');
    const accountLoads = vi.spyOn(accountStorage, 'load');
    const sharedLoads = vi.spyOn(sharedStorage, 'load');
    await h.studio.adaptiveContext(agent.id, chat.personId, 'work'); // settle any first-read normalisation
    transact.mockClear(); sharedTransact.mockClear(); accountLoads.mockClear(); sharedLoads.mockClear();

    const snapshot = await h.studio.loadTurnSnapshot(chat, evaluate);
    expect(transact).not.toHaveBeenCalled();
    expect(sharedTransact).not.toHaveBeenCalled();
    expect(accountLoads).toHaveBeenCalledTimes(1);
    expect(sharedLoads).toHaveBeenCalledTimes(1);
    expect(snapshot.vector.complete).toBe(true);
    expect(snapshot.vector.probes).toHaveLength(3); // Studio state, the account, the shared document
    expect(snapshot.value.context).toContain('Synthetic snapshot note');
    expect(snapshot.value.priorityContext?.[0]).toContain('brief');

    // The same evaluation with the read-only paths removed runs every read as
    // the original locked transaction. The values must be identical.
    const transactional = await withoutReadOnlyLoads([accountStorage, sharedStorage], evaluate);
    expect(transact).toHaveBeenCalled();
    expect(snapshot.value).toEqual(transactional);
  });

  it('replays over the loaded documents without I/O and stays exact across an expiry', async () => {
    const { h, f, agent, chat, accountStorage } = await fileStudio();
    await h.studio.adaptiveContext(agent.id, chat.personId, 'work');
    const snapshot = await h.studio.loadTurnSnapshot(chat, () => h.studio.adaptiveContext(agent.id, chat.personId, 'work'));
    const loads = vi.spyOn(accountStorage, 'load');
    const read = vi.spyOn(h.store, 'read');
    expect(await snapshot.replay!()).toEqual({ value: snapshot.value });
    expect(loads).not.toHaveBeenCalled();
    // Time alone (no revision change) expires the personalization consent.
    f.setNow(NOW + 366 * 86_400_000);
    const replayed = await snapshot.replay!();
    expect(loads).not.toHaveBeenCalled();
    expect(replayed === null || replayed.value.revision !== snapshot.value.revision).toBe(true);
    expect(read).toHaveBeenCalled(); // served from the snapshot copy, through the same code
  });

  it('commits a needed normalisation, then snapshots the committed state without writing', async () => {
    const { h, f, agent, chat, accountStorage } = await fileStudio();
    f.setNow(NOW + 366 * 86_400_000);
    const transact = vi.spyOn(accountStorage, 'transact');
    const snapshot = await h.studio.loadTurnSnapshot(chat, () => h.studio.adaptiveContext(agent.id, chat.personId, 'work'));
    // Expiry normalisation and the readers' own pruning commit, as their transactions did before.
    expect(transact).toHaveBeenCalled();
    expect(snapshot.vector.complete).toBe(true);
    transact.mockClear();
    await h.studio.loadTurnSnapshot(chat, () => h.studio.adaptiveContext(agent.id, chat.personId, 'work'));
    expect(transact).not.toHaveBeenCalled();
  });

  it('marks the vector incomplete when a store has no read-only path', async () => {
    const { h, agent, chat, accountStorage } = await fileStudio();
    const snapshot = await withoutReadOnlyLoads([accountStorage], () => h.studio.loadTurnSnapshot(chat, () => h.studio.adaptiveContext(agent.id, chat.personId, 'work')));
    expect(snapshot.vector.complete).toBe(false);
    expect(snapshot.replay).toBeUndefined();
  });
});

async function withoutReadOnlyLoads<T>(storages: FileAdaptiveStorage[], fn: () => Promise<T>): Promise<T> {
  const saved = storages.map(storage => storage.load);
  for (const storage of storages) (storage as { load?: unknown }).load = undefined;
  try { return await fn(); } finally { storages.forEach((storage, index) => { storage.load = saved[index]; }); }
}
