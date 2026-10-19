/**
 * Firestore (Admin SDK) implementations of the TIREH stores.
 *
 * Collections:
 *   tireh_memories/{memoryId}                     personaId, active, scopeKey, …
 *   tireh_share_offers/{offerId}
 *   tireh_chats/{personaId__chatKey}/messages/{auto}
 *   tireh_updates/{personaId__updateId}           webhook idempotency
 *
 * Visibility is never delegated to Firestore queries: stores return
 * candidates, and memory/visibility.ts decides what a conversation may use.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';
import type { ChatHistoryStore, MemoryStore, NewMemory, ShareOfferStore, UpdateDeduper } from './store';
import { scopeKey } from './visibility';
import { randomUUID } from 'crypto';

const MEMORIES = 'tireh_memories';
const OFFERS = 'tireh_share_offers';
const CHATS = 'tireh_chats';
const UPDATES = 'tireh_updates';

/** Firestore rejects undefined values; drop them recursively (Dates kept). */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, clean(v)])
    ) as T;
  }
  return value;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date(value as string);
}

function memoryFromDoc(id: string, data: Record<string, unknown>): MemoryRecord {
  const source = data.source as MemoryRecord['source'];
  return {
    ...(data as unknown as MemoryRecord),
    id,
    source: { ...source, at: toDate(source.at) },
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export class FirestoreMemoryStore implements MemoryStore {
  constructor(private readonly db: Firestore) {}

  async add(memory: NewMemory): Promise<MemoryRecord> {
    const now = new Date();
    const ref = this.db.collection(MEMORIES).doc();
    const data = { ...memory, createdAt: now, updatedAt: now };
    await ref.set(clean({ ...data, active: !memory.supersededBy, scopeKey: scopeKey(memory.scope) }));
    return { ...data, id: ref.id };
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const snap = await this.db.collection(MEMORIES).doc(id).get();
    return snap.exists ? memoryFromDoc(snap.id, snap.data() as Record<string, unknown>) : null;
  }

  async listActive(personaId: string): Promise<MemoryRecord[]> {
    const snap = await this.db
      .collection(MEMORIES)
      .where('personaId', '==', personaId)
      .where('active', '==', true)
      .get();
    return snap.docs.map((d) => memoryFromDoc(d.id, d.data() as Record<string, unknown>));
  }

  async update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>): Promise<void> {
    const extra: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.scope) extra.scopeKey = scopeKey(patch.scope);
    if ('supersededBy' in patch) extra.active = !patch.supersededBy;
    await this.db.collection(MEMORIES).doc(id).update(clean({ ...patch, ...extra }));
  }

  async delete(id: string): Promise<void> {
    await this.db.collection(MEMORIES).doc(id).delete();
  }
}

export class FirestoreShareOfferStore implements ShareOfferStore {
  constructor(private readonly db: Firestore) {}

  async create(offer: Omit<ShareOffer, 'id' | 'createdAt' | 'status'>): Promise<ShareOffer> {
    const record: ShareOffer = {
      ...offer,
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      status: 'pending',
      createdAt: new Date(),
    };
    const { id, ...data } = record;
    await this.db.collection(OFFERS).doc(id).set(clean(data));
    return record;
  }

  async get(id: string): Promise<ShareOffer | null> {
    const snap = await this.db.collection(OFFERS).doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    return { ...(data as unknown as ShareOffer), id: snap.id, createdAt: toDate(data.createdAt) };
  }

  async setStatus(id: string, status: ShareOffer['status']): Promise<void> {
    await this.db.collection(OFFERS).doc(id).update({ status });
  }
}

export class FirestoreChatHistoryStore implements ChatHistoryStore {
  constructor(private readonly db: Firestore) {}

  private messages(personaId: string, chatKey: string) {
    return this.db.collection(CHATS).doc(`${personaId}__${chatKey}`).collection('messages');
  }

  async append(personaId: string, chatKey: string, message: ChatMessage): Promise<void> {
    await this.messages(personaId, chatKey).add(clean(message));
  }

  async recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]> {
    const snap = await this.messages(personaId, chatKey).orderBy('at', 'desc').limit(limit).get();
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return { ...(data as unknown as ChatMessage), at: toDate(data.at) };
      })
      .reverse();
  }
}

export class FirestoreUpdateDeduper implements UpdateDeduper {
  constructor(private readonly db: Firestore) {}

  async firstSeen(key: string): Promise<boolean> {
    try {
      await this.db.collection(UPDATES).doc(key).create({ at: new Date() });
      return true;
    } catch (error) {
      // gRPC code 6 = ALREADY_EXISTS
      if ((error as { code?: number }).code === 6) return false;
      throw error;
    }
  }
}
