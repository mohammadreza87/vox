/**
 * Firestore (Admin SDK) implementations of the TIREH stores.
 *
 * Collections:
 *   tireh_memories/{memoryId}                     personaId, active, scopeKey, …
 *     … embedding (vector, normal sensitivity only; composite vector index in firestore.indexes.json)
 *   tireh_share_offers/{offerId}
 *   tireh_chats/{personaId__chatKey}/messages/{auto}
 *   tireh_updates/{personaId__updateId}           webhook idempotency
 *
 * Visibility is never delegated to Firestore queries: stores return
 * candidates, and memory/visibility.ts decides what a conversation may use.
 * findNearest is no exception: its pre-filter is an optimisation, never the
 * authority.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { ChatMessage, MemoryRecord, ShareOffer } from '../types';
import type { ChatHistoryStore, MemoryStore, MemoryWriteGuard, NewMemory, ShareOfferStore, UpdateDeduper } from './store';
import { assertReplacementTarget, assertTombstoneIds, forgetClosure, lineageEventIds, sourceEventIds, StaleMemoryWriteError } from './store';
import { scopeKey } from './visibility';
import { stripEmbeddingUnlessNormal } from './record-v2';
import { randomUUID } from 'crypto';

const MEMORIES = 'tireh_memories';
const MEMORY_STATE = 'tireh_memory_state';
const OFFERS = 'tireh_share_offers';
const CHATS = 'tireh_chats';
const UPDATES = 'tireh_updates';
const EPOCHS = 'tireh_privacy_epochs';

const V2_DATE_KEYS = ['validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter'] as const;
const MAX_FIND_NEAREST_SCOPE_KEYS = 30;

/** Duck-typed Firestore VectorValue (FieldValue.vector()); never recursed into. */
function isVectorValue(value: unknown): value is { toArray(): number[]; isEqual(other: unknown): boolean } {
  return !!value && typeof value === 'object' &&
    typeof (value as { toArray?: unknown }).toArray === 'function' &&
    typeof (value as { isEqual?: unknown }).isEqual === 'function';
}

/** Firestore rejects undefined values; drop them recursively (Dates kept). */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (isVectorValue(value)) return value;
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
  const record: MemoryRecord = {
    ...(data as unknown as MemoryRecord),
    id,
    source: { ...source, at: toDate(source.at) },
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
  // v2 keys are converted only when present, so legacy docs map to the base shape.
  for (const key of V2_DATE_KEYS) {
    if (data[key] !== undefined && data[key] !== null) record[key] = toDate(data[key]);
  }
  if (isVectorValue(data.embedding)) record.embedding = data.embedding.toArray();
  return record;
}

export interface FirestoreMemoryStoreOptions {
  /** Builds a Firestore vector value; defaults to a lazy FieldValue.vector(). Tests inject a fake. */
  vectorValue?: (values: number[]) => unknown;
}

/** Loaded only when an embedding is written or cleared, so legacy writes never import the Admin SDK. */
async function adminFieldValue() {
  return (await import('firebase-admin/firestore')).FieldValue;
}

export class FirestoreMemoryStore implements MemoryStore {
  constructor(private readonly db: Firestore, private readonly options: FirestoreMemoryStoreOptions = {}) {}

  private async vector(values: number[]): Promise<unknown> {
    if (this.options.vectorValue) return this.options.vectorValue(values);
    return (await adminFieldValue()).vector(values);
  }

