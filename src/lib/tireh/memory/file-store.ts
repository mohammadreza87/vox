/**
 * JSON-file persistence for local testing: the in-memory stores, saved to one
 * file after every write so memories survive restarts. Not for production —
 * use the Firestore stores there.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';
import {
  InMemoryChatHistoryStore,
  InMemoryMemoryStore,
  InMemoryShareOfferStore,
  InMemoryUpdateDeduper,
} from './store';

interface FileState {
  memories: MemoryRecord[];
  revisions?: Record<string, number>;
  tombstones?: Record<string, string[]>;
  offers: ShareOffer[];
  chats: Record<string, ChatMessage[]>;
}

const DATE_KEYS = new Set(['at', 'createdAt', 'updatedAt']);

function reviveDates(_key: string, value: unknown) {
  return DATE_KEYS.has(_key) && typeof value === 'string' ? new Date(value) : value;
}

export function createFileStores(path: string) {
  const memories = new InMemoryMemoryStore();
  const offers = new InMemoryShareOfferStore();
  const history = new InMemoryChatHistoryStore();
  history.bindMemoryStore(memories);

  if (existsSync(path)) {
    const state = JSON.parse(readFileSync(path, 'utf8'), reviveDates) as FileState;
    for (const [key, revision] of Object.entries(state.revisions ?? {})) memories.revisions.set(key, revision);
    for (const [key, events] of Object.entries(state.tombstones ?? {})) memories.tombstones.set(key, new Set(events));
    for (const m of state.memories ?? []) memories.records.set(m.id, m);
    for (const o of state.offers ?? []) offers.offers.set(o.id, o);
    for (const [key, list] of Object.entries(state.chats ?? {})) history.chats.set(key, list);
  }

  const save = () => {
    const state: FileState = {
      memories: [...memories.records.values()],
      revisions: Object.fromEntries(memories.revisions),
      tombstones: Object.fromEntries([...memories.tombstones].map(([key, events]) => [key, [...events]])),
      offers: [...offers.offers.values()],
      chats: Object.fromEntries(history.chats),
    };
    // write-then-rename so a crash mid-write never corrupts the file
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${path}.tmp`, path);
  };

  const persisting = <T extends object>(store: T, methods: Array<keyof T>): T => {
    for (const name of methods) {
      const original = (store[name] as (...args: unknown[]) => Promise<unknown>).bind(store);
      (store as Record<keyof T, unknown>)[name] = async (...args: unknown[]) => {
        const result = await original(...args);
        save();
        return result;
      };
    }
    return store;
  };

  return {
    memories: persisting(memories, ['add', 'update', 'delete', 'invalidate']),
    offers: persisting(offers, ['create', 'setStatus']),
    history: persisting(history, ['append', 'clear']),
    // Polling hands out each update once, so de-duplication can stay in memory.
    deduper: new InMemoryUpdateDeduper(),
  };
}
