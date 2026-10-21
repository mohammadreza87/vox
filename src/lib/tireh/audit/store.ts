/**
 * Content-free, append-only memory audit log (`vox_audit`), step 8 of
 * docs/AGENT_INTELLIGENCE_SOLUTION.md (section 4.6, "Rights and hygiene").
 *
 * A row records who did what to which memory ids, for which audience, under
 * which policy key and with what outcome. It never carries memory content,
 * topics or message text: the strict schema rejects any extra key. Rows are
 * append-only by code convention (no update or delete path besides the
 * 12-month retention sweep) until a separate service account or a
 * retention-locked export exists.
 *
 * Reserved kinds, not written yet:
 *  - `retrieval` and `prompt_memory`: TODO(worker, S05) once retrieval runs in the job worker;
 *  - `consent_change`: TODO(consent ledger) needs the adaptive consent ledger path;
 *  - `identity_change`: TODO(Step 1 / S10L) identity-level wiring.
 *
 * TODO(S08 follow-up): no scheduler calls `sweep()` yet; wire it into the
 * maintenance runner with `auditRetentionCutoff(now)`.
 */

import { createHash, randomUUID } from 'crypto';
import { appendFile, chmod, readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { MemoryRecord } from '../types';

export type AuditKind = 'write' | 'supersede' | 'share_offer' | 'share_approve' | 'revoke' | 'delete' | 'consent_change' | 'resnapshot' | 'identity_change' | 'retrieval' | 'prompt_memory'; // retrieval/prompt_memory/consent_change/identity_change: reserved, TODO (worker / Step 1)
export type AuditOutcome = 'applied' | 'denied' | 'failed' | 'previewed';
export interface AuditRow { id: string; kind: AuditKind; personaId: string; chatKeyHash?: string; audiencePersonIds: string[]; memoryIds: string[]; policyKey?: string; actorPersonId?: string; outcome: AuditOutcome; at: Date }
export type NewAuditRow = Omit<AuditRow, 'id'>;
export interface AuditStore {
  append(row: NewAuditRow): Promise<AuditRow>;
  list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]>;
  /** 12-month retention; the only removal path. */
  sweep(cutoff: Date): Promise<number>;
}

export const AUDIT_KINDS = ['write', 'supersede', 'share_offer', 'share_approve', 'revoke', 'delete', 'consent_change', 'resnapshot', 'identity_change', 'retrieval', 'prompt_memory'] as const satisfies readonly AuditKind[];
export const AUDIT_OUTCOMES = ['applied', 'denied', 'failed', 'previewed'] as const satisfies readonly AuditOutcome[];
export const AUDIT_RETENTION_DAYS = 365;
const MAX_IDS = 200;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Opaque ids only: no whitespace, so free text cannot pass as an id. */
export const auditIdSchema = z.string().regex(/^[A-Za-z0-9._:@-]{1,200}$/);

export const auditRowSchema: z.ZodType<NewAuditRow> = z.object({
  kind: z.enum(AUDIT_KINDS),
  personaId: auditIdSchema,
  chatKeyHash: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  audiencePersonIds: z.array(auditIdSchema).max(MAX_IDS),
  memoryIds: z.array(auditIdSchema).max(MAX_IDS),
  policyKey: z.string().regex(/^[a-z0-9._:-]{1,120}$/).optional(),
  actorPersonId: auditIdSchema.optional(),
  outcome: z.enum(AUDIT_OUTCOMES),
  at: z.date(),
}).strict();

const ids = (values: readonly string[]): string[] => [...new Set(values)].sort().slice(0, MAX_IDS);

/** Sorts, de-duplicates and caps the id arrays, then validates strictly. */
export function normalizeAuditRow(row: NewAuditRow): NewAuditRow {
  return auditRowSchema.parse({ ...row, audiencePersonIds: ids(row.audiencePersonIds ?? []), memoryIds: ids(row.memoryIds ?? []) });
}

export function auditRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000);
}

/** sha256 of the chat key, hex, first 32 characters: correlatable, not reversible to a chat id list. */
export function chatKeyHash(chatKey: string): string {
  return createHash('sha256').update(chatKey).digest('hex').slice(0, 32);
}

/** The gateway chat key of the conversation a memory came from. */
export function sourceChatKey(memory: Pick<MemoryRecord, 'source'>): string {
  return memory.source.chatKind === 'group' ? `group-${memory.source.groupId}` : `private-${memory.source.personId}`;
}

function clampLimit(limit?: number): number {
  return Math.max(1, Math.min(MAX_LIMIT, Number.isSafeInteger(limit) ? limit! : DEFAULT_LIMIT));
}

