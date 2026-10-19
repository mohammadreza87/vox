/**
 * Storage interfaces for persona memory, share offers, chat history and
 * webhook idempotency, plus in-memory implementations (tests, local dev).
 */

import { createHash, randomUUID } from 'crypto';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';

export type NewMemory = Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface MemoryWriteGuard { expectedRevision: number }

export class StaleMemoryWriteError extends Error {
  constructor() { super('Memory context was invalidated'); this.name = 'StaleMemoryWriteError'; }
}

/** Stable legacy fallback uses provenance metadata only, never content. */
export function sourceEventIds(memory: Pick<MemoryRecord, 'source'>): string[] {
  return memory.source.eventIds?.length ? memory.source.eventIds : [
    createHash('sha256').update(JSON.stringify([memory.source.personId, memory.source.chatKind, memory.source.groupId ?? null, memory.source.telegramMessageId ?? null, memory.source.at.toISOString()])).digest('hex'),
  ];
}

export function lineageEventIds(memory: Pick<MemoryRecord, 'source'>): string[] {
  return [...new Set([...sourceEventIds(memory), ...(memory.source.derivedFromEventIds ?? [])])];
}

/** Conservative transitive purge of source-derived and supersession records. */
export function forgetClosure(records: MemoryRecord[], id: string): MemoryRecord[] {
  const target = records.find((r) => r.id === id);
  if (!target) return [];
  const selected = new Set([id]);
  const events = new Set(sourceEventIds(target));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of records) {
      if (selected.has(row.id)) continue;
      if (lineageEventIds(row).some((e) => events.has(e)) ||
          (row.supersedes && selected.has(row.supersedes)) ||
          (row.supersededBy && selected.has(row.supersededBy)) ||
          records.some((other) => selected.has(other.id) && (other.supersedes === row.id || other.supersededBy === row.id))) {
        selected.add(row.id);
        sourceEventIds(row).forEach((e) => events.add(e));
        changed = true;
      }
    }
  }
  return records.filter((r) => selected.has(r.id));
}

export interface MemoryStore {
  /** Increments on restriction, correction, supersession or deletion. */
  safetyRevision(personaId: string): Promise<number>;
  invalidate(personaId: string): Promise<void>;
  add(memory: NewMemory, guard?: MemoryWriteGuard): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  /** All live (not superseded) memories for a persona */
  listActive(personaId: string): Promise<MemoryRecord[]>;
  update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>, guard?: MemoryWriteGuard): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ShareOfferStore {
  create(offer: Omit<ShareOffer, 'id' | 'createdAt' | 'status'>): Promise<ShareOffer>;
  get(id: string): Promise<ShareOffer | null>;
  setStatus(id: string, status: ShareOffer['status']): Promise<void>;
}

export interface ChatHistoryStore {
  /** Physical purge of all persona history; intentionally conservative. */
  clear(personaId: string): Promise<void>;
  bindMemoryStore?(memories: MemoryStore): void;
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
  readonly revisions = new Map<string, number>();
  readonly tombstones = new Map<string, Set<string>>();

  async safetyRevision(personaId: string): Promise<number> { return this.revisions.get(personaId) ?? 0; }

  async invalidate(personaId: string): Promise<void> {
    this.revisions.set(personaId, (this.revisions.get(personaId) ?? 0) + 1);
  }

  private check(personaId: string, guard?: MemoryWriteGuard) {
    if (guard && guard.expectedRevision !== (this.revisions.get(personaId) ?? 0)) throw new StaleMemoryWriteError();
  }

  async add(memory: NewMemory, guard?: MemoryWriteGuard): Promise<MemoryRecord> {
    this.check(memory.personaId, guard);
    if (lineageEventIds(memory).some((e) => this.tombstones.get(memory.personaId)?.has(e))) throw new StaleMemoryWriteError();
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

  async update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>, guard?: MemoryWriteGuard): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) return;
    this.check(existing.personaId, guard);
    this.revisions.set(existing.personaId, (this.revisions.get(existing.personaId) ?? 0) + 1);
    this.records.set(id, { ...existing, ...patch, updatedAt: new Date() });
  }

  async delete(id: string): Promise<void> {
    const target = this.records.get(id);
    if (!target) return;
    const rows = forgetClosure([...this.records.values()].filter((r) => r.personaId === target.personaId), id);
    const tombstones = this.tombstones.get(target.personaId) ?? new Set<string>();
    for (const row of rows) {
      sourceEventIds(row).forEach((e) => tombstones.add(e));
      this.records.delete(row.id);
    }
    this.tombstones.set(target.personaId, tombstones);
    this.revisions.set(target.personaId, (this.revisions.get(target.personaId) ?? 0) + 1);
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
  private memories?: InMemoryMemoryStore;

  bindMemoryStore(memories: MemoryStore): void {
    if (memories instanceof InMemoryMemoryStore) this.memories = memories;
  }

  async clear(personaId: string): Promise<void> {
    for (const key of this.chats.keys()) if (key.startsWith(`${personaId}:`)) this.chats.delete(key);
  }

  async append(personaId: string, chatKey: string, message: ChatMessage): Promise<void> {
    if (message.privacy && this.memories && message.privacy.memoryRevision !== (this.memories.revisions.get(personaId) ?? 0)) return;
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
