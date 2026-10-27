import { fileRuntimeFs, fileRuntimePromises, assertFileRuntimePath } from '../../studio/file-runtime-owner';
const { chmod, readFile, rename, writeFile } = fileRuntimePromises;
const { existsSync } = fileRuntimeFs;
/**
 * Content-free "updated" notices (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.6,
 * "Work fact told privately"): when the owner corrects a record they shared,
 * its recipients learn that it changed instead of it silently disappearing.
 * A notice holds ids, person ids and a time, never content or a topic. It
 * grants nothing: whether the new record is still visible is decided by
 * visibility.ts at read time.
 */

import { randomUUID } from 'crypto';


import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { auditIdSchema, toDate, withoutUndefined } from './store';

export interface SupersededNotice { id: string; personaId: string; oldMemoryId: string; newMemoryId: string; ownerPersonId: string; recipientPersonIds: string[]; at: Date } // content-free
export interface SupersededNoticeStore {
  record(n: Omit<SupersededNotice, 'id'>): Promise<void>;
  listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]>;
}

const MAX_RECIPIENTS = 200;
const LIST_LIMIT = 50;

export const supersededNoticeSchema = z.object({
  personaId: auditIdSchema,
  oldMemoryId: auditIdSchema,
  newMemoryId: auditIdSchema,
  ownerPersonId: auditIdSchema,
  recipientPersonIds: z.array(auditIdSchema).min(1).max(MAX_RECIPIENTS),
  at: z.date(),
}).strict();

function validated(notice: Omit<SupersededNotice, 'id'>): SupersededNotice {
  const parsed = supersededNoticeSchema.parse({ ...notice, recipientPersonIds: [...new Set(notice.recipientPersonIds ?? [])].sort() });
  return { id: randomUUID(), ...parsed };
}

function select(notices: readonly SupersededNotice[], personaId: string, recipientPersonId: string, since?: Date): SupersededNotice[] {
  return notices
    .filter((n) => n.personaId === personaId && n.recipientPersonIds.includes(recipientPersonId) && (since === undefined || n.at.getTime() >= since.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, LIST_LIMIT);
}

export class InMemorySupersededNoticeStore implements SupersededNoticeStore {
  readonly notices: SupersededNotice[] = [];

  async record(n: Omit<SupersededNotice, 'id'>): Promise<void> {
    this.notices.push(validated(n));
  }

  async listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]> {
    return select(this.notices, personaId, recipientPersonId, since);
  }
}

/** One JSON array file (mode 0o600), rewritten through tmp + rename, serialized in-process. */
export function createFileSupersededNoticeStore(path: string): SupersededNoticeStore {
  assertFileRuntimePath(path);
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = chain.then(operation, operation);
    chain = next.catch(() => undefined);
    return next;
  };
  const readAll = async (): Promise<SupersededNotice[]> => {
    if (!existsSync(path)) return [];
    const rows = JSON.parse(await readFile(path, 'utf8')) as Array<SupersededNotice & { at: string }>;
    return rows.map((row) => ({ ...row, at: new Date(row.at) }));
  };
  return {
    record: (n) => serial(async () => {
      const notice = validated(n);
      const rows = await readAll();
      rows.push(notice);
      await writeFile(`${path}.tmp`, JSON.stringify(rows), { mode: 0o600 });
      await chmod(`${path}.tmp`, 0o600);
      await rename(`${path}.tmp`, path);
    }),
    listFor: (personaId, recipientPersonId, since) => serial(async () => select(await readAll(), personaId, recipientPersonId, since)),
  };
}

const NOTICE_COLLECTION = 'tireh_supersede_notices';

/**
 * Firestore collection `tireh_supersede_notices`.
 * Composite index the integrator must add to firestore.indexes.json (owned by S06):
 *  - tireh_supersede_notices: personaId ASC, recipientPersonIds ARRAY_CONTAINS
 * `since` is filtered in memory after a bounded read so no range index is needed.
 */
export class FirestoreSupersededNoticeStore implements SupersededNoticeStore {
  constructor(private readonly db: Firestore) {}

  async record(n: Omit<SupersededNotice, 'id'>): Promise<void> {
    const notice = validated(n);
    await this.db.collection(NOTICE_COLLECTION).doc(notice.id).create(withoutUndefined(notice));
  }

  async listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]> {
    const snapshot = await this.db.collection(NOTICE_COLLECTION)
      .where('personaId', '==', personaId)
      .where('recipientPersonIds', 'array-contains', recipientPersonId)
      .limit(200).get();
    const rows = snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<SupersededNotice, 'at'> & { at: unknown };
      return { ...data, id: data.id ?? doc.id, at: toDate(data.at) };
    });
    return select(rows, personaId, recipientPersonId, since);
  }
}
