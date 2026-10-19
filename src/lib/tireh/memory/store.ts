/**
 * Storage interfaces for persona memory, share offers, chat history and
 * webhook idempotency, plus in-memory implementations (tests, local dev).
 */

import { randomUUID } from 'crypto';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';

export type NewMemory = Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface MemoryStore {
  add(memory: NewMemory): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  /** All live (not superseded) memories for a persona */
  listActive(personaId: string): Promise<MemoryRecord[]>;
  update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ShareOfferStore {
  create(offer: Omit<ShareOffer, 'id' | 'createdAt' | 'status'>): Promise<ShareOffer>;
  get(id: string): Promise<ShareOffer | null>;
  setStatus(id: string, status: ShareOffer['status']): Promise<void>;
}

export interface ChatHistoryStore {
  append(personaId: string, chatKey: string, message: ChatMessage): Promise<void>;
  recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]>;
}

export interface UpdateDeduper {
  /** Returns true the first time a key is seen, false for repeats */
  firstSeen(key: string): Promise<boolean>;
}

// ============================================
// IN-MEMORY IMPLEMENTATIONS
// ============================================

export class InMemoryMemoryStore implements MemoryStore {
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
  readonly chats = new Map<string, ChatMessage[]>();

  async append(personaId: string, chatKey: string, message: ChatMessage): Promise<void> {
    const key = `${personaId}:${chatKey}`;
    const list = this.chats.get(key) ?? [];
    list.push(message);
    this.chats.set(key, list.slice(-200));
  }

  async recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]> {
    return (this.chats.get(`${personaId}:${chatKey}`) ?? []).slice(-limit);
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
