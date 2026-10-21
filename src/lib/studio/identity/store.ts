/**
 * Isolated voiceprint template store 'vox_voiceprints' (S11L). It holds only
 * sealed templates (AES-256-GCM with VOICEPRINT_KEY, see crypto.ts) and the
 * contract metadata. Raw audio samples are never accepted by any method and
 * never persisted. Rows are validated with a strict schema on every read;
 * anything else is dropped from results.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

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

/** Template of a persona voice Vox generated (self-echo guard). Sealed like a person's. */
export interface EchoTemplateRow {
  voiceId: string;
  provider: string;
  modelVersion: string;
  createdAt: Date;
  template: string;
}

export interface VoiceprintStore {
  get(personId: string, space: 'work' | 'personal'): Promise<VoiceprintRow | null>;
  put(row: VoiceprintRow): Promise<void>;
  /** Deletes one space, or every space when `space` is omitted. Returns the number of rows removed. */
  delete(personId: string, space?: 'work' | 'personal'): Promise<number>;
  listEcho(provider: string, modelVersion: string): Promise<EchoTemplateRow[]>;
  putEcho(row: EchoTemplateRow): Promise<void>;
}

const id = z.string().min(1).max(200);
const sealed = z.string().min(1).max(200_000).regex(/^vpk1\./);
const space = z.enum(['work', 'personal']);
const channel = z.enum(['telegram_voice_note', 'mini_app']);
const validDate = z.date().refine(d => Number.isFinite(d.getTime()));

const rowSchema = z.object({
  personId: id, space, provider: id, modelVersion: id, channel, consentEventId: id,
  createdAt: validDate, lastConfirmedAt: validDate.optional(), template: sealed,
}).strict();
const echoSchema = z.object({ voiceId: id, provider: id, modelVersion: id, createdAt: validDate, template: sealed }).strict();

const clone = <T extends VoiceprintRow | EchoTemplateRow>(row: T): T => {
  const copy = { ...row } as T & { createdAt: Date; lastConfirmedAt?: Date };
  copy.createdAt = new Date(row.createdAt.getTime());
  if ('lastConfirmedAt' in row && row.lastConfirmedAt) copy.lastConfirmedAt = new Date(row.lastConfirmedAt.getTime());
  return copy;
};

/** Strict validation on read: an invalid row is dropped (null). */
function validRow(raw: unknown): VoiceprintRow | null {
  const parsed = rowSchema.safeParse(raw);
  return parsed.success ? clone(parsed.data as VoiceprintRow) : null;
}
function validEcho(raw: unknown): EchoTemplateRow | null {
  const parsed = echoSchema.safeParse(raw);
  return parsed.success ? clone(parsed.data as EchoTemplateRow) : null;
}
/** Writes refuse anything that is not exactly a sealed contract row. */
function requireRow(row: VoiceprintRow): VoiceprintRow {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) throw new Error('Invalid voiceprint row');
  return clone(parsed.data as VoiceprintRow);
}
function requireEcho(row: EchoTemplateRow): EchoTemplateRow {
  const parsed = echoSchema.safeParse(row);
  if (!parsed.success) throw new Error('Invalid echo template row');
  return clone(parsed.data as EchoTemplateRow);
}

export class InMemoryVoiceprintStore implements VoiceprintStore {
  protected rows: VoiceprintRow[] = [];
  protected echo: EchoTemplateRow[] = [];

  async get(personId: string, s: 'work' | 'personal'): Promise<VoiceprintRow | null> {
    const row = this.rows.find(r => r.personId === personId && r.space === s);
    return row ? validRow(row) : null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = requireRow(row);
    this.rows = [...this.rows.filter(r => !(r.personId === next.personId && r.space === next.space)), next];
  }
  async delete(personId: string, s?: 'work' | 'personal'): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !(r.personId === personId && (!s || r.space === s)));
    return before - this.rows.length;
  }
  async listEcho(provider: string, modelVersion: string): Promise<EchoTemplateRow[]> {
    return this.echo.filter(e => e.provider === provider && e.modelVersion === modelVersion)
      .map(validEcho).filter((e): e is EchoTemplateRow => !!e);
  }
  async putEcho(row: EchoTemplateRow): Promise<void> {
    const next = requireEcho(row);
    this.echo = [...this.echo.filter(e => !(e.voiceId === next.voiceId && e.provider === next.provider && e.modelVersion === next.modelVersion)), next];
  }
}

interface FileDocument { version: 1; rows: unknown[]; echo: unknown[] }
const toJson = (row: VoiceprintRow | EchoTemplateRow) => ({
  ...row, createdAt: row.createdAt.toISOString(),
  ...('lastConfirmedAt' in row && row.lastConfirmedAt ? { lastConfirmedAt: row.lastConfirmedAt.toISOString() } : {}),
});
const isoDate = (value: unknown): unknown => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? new Date(value) : value;
const fromJson = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = { ...(raw as Record<string, unknown>) };
  value.createdAt = isoDate(value.createdAt);
  if ('lastConfirmedAt' in value) value.lastConfirmedAt = isoDate(value.lastConfirmedAt);
  return value;
};

/**
 * Local file profile: one JSON document (mode 0600) beside the Studio state.
 * Writes are serialized, written to a temporary file, fsynced and renamed.
 * The file is re-read before each mutation so two instances stay consistent.
 */
