/**
 * Firestore implementations of the content-free audit log (`vox_audit`) and
 * the supersede notices (`tireh_supersede_notices`).
 *
 * vox_audit list() needs one composite index (personaId ASC, at DESC). S06
 * owns firestore.indexes.json, so the integrator adds it after both merge;
 * until then list() fails on Firestore while append and sweep work. memoryId
 * and since are filtered in memory so no further index is needed.
 *
 * Notices are fanned out to one document per (notice, recipient). listFor
 * needs a composite index (personaId ASC, recipientPersonId ASC, at DESC),
 * kept in firestore.indexes.json, so the read is bounded by MAX_NOTICE_LIST.
 * The erasure deletes use single-field filters only.
 */

import { createHash, randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { clampAuditLimit, normalizeAuditRow, selectAuditRows, type AuditRow, type AuditStore, type NewAuditRow } from './store';
import { MAX_NOTICE_LIST, validateNotice, type SupersededNotice, type SupersededNoticeStore } from './notices';

export const AUDIT_COLLECTION = 'vox_audit';
export const NOTICE_COLLECTION = 'tireh_supersede_notices';
const SWEEP_BATCH = 400;

/** Firestore Timestamp or Date to Date. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const timestamp = value as { toDate?: () => Date } | undefined;
  return typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(NaN);
}

/** Drops undefined fields (Firestore rejects them); Dates are kept. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export class FirestoreAuditStore implements AuditStore {
  constructor(private readonly db: Firestore) {}

  /** create() is the append-only convention: an existing id is never overwritten. */
  async append(row: NewAuditRow): Promise<AuditRow> {
    const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
    await this.db.collection(AUDIT_COLLECTION).doc(stored.id).create(clean(stored));
    return stored;
  }

  async list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]> {
    const snapshot = await this.db.collection(AUDIT_COLLECTION)
      .where('personaId', '==', filter.personaId)
      .orderBy('at', 'desc')
      .limit(clampAuditLimit(filter.limit))
      .get();
    const rows = snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<AuditRow, 'at'> & { at: unknown };
      return { ...data, id: data.id ?? doc.id, at: toDate(data.at) };
    });
    return selectAuditRows(rows, filter);
  }

  async sweep(cutoff: Date): Promise<number> {
    let removed = 0;
    for (;;) {
      const snapshot = await this.db.collection(AUDIT_COLLECTION).where('at', '<', cutoff).limit(SWEEP_BATCH).get();
      if (snapshot.docs.length === 0) return removed;
      const batch = this.db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += snapshot.docs.length;
      if (snapshot.docs.length < SWEEP_BATCH) return removed;
    }
  }
}

interface NoticeDoc { noticeId: string; personaId: string; oldMemoryId: string; newMemoryId: string; ownerPersonId: string; recipientPersonId: string; recipientPersonIds: string[]; at: unknown }

export class FirestoreSupersededNoticeStore implements SupersededNoticeStore {
  constructor(private readonly db: Firestore) {}

  async record(n: Omit<SupersededNotice, 'id'>): Promise<void> {
    const notice = validateNotice(n);
    const batch = this.db.batch();
    for (const recipientPersonId of notice.recipientPersonIds) {
      const docId = `${notice.id}__${createHash('sha256').update(recipientPersonId).digest('hex').slice(0, 16)}`;
      const { id, ...rest } = notice;
      batch.create(this.db.collection(NOTICE_COLLECTION).doc(docId), clean({ ...rest, noticeId: id, recipientPersonId }));
    }
    await batch.commit();
  }

  async listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]> {
    let query = this.db.collection(NOTICE_COLLECTION)
      .where('personaId', '==', personaId)
      .where('recipientPersonId', '==', recipientPersonId);
    if (since !== undefined) query = query.where('at', '>=', since);
    const snapshot = await query.orderBy('at', 'desc').limit(MAX_NOTICE_LIST).get();
    return snapshot.docs
      .map((doc) => {
        const data = doc.data() as NoticeDoc;
        return { id: data.noticeId, personaId: data.personaId, oldMemoryId: data.oldMemoryId, newMemoryId: data.newMemoryId,
          ownerPersonId: data.ownerPersonId, recipientPersonIds: data.recipientPersonIds, at: toDate(data.at) };
      })
      .filter((n) => since === undefined || n.at.getTime() >= since.getTime())
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, MAX_NOTICE_LIST);
  }

  async deleteByMemoryIds(memoryIds: readonly string[]): Promise<number> {
    let removed = 0;
    for (const id of new Set(memoryIds)) {
      removed += await this.deleteWhere('oldMemoryId', '==', id);
      removed += await this.deleteWhere('newMemoryId', '==', id);
    }
    return removed;
  }

  /** Every copy of a notice that names the person, as owner or among its recipients. */
  async deleteForPerson(personId: string): Promise<number> {
    return await this.deleteWhere('ownerPersonId', '==', personId) + await this.deleteWhere('recipientPersonIds', 'array-contains', personId);
  }

  private async deleteWhere(field: string, op: '==' | 'array-contains', value: string): Promise<number> {
    let removed = 0;
    for (;;) {
      const snapshot = await this.db.collection(NOTICE_COLLECTION).where(field, op, value).limit(SWEEP_BATCH).get();
      if (snapshot.docs.length === 0) return removed;
      const batch = this.db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += snapshot.docs.length;
      if (snapshot.docs.length < SWEEP_BATCH) return removed;
    }
  }
}
