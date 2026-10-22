/**
 * Isolated voiceprint template store 'vox_voiceprints' (S11L), file and
 * Firestore. It holds only the AES-256-GCM sealed template (crypto.ts) and the
 * contract metadata. Raw samples, transcripts and query audio never reach a
 * store: the row schema is strict, so an extra key such as 'audio' or 'sample'
 * is rejected on write and dropped on read.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export type VoiceSpace = 'work' | 'personal';
export type VoiceChannel = 'telegram_voice_note' | 'mini_app';

export interface VoiceprintRow {
  personId: string;
  space: 'work' | 'personal';
  provider: string;
  modelVersion: string;
  channel: 'telegram_voice_note' | 'mini_app';
  consentEventId: string;
  createdAt: Date;
  lastConfirmedAt?: Date;
  /** AES-256-GCM sealed, VOICEPRINT_KEY. */
  template: string;
}

export interface VoiceprintStore {
  get(personId: string, space: VoiceSpace): Promise<VoiceprintRow | null>;
  /** Replaces any existing row for the same person and space. */
  put(row: VoiceprintRow): Promise<void>;
  touch(personId: string, space: VoiceSpace, lastConfirmedAt: Date): Promise<void>;
  /** Deletes one space, or both when `space` is omitted. Returns the number of rows removed. */
  delete(personId: string, space?: VoiceSpace): Promise<number>;
  /** Every row; used only by the retention sweep. */
  list(): Promise<VoiceprintRow[]>;
}

const SPACES: readonly VoiceSpace[] = ['work', 'personal'];
const id = z.string().min(1).max(200);
const validDate = z.date().refine(d => Number.isFinite(d.getTime()));
export const voiceprintRowSchema = z.object({
  personId: id,
  space: z.enum(['work', 'personal']),
  provider: id,
  modelVersion: id,
  channel: z.enum(['telegram_voice_note', 'mini_app']),
  consentEventId: id,
  createdAt: validDate,
  lastConfirmedAt: validDate.optional(),
  template: z.string().min(1).max(200_000).regex(/^vp1\./),
}).strict();

/** sha256(JSON ['vox_voiceprints', personId, space]) hex, first 40 chars. No person id appears in a doc id. */
export function voiceprintDocId(personId: string, space: VoiceSpace): string {
  return createHash('sha256').update(JSON.stringify(['vox_voiceprints', personId, space])).digest('hex').slice(0, 40);
}

const copy = (row: VoiceprintRow): VoiceprintRow => ({
  ...row, createdAt: new Date(row.createdAt.getTime()),
  ...(row.lastConfirmedAt ? { lastConfirmedAt: new Date(row.lastConfirmedAt.getTime()) } : {}),
});
/** Read path: an invalid row is dropped (null). */
const valid = (raw: unknown): VoiceprintRow | null => {
  const parsed = voiceprintRowSchema.safeParse(raw);
  return parsed.success ? copy(parsed.data) : null;
};
/** Write path: anything but an exact contract row throws. */
const required = (row: VoiceprintRow): VoiceprintRow => {
  const parsed = voiceprintRowSchema.safeParse(row);
  if (!parsed.success) throw new Error('invalid_voiceprint_row');
  return copy(parsed.data);
};
const same = (row: VoiceprintRow, personId: string, space?: VoiceSpace) => row.personId === personId && (!space || row.space === space);

export class InMemoryVoiceprintStore implements VoiceprintStore {
  protected rows: VoiceprintRow[] = [];

  async get(personId: string, space: VoiceSpace): Promise<VoiceprintRow | null> {
    const row = this.rows.find(r => same(r, personId, space));
    return row ? valid(row) : null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = required(row);
    this.rows = [...this.rows.filter(r => !same(r, next.personId, next.space)), next];
  }
  async touch(personId: string, space: VoiceSpace, lastConfirmedAt: Date): Promise<void> {
    this.rows = this.rows.map(r => same(r, personId, space) ? required({ ...r, lastConfirmedAt }) : r);
  }
  async delete(personId: string, space?: VoiceSpace): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !same(r, personId, space));
    return before - this.rows.length;
  }
  async list(): Promise<VoiceprintRow[]> {
    return this.rows.map(valid).filter((r): r is VoiceprintRow => !!r);
  }
}

const toJson = (row: VoiceprintRow) => ({
  ...row, createdAt: row.createdAt.toISOString(), ...(row.lastConfirmedAt ? { lastConfirmedAt: row.lastConfirmedAt.toISOString() } : {}),
});
const isoDate = (value: unknown): unknown => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) ? new Date(value) : value;
const fromJson = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  value.createdAt = isoDate(value.createdAt);
  if ('lastConfirmedAt' in value) value.lastConfirmedAt = isoDate(value.lastConfirmedAt);
  return value;
};

