/**
 * Storage interfaces for persona memory, share offers, chat history and
 * webhook idempotency, plus in-memory implementations (tests, local dev).
 */

import { randomUUID } from 'crypto';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';

export type NewMemory = Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface MemoryStore {
  add(memory: NewMemory): Promise<MemoryRecord>;
  /** Atomically refuse extraction created before an authorized privacy mutation. */
  addIfEpoch(memory: NewMemory, expectedEpoch: number): Promise<MemoryRecord | null>;
  get(id: string): Promise<MemoryRecord | null>;
  /** All live (not superseded) memories for a persona */
  listActive(personaId: string): Promise<MemoryRecord[]>;
  update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<void>;
  updateIfShareVersion(id: string, expectedVersion: number, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<boolean>;
  delete(id: string): Promise<void>;
}

export interface ShareOfferStore {
  create(offer: Omit<ShareOffer, 'id' | 'createdAt' | 'status'>): Promise<ShareOffer>;
  get(id: string): Promise<ShareOffer | null>;
  setStatus(id: string, status: ShareOffer['status']): Promise<void>;
}

export interface ChatHistoryStore {
  append(personaId: string, chatKey: string, message: ChatMessage, expectedEpoch?: number): Promise<void>;
  getEpoch(personaId: string): Promise<number>;
  recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]>;
  /** Purge retained source/derived turns after authorized forgetting or revocation. */
  clearPersona(personaId: string): Promise<void>;
}

export interface UpdateDeduper {
  /** Returns true the first time a key is seen, false for repeats */
  firstSeen(key: string): Promise<boolean>;
}

// ============================================
// IN-MEMORY IMPLEMENTATIONS
// ============================================

export class InMemoryMemoryStore implements MemoryStore {
  constructor(readonly epochs = new Map<string, number>()) {}

  async addIfEpoch(memory: NewMemory, expectedEpoch: number): Promise<MemoryRecord | null> {
    if ((this.epochs.get(memory.personaId) ?? 0) !== expectedEpoch) return null;
    return InMemoryMemoryStore.prototype.add.call(this, memory);
  }

  readonly records = new Map<string, MemoryRecord>();

  async add(memory: NewMemory): Promise<MemoryRecord> {
    const now = new Date();
    const record: MemoryRecord = { ...memory, id: randomUUID(), createdAt: now, updatedAt: now };
    this.records.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listActive(personaId: string): Promise<MemoryRecord[]> {
    return [...this.records.values()].filter((m) => m.personaId === personaId && !m.supersededBy);
  }

  async update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.records.set(id, { ...existing, ...patch, updatedAt: new Date() });
  }

  async updateIfShareVersion(id: string, expectedVersion: number, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<boolean> {
    const memory = this.records.get(id);
    if (!memory || (memory.shareVersion ?? 0) !== expectedVersion) return false;
    this.records.set(id, { ...memory, ...patch, updatedAt: new Date() });
    return true;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

export class InMemoryShareOfferStore implements ShareOfferStore {
  readonly offers = new Map<string, ShareOffer>();

  async create(offer: Omit<ShareOffer, 'id' | 'createdAt' | 'status'>): Promise<ShareOffer> {
    // Short id: Telegram callback_data is limited to 64 bytes.
    const record: ShareOffer = {
      ...offer,
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      status: 'pending',
      createdAt: new Date(),
    };
    this.offers.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<ShareOffer | null> {
    return this.offers.get(id) ?? null;
  }

  async setStatus(id: string, status: ShareOffer['status']): Promise<void> {
    const offer = this.offers.get(id);
    if (offer) this.offers.set(id, { ...offer, status });
  }
}

export class InMemoryChatHistoryStore implements ChatHistoryStore {
  constructor(readonly epochs = new Map<string, number>()) {}

  async getEpoch(personaId: string): Promise<number> { return this.epochs.get(personaId) ?? 0; }

  async clearPersona(personaId: string): Promise<void> {
    this.epochs.set(personaId, (this.epochs.get(personaId) ?? 0) + 1);
    for (const key of this.chats.keys()) if (key.startsWith(`${personaId}:`)) this.chats.delete(key);
  }

  readonly chats = new Map<string, ChatMessage[]>();

  async append(personaId: string, chatKey: string, message: ChatMessage, expectedEpoch?: number): Promise<void> {
    const epoch = this.epochs.get(personaId) ?? 0;
    if (expectedEpoch !== undefined && epoch !== expectedEpoch) return;
    message = { ...message, privacyEpoch: epoch };
    const key = `${personaId}:${chatKey}`;
    const list = this.chats.get(key) ?? [];
    list.push(message);
    this.chats.set(key, list.slice(-200));
  }

  async recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]> {
    return (this.chats.get(`${personaId}:${chatKey}`) ?? []).filter((m) => (m.privacyEpoch ?? 0) === (this.epochs.get(personaId) ?? 0)).slice(-limit);
  }
}

export class InMemoryUpdateDeduper implements UpdateDeduper {
  private readonly seen = new Set<string>();

  async firstSeen(key: string): Promise<boolean> {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** Shared revision state is mandatory for memory/history race fencing. */
export function createInMemoryStores() {
  const epochs = new Map<string, number>();
  return {
    memories: new InMemoryMemoryStore(epochs),
    history: new InMemoryChatHistoryStore(epochs),
    offers: new InMemoryShareOfferStore(),
    deduper: new InMemoryUpdateDeduper(),
  };
}