export class FileVoiceprintStore implements VoiceprintStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private load(): { rows: VoiceprintRow[]; echo: EchoTemplateRow[] } {
    if (!existsSync(this.path)) return { rows: [], echo: [] };
    const data = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileDocument>;
    if (data.version !== 1 || !Array.isArray(data.rows) || !Array.isArray(data.echo)) throw new Error('Invalid voiceprint store');
    return {
      rows: data.rows.map(r => validRow(fromJson(r))).filter((r): r is VoiceprintRow => !!r),
      echo: data.echo.map(e => validEcho(fromJson(e))).filter((e): e is EchoTemplateRow => !!e),
    };
  }

  private write(rows: VoiceprintRow[], echo: EchoTemplateRow[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const document: FileDocument = { version: 1, rows: rows.map(toJson), echo: echo.map(toJson) };
    writeFileSync(temporary, JSON.stringify(document), { mode: 0o600 });
    const fd = openSync(temporary, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path);
  }

  private mutate<T>(fn: (state: { rows: VoiceprintRow[]; echo: EchoTemplateRow[] }) => T): Promise<T> {
    const run = this.queue.then(() => {
      const state = this.load();
      const result = fn(state);
      this.write(state.rows, state.echo);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async get(personId: string, s: 'work' | 'personal'): Promise<VoiceprintRow | null> {
    await this.queue;
    return this.load().rows.find(r => r.personId === personId && r.space === s) ?? null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = requireRow(row);
    return this.mutate(state => {
      state.rows = [...state.rows.filter(r => !(r.personId === next.personId && r.space === next.space)), next];
    });
  }
  async delete(personId: string, s?: 'work' | 'personal'): Promise<number> {
    await this.queue;
    if (!this.load().rows.some(r => r.personId === personId && (!s || r.space === s))) return 0;
    return this.mutate(state => {
      const before = state.rows.length;
      state.rows = state.rows.filter(r => !(r.personId === personId && (!s || r.space === s)));
      return before - state.rows.length;
    });
  }
  async listEcho(provider: string, modelVersion: string): Promise<EchoTemplateRow[]> {
    await this.queue;
    return this.load().echo.filter(e => e.provider === provider && e.modelVersion === modelVersion);
  }
  async putEcho(row: EchoTemplateRow): Promise<void> {
    const next = requireEcho(row);
    return this.mutate(state => {
      state.echo = [...state.echo.filter(e => !(e.voiceId === next.voiceId && e.provider === next.provider && e.modelVersion === next.modelVersion)), next];
    });
  }
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
const toDate = (value: unknown): unknown =>
  value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
    ? (value as { toDate(): Date }).toDate() : value;
function fromDoc(data: Record<string, unknown> | undefined, kind: 'person' | 'echo'): unknown {
  if (!data || data.kind !== kind) return null;
  const { kind: _kind, ...rest } = data;
  void _kind;
  const value: Record<string, unknown> = { ...rest, createdAt: toDate(rest.createdAt) };
  if ('lastConfirmedAt' in rest) value.lastConfirmedAt = toDate(rest.lastConfirmedAt);
  return value;
}

/**
 * Firestore collection 'vox_voiceprints'. Document ids are hashes, so no
 * person id appears in an id. Queries are equality-only (no composite index).
 */
export class FirestoreVoiceprintStore implements VoiceprintStore {
  constructor(private readonly db: Firestore, private readonly collection = 'vox_voiceprints') {}

  private personRef(personId: string, s: 'work' | 'personal') {
    return this.db.collection(this.collection).doc(`p_${hash([personId, s])}`);
  }
  private echoRef(voiceId: string, provider: string, modelVersion: string) {
    return this.db.collection(this.collection).doc(`e_${hash([voiceId, provider, modelVersion])}`);
  }

  async get(personId: string, s: 'work' | 'personal'): Promise<VoiceprintRow | null> {
    const snap = await this.personRef(personId, s).get();
    if (!snap.exists) return null;
    const row = validRow(fromDoc(snap.data(), 'person'));
    return row && row.personId === personId && row.space === s ? row : null;
  }
  async put(row: VoiceprintRow): Promise<void> {
    const next = requireRow(row);
    const { lastConfirmedAt, ...rest } = next;
    await this.personRef(next.personId, next.space).set({ kind: 'person', ...rest, ...(lastConfirmedAt ? { lastConfirmedAt } : {}) });
  }
  async delete(personId: string, s?: 'work' | 'personal'): Promise<number> {
    if (s) {
      const ref = this.personRef(personId, s);
      const snap = await ref.get();
      if (!snap.exists) return 0;
      await ref.delete();
      return 1;
    }
    const snap = await this.db.collection(this.collection).where('kind', '==', 'person').where('personId', '==', personId).get();
    await Promise.all(snap.docs.map(doc => doc.ref.delete()));
    return snap.docs.length;
  }
  async listEcho(provider: string, modelVersion: string): Promise<EchoTemplateRow[]> {
    const snap = await this.db.collection(this.collection).where('kind', '==', 'echo')
      .where('provider', '==', provider).where('modelVersion', '==', modelVersion).get();
    return snap.docs.map(doc => validEcho(fromDoc(doc.data(), 'echo')))
      .filter((e): e is EchoTemplateRow => !!e && e.provider === provider && e.modelVersion === modelVersion);
  }
  async putEcho(row: EchoTemplateRow): Promise<void> {
    const next = requireEcho(row);
    await this.echoRef(next.voiceId, next.provider, next.modelVersion).set({ kind: 'echo', ...next });
  }
}