/**
 * Local file profile: `{version: 1, rows}` with ISO dates. Writes are
 * serialized, written to `<path>.tmp` (mode 0600), fsynced and renamed, as in
 * src/lib/relationships/file-store.ts. Every read validates each row and drops
 * invalid ones.
 */
export class FileVoiceprintStore implements VoiceprintStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  private load(): VoiceprintRow[] {
    if (!existsSync(this.path)) return [];
    let data: unknown;
    try { data = JSON.parse(readFileSync(this.path, 'utf8')); } catch { throw new Error('invalid_voiceprint_store'); }
    const doc = data as { version?: unknown; rows?: unknown };
    if (!doc || doc.version !== 1 || !Array.isArray(doc.rows)) throw new Error('invalid_voiceprint_store');
    return doc.rows.map(r => valid(fromJson(r))).filter((r): r is VoiceprintRow => !!r);
  }

  private write(rows: VoiceprintRow[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, rows: rows.map(toJson) }), { mode: 0o600 });
    const fd = openSync(temporary, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path);
  }

  private mutate<T>(fn: (rows: VoiceprintRow[]) => { rows: VoiceprintRow[]; result: T; changed: boolean }): Promise<T> {
    const run = this.queue.then(() => {
      const { rows, result, changed } = fn(this.load());
      if (changed) this.write(rows);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async get(personId: string, space: VoiceSpace): Promise<VoiceprintRow | null> {
    await this.queue;
    return this.load().find(r => same(r, personId, space)) ?? null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = required(row);
    await this.mutate(rows => ({ rows: [...rows.filter(r => !same(r, next.personId, next.space)), next], result: undefined, changed: true }));
  }
  async touch(personId: string, space: VoiceSpace, lastConfirmedAt: Date): Promise<void> {
    await this.mutate(rows => {
      const changed = rows.some(r => same(r, personId, space));
      return { rows: rows.map(r => same(r, personId, space) ? required({ ...r, lastConfirmedAt }) : r), result: undefined, changed };
    });
  }
  async delete(personId: string, space?: VoiceSpace): Promise<number> {
    return this.mutate(rows => {
      const kept = rows.filter(r => !same(r, personId, space));
      return { rows: kept, result: rows.length - kept.length, changed: kept.length !== rows.length };
    });
  }
  async list(): Promise<VoiceprintRow[]> {
    await this.queue;
    return this.load();
  }
}

const toDate = (value: unknown): unknown =>
  value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function' ? (value as { toDate(): Date }).toDate() : value;
const fromDoc = (data: Record<string, unknown> | undefined): unknown => {
  if (!data) return null;
  const value: Record<string, unknown> = { ...data, createdAt: toDate(data.createdAt) };
  if ('lastConfirmedAt' in data) value.lastConfirmedAt = toDate(data.lastConfirmedAt);
  return value;
};
const toDoc = (row: VoiceprintRow): Record<string, unknown> => {
  const { lastConfirmedAt, ...rest } = row;
  return { ...rest, ...(lastConfirmedAt ? { lastConfirmedAt } : {}) };
};

/** Firestore collection 'vox_voiceprints'; doc ids from voiceprintDocId. Only the contract fields are written. */
export class FirestoreVoiceprintStore implements VoiceprintStore {
  constructor(private readonly db: Firestore, private readonly collection = 'vox_voiceprints') {}

  private ref(personId: string, space: VoiceSpace) {
    return this.db.collection(this.collection).doc(voiceprintDocId(personId, space));
  }

  async get(personId: string, space: VoiceSpace): Promise<VoiceprintRow | null> {
    const snap = await this.ref(personId, space).get();
    if (!snap.exists) return null;
    const row = valid(fromDoc(snap.data()));
    return row && same(row, personId, space) ? row : null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = required(row);
    await this.ref(next.personId, next.space).set(toDoc(next));
  }
  async touch(personId: string, space: VoiceSpace, lastConfirmedAt: Date): Promise<void> {
    const row = await this.get(personId, space);
    if (!row) return;
    await this.ref(personId, space).set(toDoc(required({ ...row, lastConfirmedAt })));
  }
  async delete(personId: string, space?: VoiceSpace): Promise<number> {
    let count = 0;
    for (const s of space ? [space] : SPACES) {
      const ref = this.ref(personId, s);
      const snap = await ref.get();
      if (!snap.exists) continue;
      await ref.delete();
      count++;
    }
    return count;
  }
  async list(): Promise<VoiceprintRow[]> {
    const snap = await this.db.collection(this.collection).get();
    return snap.docs.map(doc => valid(fromDoc(doc.data()))).filter((r): r is VoiceprintRow => !!r);
  }
}