  async addIfEpoch(memory: NewMemory, expectedEpoch: number): Promise<MemoryRecord | null> {
    memory = stripEmbeddingUnlessNormal(memory, memory.sensitivity);
    const vector = Array.isArray(memory.embedding) ? await this.vector(memory.embedding) : undefined;
    const ref = this.db.collection(MEMORIES).doc();
    const epochRef = this.db.collection(EPOCHS).doc(memory.personaId);
    return this.db.runTransaction(async (transaction) => {
      const epoch = await transaction.get(epochRef);
      const state = await transaction.get(this.db.collection(MEMORY_STATE).doc(memory.personaId));
      if (lineageEventIds(memory).some((id) => ((state.data()?.tombstones ?? []) as string[]).includes(id))) return null;
      if (Number(epoch.data()?.epoch ?? 0) !== expectedEpoch) return null;
      const predecessorRef = memory.supersedes ? this.db.collection(MEMORIES).doc(memory.supersedes) : undefined;
      const predecessor = predecessorRef ? await transaction.get(predecessorRef) : undefined;
      const target = predecessor?.exists ? memoryFromDoc(predecessor.id, predecessor.data()!) : undefined;
      if (memory.supersedes) assertReplacementTarget(memory, target);
      const now = new Date();
      const data = { ...memory, createdAt: now, updatedAt: now };
      if (target && predecessorRef) {
        transaction.update(predecessorRef, { supersededBy: ref.id, shareVersion: (target.shareVersion ?? 0) + 1, updatedAt: now, active: false });
        transaction.set(this.db.collection(MEMORY_STATE).doc(memory.personaId), { ...state.data(), revision: Number(state.data()?.revision ?? 0) + 1 });
      }
      const doc = clean({ ...data, active: !memory.supersededBy, scopeKey: scopeKey(memory.scope) });
      transaction.set(ref, vector === undefined ? doc : { ...doc, embedding: vector });
      return { ...data, id: ref.id };
    });
  }

  async safetyRevision(personaId: string): Promise<number> {
    const state = await this.db.collection(MEMORY_STATE).doc(personaId).get();
    return Number(state.data()?.revision ?? 0);
  }

