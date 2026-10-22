/**
 * Content-free "updated" notices (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.6,
 * "Work fact told privately"): when the owner corrects a record they shared,
 * its recipients learn that it changed instead of it silently disappearing.
 * A notice holds ids, person ids and a time, never content or a topic. It
 * grants nothing: whether the replacement is visible is decided by
 * visibility.ts at read time. Recorded only for people/project-scoped records
 * under TIREH_SHARING_V2 (see memory-decorator.ts).
 */

import { randomUUID } from 'crypto';
import { chmod, readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';
import { auditIdSchema } from './store';

export interface SupersededNotice { id: string; personaId: string; oldMemoryId: string; newMemoryId: string; ownerPersonId: string; recipientPersonIds: string[]; at: Date } // content-free
export interface SupersededNoticeStore {
  record(n: Omit<SupersededNotice, 'id'>): Promise<void>;
  listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]>;
}

const MAX_RECIPIENTS = 200;
export const MAX_NOTICE_LIST = 200;
export const MAX_NOTICE_FILE_ROWS = 5000;

export const supersededNoticeSchema = z.object({
  personaId: auditIdSchema,
  oldMemoryId: auditIdSchema,
  newMemoryId: auditIdSchema,
  ownerPersonId: auditIdSchema,
  recipientPersonIds: z.array(auditIdSchema).min(1).max(MAX_RECIPIENTS),
  at: z.date().refine((date) => !Number.isNaN(date.getTime()), 'invalid date'),
}).strict();

/** Sorts and de-duplicates recipients, validates strictly and assigns an id. */
export function validateNotice(notice: Omit<SupersededNotice, 'id'>): SupersededNotice {
  const parsed = supersededNoticeSchema.parse({ ...notice, recipientPersonIds: [...new Set(notice.recipientPersonIds ?? [])].sort() });
  return { id: randomUUID(), ...parsed };
}

function select(notices: readonly SupersededNotice[], personaId: string, recipientPersonId: string, since?: Date): SupersededNotice[] {
  return notices
    .filter((n) => n.personaId === personaId && n.recipientPersonIds.includes(recipientPersonId) && (since === undefined || n.at.getTime() >= since.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_NOTICE_LIST);
}

export class InMemorySupersededNoticeStore implements SupersededNoticeStore {
  readonly notices: SupersededNotice[] = [];

  async record(n: Omit<SupersededNotice, 'id'>): Promise<void> {
    this.notices.push(validateNotice(n));
  }

  async listFor(personaId: string, recipientPersonId: string, since?: Date): Promise<SupersededNotice[]> {
    return select(this.notices, personaId, recipientPersonId, since);
  }
}

/** One JSON array file (mode 0o600), rewritten through tmp + rename, serialized in-process, capped at 5000 rows (oldest dropped). */
export function createFileSupersededNoticeStore(path: string): SupersededNoticeStore {
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
      const notice = validateNotice(n);
      const rows = [...await readAll(), notice]
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .slice(-MAX_NOTICE_FILE_ROWS);
      await writeFile(`${path}.tmp`, JSON.stringify(rows), { mode: 0o600 });
      await chmod(`${path}.tmp`, 0o600);
      await rename(`${path}.tmp`, path);
    }),
    listFor: (personaId, recipientPersonId, since) => serial(async () => select(await readAll(), personaId, recipientPersonId, since)),
  };
}
