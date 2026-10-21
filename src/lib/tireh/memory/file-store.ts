/** Local JSON persistence. Mutations reload under a process-independent lock.
 * Revision and epoch probes reload under the lock when taken; their in-process
 * re-reads see every change committed through this process (the single-process
 * Mac profile, as StudioStore already assumes). */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { mkdir, rmdir } from 'fs/promises';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from './store';

interface FileState {
  memories: MemoryRecord[];
  revisions?: Record<string, number>;
  tombstones?: Record<string, string[]>;
  offers: ShareOffer[];
  chats: Record<string, ChatMessage[]>;
  epochs?: Record<string, number>;
}
const DATE_KEYS = new Set(['at', 'createdAt', 'updatedAt', 'validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter']);
function reviveDates(_key: string, value: unknown) {
  return DATE_KEYS.has(_key) && typeof value === 'string' ? new Date(value) : value;
}

export function createFileStores(path: string) {
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const offers = new InMemoryShareOfferStore();
  const history = new InMemoryChatHistoryStore(epochs);
  history.bindMemoryStore(memories);

  const reload = () => {
    if (!existsSync(path)) {
      memories.records.clear(); memories.revisions.clear(); memories.tombstones.clear(); offers.offers.clear(); history.chats.clear(); epochs.clear();
      return;
    }
    const state = JSON.parse(readFileSync(path, 'utf8'), reviveDates) as FileState;
    memories.records.clear(); memories.revisions.clear(); memories.tombstones.clear(); offers.offers.clear(); history.chats.clear(); epochs.clear();
    for (const [key, revision] of Object.entries(state.revisions ?? {})) memories.revisions.set(key, revision);
    for (const [key, events] of Object.entries(state.tombstones ?? {})) memories.tombstones.set(key, new Set(events));
    for (const m of state.memories ?? []) memories.records.set(m.id, m);
    for (const o of state.offers ?? []) offers.offers.set(o.id, o);
    for (const [key, list] of Object.entries(state.chats ?? {})) history.chats.set(key, list);
    for (const [key, epoch] of Object.entries(state.epochs ?? {})) epochs.set(key, epoch);
  };
  reload();
  const save = () => {
    const state: FileState = {
      revisions: Object.fromEntries(memories.revisions),
      tombstones: Object.fromEntries([...memories.tombstones].map(([key, events]) => [key, [...events]])),
      memories: [...memories.records.values()], offers: [...offers.offers.values()],
      chats: Object.fromEntries(history.chats), epochs: Object.fromEntries(epochs),
    };
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
    chmodSync(`${path}.tmp`, 0o600);
    renameSync(`${path}.tmp`, path);
  };

  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    let acquired = false;
    for (let attempts = 0; attempts < 500; attempts++) {
      try { await mkdir(`${path}.lock`); acquired = true; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (!acquired) throw new Error('Memory persistence lock is busy.');
    try { reload(); return await operation(); }
    finally { await rmdir(`${path}.lock`); }
  };
  const wrap = <T extends object>(store: T, mutations: Array<keyof T>, reads: Array<keyof T>): T => {
    for (const name of [...mutations, ...reads]) {
      const original = (store[name] as (...args: unknown[]) => Promise<unknown>).bind(store);
      (store as Record<keyof T, unknown>)[name] = (...args: unknown[]) => withLock(async () => {
        const result = await original(...args);
        if (mutations.includes(name)) save();
        return result;
      });
    }
    return store;
  };
  history.clear = (personaId) => history.clearPersona(personaId);
  return {
    memories: wrap(memories, ['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete', 'invalidate', 'addTombstones'], ['get', 'listActive', 'safetyRevision', 'revisionProbe', 'tombstonesOf']),
    offers: wrap(offers, ['create', 'setStatus'], ['get']),
    history: wrap(history, ['append', 'clearPersona'], ['recent', 'getEpoch', 'epochProbe']),
    deduper: new InMemoryUpdateDeduper(),
  };
}