  async invalidate(personaId: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(MEMORY_STATE).doc(personaId);
      const state = await tx.get(ref);
      tx.set(ref, { ...state.data(), revision: Number(state.data()?.revision ?? 0) + 1 });
    });
  }

  async add(memory: NewMemory, guard?: MemoryWriteGuard): Promise<MemoryRecord> {
    memory = stripEmbeddingUnlessNormal(memory, memory.sensitivity);
    const vector = Array.isArray(memory.embedding) ? await this.vector(memory.embedding) : undefined;
    const now = new Date();
    const ref = this.db.collection(MEMORIES).doc();
    const data = { ...memory, createdAt: now, updatedAt: now };
    await this.db.runTransaction(async (tx) => {
      const state = await tx.get(this.db.collection(MEMORY_STATE).doc(memory.personaId));
      const revision = Number(state.data()?.revision ?? 0);
      const tombstones = (state.data()?.tombstones ?? []) as string[];
      if ((guard && guard.expectedRevision !== revision) || lineageEventIds(memory).some((id) => tombstones.includes(id))) {
        throw new StaleMemoryWriteError();
      }
      const predecessorRef = memory.supersedes ? this.db.collection(MEMORIES).doc(memory.supersedes) : undefined;
      const predecessor = predecessorRef ? await tx.get(predecessorRef) : undefined;
      const target = predecessor?.exists ? memoryFromDoc(predecessor.id, predecessor.data()!) : undefined;
      if (memory.supersedes) assertReplacementTarget(memory, target);
      if (target && predecessorRef) {
        tx.update(predecessorRef, { supersededBy: ref.id, shareVersion: (target.shareVersion ?? 0) + 1, updatedAt: now, active: false });
        tx.set(this.db.collection(MEMORY_STATE).doc(memory.personaId), { ...state.data(), revision: revision + 1 });
      }
      const doc = clean({ ...data, active: !memory.supersededBy, scopeKey: scopeKey(memory.scope) });
      tx.set(ref, vector === undefined ? doc : { ...doc, embedding: vector });
    });
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

  async update(id: string, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>, guard?: MemoryWriteGuard): Promise<void> {
    const patchVector = Array.isArray(patch.embedding) ? await this.vector(patch.embedding) : undefined;
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(MEMORIES).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const existing = snap.data()!;
      const sensitivity = (patch.sensitivity ?? existing.sensitivity) as MemoryRecord['sensitivity'] | undefined;
      const hygienic = stripEmbeddingUnlessNormal(patch, sensitivity);
      const clearEmbedding = sensitivity !== 'normal' &&
        (existing.embedding !== undefined || existing.embeddingModel !== undefined || existing.embeddingVersion !== undefined);
      const fieldValue = clearEmbedding ? await adminFieldValue() : undefined;
      const personaId = snap.data()!.personaId as string;
      const stateRef = this.db.collection(MEMORY_STATE).doc(personaId);
      const state = await tx.get(stateRef);
      const revision = Number(state.data()?.revision ?? 0);
      if (guard && guard.expectedRevision !== revision) throw new StaleMemoryWriteError();
      const extra: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.scope) extra.scopeKey = scopeKey(patch.scope);
      if ('supersededBy' in patch) extra.active = !patch.supersededBy;
      let written: Record<string, unknown> = clean({ ...hygienic, ...extra });
      if (patchVector !== undefined && Array.isArray(written.embedding)) written = { ...written, embedding: patchVector };
      if (fieldValue) {
        written = { ...written, embedding: fieldValue.delete(), embeddingModel: fieldValue.delete(), embeddingVersion: fieldValue.delete() };
      }
      tx.update(ref, written);
      tx.set(stateRef, { ...state.data(), revision: revision + 1 });
    });
  }

  async updateIfShareVersion(id: string, expectedVersion: number, patch: Partial<Omit<MemoryRecord, 'id' | 'personaId'>>, guard?: MemoryWriteGuard): Promise<boolean> {
    const patchVector = Array.isArray(patch.embedding) ? await this.vector(patch.embedding) : undefined;
    const ref = this.db.collection(MEMORIES).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || Number(snapshot.data()?.shareVersion ?? 0) !== expectedVersion) return false;
      const stateRef = this.db.collection(MEMORY_STATE).doc(snapshot.data()!.personaId as string);
      const state = await transaction.get(stateRef);
      if (guard && guard.expectedRevision !== Number(state.data()?.revision ?? 0)) throw new StaleMemoryWriteError();
      const merged: Record<string, unknown> = { ...snapshot.data(), ...patch, updatedAt: new Date() };
      const data = stripEmbeddingUnlessNormal(merged, merged.sensitivity as MemoryRecord['sensitivity'] | undefined);
      transaction.set(stateRef, { ...state.data(), revision: Number(state.data()?.revision ?? 0) + 1 });
      // An existing VectorValue from the snapshot passes through clean() untouched.
      let doc: Record<string, unknown> = clean({ ...data, active: !data.supersededBy, scopeKey: scopeKey(data.scope as MemoryRecord['scope']) });
      if (patchVector !== undefined && Array.isArray(doc.embedding)) doc = { ...doc, embedding: patchVector };
      transaction.set(ref, doc);
      return true;
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(MEMORIES).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const personaId = snap.data()!.personaId as string;
      const stateRef = this.db.collection(MEMORY_STATE).doc(personaId);
      const state = await tx.get(stateRef);
      const rows = await tx.get(this.db.collection(MEMORIES).where('personaId', '==', personaId));
      const forgotten = forgetClosure(rows.docs.map((d) => memoryFromDoc(d.id, d.data() as Record<string, unknown>)), id);
      const tombstones = new Set((state.data()?.tombstones ?? []) as string[]);
      forgotten.forEach((m) => sourceEventIds(m).forEach((e) => tombstones.add(e)));
      forgotten.forEach((m) => tx.delete(this.db.collection(MEMORIES).doc(m.id)));
      tx.set(stateRef, { revision: Number(state.data()?.revision ?? 0) + 1, tombstones: [...tombstones] });
    });
  }

  /**
   * Nearest active records by cosine, pre-filtered by persona and at most 30
   * scope keys. Candidates only: visibility is decided afterwards in code.
   */
  async findNearest(personaId: string, scopeKeys: string[], vector: number[], limit: number): Promise<MemoryRecord[]> {
    if (scopeKeys.length === 0 || vector.length === 0) return [];
    if (scopeKeys.length > MAX_FIND_NEAREST_SCOPE_KEYS) throw new RangeError('find_nearest_scope_keys');
    const bounded = Math.min(1000, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 1)));
    const snap = await this.db.collection(MEMORIES)
      .where('personaId', '==', personaId)
      .where('active', '==', true)
      .where('scopeKey', 'in', [...new Set(scopeKeys)])
      .findNearest({ vectorField: 'embedding', queryVector: [...vector], limit: bounded, distanceMeasure: 'COSINE' })
      .get();
    return snap.docs
      .map((d) => memoryFromDoc(d.id, d.data() as Record<string, unknown>))
      .filter((m) => !m.supersededBy);
  }

  async tombstonesOf(personaId: string): Promise<string[]> {
    const state = await this.db.collection(MEMORY_STATE).doc(personaId).get();
    return [...((state.data()?.tombstones ?? []) as string[])].sort();
  }

  /** Union only; never removes a tombstone and leaves the revision unchanged. */
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    assertTombstoneIds(eventIds);
    if (eventIds.length === 0) return;
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection(MEMORY_STATE).doc(personaId);
      const state = await tx.get(ref);
      const tombstones = new Set((state.data()?.tombstones ?? []) as string[]);
      for (const id of eventIds) tombstones.add(id);
      tx.set(ref, { ...state.data(), tombstones: [...tombstones].sort() });
    });
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

  async getEpoch(personaId: string): Promise<number> {
    const doc = await this.db.collection(EPOCHS).doc(personaId).get();
    return Number(doc.data()?.epoch ?? 0);
  }

  async clearPersona(personaId: string): Promise<void> {
    const epochRef = this.db.collection(EPOCHS).doc(personaId);
    const nextEpoch = await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(epochRef);
      const stateRef = this.db.collection(MEMORY_STATE).doc(personaId);
      const state = await transaction.get(stateRef);
      transaction.set(stateRef, { ...state.data(), revision: Number(state.data()?.revision ?? 0) + 1 });
      const epoch = Number(existing.data()?.epoch ?? 0) + 1;
      transaction.set(epochRef, { epoch });
      return epoch;
    });
    // listDocuments includes historical parents that have only subcollections.
    const chats = await this.db.collection(CHATS).listDocuments();
    for (const chat of chats) {
      if (!chat.id.startsWith(`${personaId}__`)) continue;
      const messages = await chat.collection('messages').get();
      for (const message of messages.docs) {
        if (Number(message.data().privacyEpoch ?? 0) < nextEpoch) await chat.collection('messages').doc(message.id).delete();
      }
    }
  }

  private messages(personaId: string, chatKey: string) {
    return this.db.collection(CHATS).doc(`${personaId}__${chatKey}`).collection('messages');
  }

  async append(personaId: string, chatKey: string, message: ChatMessage, expectedEpoch?: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const epochDoc = await tx.get(this.db.collection(EPOCHS).doc(personaId));
      const state = await tx.get(this.db.collection(MEMORY_STATE).doc(personaId));
      const epoch = Number(epochDoc.data()?.epoch ?? 0);
      if (expectedEpoch !== undefined && epoch !== expectedEpoch) return;
      if (message.privacy && Number(state.data()?.revision ?? 0) !== message.privacy.memoryRevision) return;
      tx.set(this.db.collection(CHATS).doc(`${personaId}__${chatKey}`), { personaId });
      tx.set(this.messages(personaId, chatKey).doc(), clean({ ...message, personaId, privacyEpoch: epoch }));
    });
  }

  async clear(personaId: string): Promise<void> { await this.clearPersona(personaId); }

  async recent(personaId: string, chatKey: string, limit: number): Promise<ChatMessage[]> {
    const epoch = await this.getEpoch(personaId);
    const snap = await this.messages(personaId, chatKey).orderBy('at', 'desc').limit(limit).get();
    return snap.docs
      .filter((d) => Number(d.data().privacyEpoch ?? 0) === epoch)
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