function matches(row: AuditRow, filter: { personaId: string; memoryId?: string; since?: Date }): boolean {
  return row.personaId === filter.personaId && (filter.memoryId === undefined || row.memoryIds.includes(filter.memoryId)) &&
    (filter.since === undefined || row.at.getTime() >= filter.since.getTime());
}

function newestFirst(rows: AuditRow[], limit?: number): AuditRow[] {
  return [...rows].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, clampLimit(limit));
}

export class InMemoryAuditStore implements AuditStore {
  readonly rows: AuditRow[] = [];

  async append(row: NewAuditRow): Promise<AuditRow> {
    const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
    this.rows.push(stored);
    return stored;
  }

  async list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]> {
    return newestFirst(this.rows.filter((row) => matches(row, filter)), filter.limit);
  }

  async sweep(cutoff: Date): Promise<number> {
    const before = this.rows.length;
    const kept = this.rows.filter((row) => row.at.getTime() >= cutoff.getTime());
    this.rows.splice(0, this.rows.length, ...kept);
    return before - kept.length;
  }
}

function reviveRow(line: string): AuditRow | null {
  try {
    const value = JSON.parse(line) as AuditRow & { at: string };
    return { ...value, at: new Date(value.at) };
  } catch { return null; }
}

/** Append-only JSONL (mode 0o600). Appends are serialized in-process; sweep is the only rewrite. */
export function createFileAuditStore(path: string): AuditStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = chain.then(operation, operation);
    chain = next.catch(() => undefined);
    return next;
  };
  const readAll = async (): Promise<AuditRow[]> => {
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(reviveRow).filter((row): row is AuditRow => !!row);
  };
  return {
    append: (row) => serial(async () => {
      const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
      await appendFile(path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
      return stored;
    }),
    list: (filter) => serial(async () => newestFirst((await readAll()).filter((row) => matches(row, filter)), filter.limit)),
    sweep: (cutoff) => serial(async () => {
      const rows = await readAll();
      const kept = rows.filter((row) => row.at.getTime() >= cutoff.getTime());
      if (kept.length === rows.length) return 0;
      await writeFile(`${path}.tmp`, kept.map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 });
      await chmod(`${path}.tmp`, 0o600);
      await rename(`${path}.tmp`, path);
      return rows.length - kept.length;
    }),
  };
}

const AUDIT_COLLECTION = 'vox_audit';

/** Firestore Timestamp or Date to Date. */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const timestamp = value as { toDate?: () => Date } | undefined;
  return typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(NaN);
}

/** Drops undefined fields (Firestore rejects them); Dates are kept. */
export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Firestore collection `vox_audit`, one document per row, created with
 * `create()` so an id is never overwritten.
 *
 * Composite indexes the integrator must add to firestore.indexes.json (owned by S06):
 *  - vox_audit: personaId ASC, at DESC
 *  - vox_audit: personaId ASC, memoryIds ARRAY_CONTAINS, at DESC
 * The retention sweep (`at <` cutoff) uses the automatic single-field index.
 */
export class FirestoreAuditStore implements AuditStore {
  constructor(private readonly db: Firestore) {}

  async append(row: NewAuditRow): Promise<AuditRow> {
    const stored: AuditRow = { id: randomUUID(), ...normalizeAuditRow(row) };
    await this.db.collection(AUDIT_COLLECTION).doc(stored.id).create(withoutUndefined(stored));
    return stored;
  }

  async list(filter: { personaId: string; memoryId?: string; since?: Date; limit?: number }): Promise<AuditRow[]> {
    let query = this.db.collection(AUDIT_COLLECTION).where('personaId', '==', filter.personaId);
    if (filter.memoryId !== undefined) query = query.where('memoryIds', 'array-contains', filter.memoryId);
    if (filter.since !== undefined) query = query.where('at', '>=', filter.since);
    const snapshot = await query.orderBy('at', 'desc').limit(clampLimit(filter.limit)).get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<AuditRow, 'at'> & { at: unknown };
      return { ...data, id: data.id ?? doc.id, at: toDate(data.at) };
    });
  }

  async sweep(cutoff: Date): Promise<number> {
    let removed = 0;
    for (;;) {
      const snapshot = await this.db.collection(AUDIT_COLLECTION).where('at', '<', cutoff).limit(400).get();
      if (snapshot.docs.length === 0) return removed;
      const batch = this.db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += snapshot.docs.length;
      if (snapshot.docs.length < 400) return removed;
    }
  }
}
