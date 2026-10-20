/**
 * Style profile stores: in-memory, local JSON file and Firestore
 * ('vox_style_profiles').
 *
 * Rows hold aggregate numbers only (see profile.ts). Every written row is
 * parsed with the strict styleProfileSchema first, so an unknown key such as
 * `text` rejects before anything is written; rows that fail the schema on read
 * are treated as absent and deleted. Never stores text, a single message's
 * features, session state or hints. Errors thrown from here are content-free.
 */
import { createHash } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { mkdir, rmdir } from 'fs/promises';
import { dirname } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { needsDeletion, resetStatistics, styleProfileSchema, type StyleProfile, type StyleProfileKey } from './profile';

export const STYLE_PROFILES_COLLECTION = 'vox_style_profiles';
const FIRESTORE_BATCH_LIMIT = 400;

export interface StyleProfileStore {
  get(key: StyleProfileKey): Promise<StyleProfile | null>;
  /** Atomic read-modify-write. Returning null deletes; returning `current` unchanged writes nothing. */
  update(key: StyleProfileKey, fn: (current: StyleProfile | null) => StyleProfile | null): Promise<StyleProfile | null>;
  delete(key: StyleProfileKey): Promise<boolean>;
  /** Personalization withdrawal: every persona and space of that person. */
  deletePerson(personId: string): Promise<number>;
  /** Privacy epoch bump: every row of that persona. */
  deletePersona(personaId: string): Promise<number>;
  listPersona(personaId: string): Promise<StyleProfile[]>;
  /** Used by enroll(). */
  listPerson(personId: string, space: 'work' | 'personal'): Promise<StyleProfile[]>;
  /** Resets expired statistics and deletes rows past the calibration retention. */
  sweep(now: number): Promise<{ reset: number; deleted: number }>;
}

/** sha256 hex of JSON.stringify([personaId, personId, space]). */
export function styleProfileDocId(key: StyleProfileKey): string {
  return createHash('sha256').update(JSON.stringify([key.personaId, key.personId, key.space])).digest('hex');
}

function sameKey(row: StyleProfileKey, key: StyleProfileKey): boolean {
  return row.personaId === key.personaId && row.personId === key.personId && row.space === key.space;
}

/** Parses a candidate row; null when invalid. Never echoes the row. */
function parseRow(value: unknown): StyleProfile | null {
  const result = styleProfileSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Validates a row to write; throws a content-free error. */
function validRowFor(key: StyleProfileKey, next: StyleProfile): StyleProfile {
  if (!next || typeof next !== 'object' || !sameKey(next, key)) throw new Error('style_profile_key_mismatch');
  const parsed = parseRow(next);
  if (!parsed) throw new Error('style_profile_invalid');
  return parsed;
}

/** Detached copy so callers never alias stored rows (rows are plain JSON data). */
function cloneRow(row: StyleProfile): StyleProfile {
  return JSON.parse(JSON.stringify(row)) as StyleProfile;
}

/** Shared sweep decision. */
function sweepRow(row: StyleProfile, now: number): StyleProfile | null | undefined {
  if (row.expiresAt > now) return undefined;
  if (needsDeletion(row, now)) return null;
  return resetStatistics(row, now);
}

export class InMemoryStyleProfileStore implements StyleProfileStore {
  /** Exposed for tests: docId -> row. */
  readonly rows = new Map<string, unknown>();

  private read(id: string): StyleProfile | null {
    if (!this.rows.has(id)) return null;
    const row = parseRow(this.rows.get(id));
    if (!row) this.rows.delete(id);
    return row;
  }

  private all(): StyleProfile[] {
    return [...this.rows.keys()].map(id => this.read(id)).filter((row): row is StyleProfile => row !== null);
  }

  async get(key: StyleProfileKey): Promise<StyleProfile | null> {
    const row = this.read(styleProfileDocId(key));
    return row && sameKey(row, key) ? row : null;
  }

  async update(key: StyleProfileKey, fn: (current: StyleProfile | null) => StyleProfile | null): Promise<StyleProfile | null> {
    const id = styleProfileDocId(key);
    const stored = this.read(id);
    const current = stored && sameKey(stored, key) ? stored : null;
    const next = fn(current);
    if (next === null) { this.rows.delete(id); return null; }
    if (next === current) return current;
    const row = validRowFor(key, next);
    this.rows.set(id, cloneRow(row));
    return row;
  }

  async delete(key: StyleProfileKey): Promise<boolean> {
    return this.rows.delete(styleProfileDocId(key));
  }

  private deleteWhere(match: (row: StyleProfile) => boolean): number {
    let removed = 0;
    for (const id of [...this.rows.keys()]) {
      const row = this.read(id);
      if (row && match(row)) { this.rows.delete(id); removed++; }
    }
    return removed;
  }

  async deletePerson(personId: string): Promise<number> { return this.deleteWhere(row => row.personId === personId); }
  async deletePersona(personaId: string): Promise<number> { return this.deleteWhere(row => row.personaId === personaId); }
  async listPersona(personaId: string): Promise<StyleProfile[]> { return this.all().filter(row => row.personaId === personaId); }
  async listPerson(personId: string, space: 'work' | 'personal'): Promise<StyleProfile[]> {
    return this.all().filter(row => row.personId === personId && row.space === space);
  }

  async sweep(now: number): Promise<{ reset: number; deleted: number }> {
    let reset = 0, deleted = 0;
    for (const row of this.all()) {
      const next = sweepRow(row, now);
      if (next === undefined) continue;
      const id = styleProfileDocId(row);
      if (next === null) { this.rows.delete(id); deleted++; } else { this.rows.set(id, cloneRow(validRowFor(row, next))); reset++; }
    }
    return { reset, deleted };
  }
}

interface StyleProfileFile {
  version: 1;
  profiles: unknown[];
}

/**
 * Local JSON persistence ({version: 1, profiles}), mode 0600, written through a
 * tmp file and rename. Every operation reloads under a process-independent
 * mkdir lock (the memory/file-store.ts pattern). Invalid rows are dropped on load.
 */
export function createFileStyleProfileStore(path: string): StyleProfileStore {
  const memory = new InMemoryStyleProfileStore();

  const reload = (): boolean => {
    memory.rows.clear();
    if (!existsSync(path)) return false;
    let state: Partial<StyleProfileFile> = {};
    try { state = JSON.parse(readFileSync(path, 'utf8')) as Partial<StyleProfileFile>; } catch { return true; }
    let dropped = !Array.isArray(state.profiles) || state.version !== 1;
    for (const candidate of Array.isArray(state.profiles) ? state.profiles : []) {
      const row = parseRow(candidate);
      if (row) memory.rows.set(styleProfileDocId(row), row); else dropped = true;
    }
    return dropped;
  };

  let directoryReady = false;
  const save = () => {
    const state: StyleProfileFile = { version: 1, profiles: [...memory.rows.values()] };
    writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    chmodSync(`${path}.tmp`, 0o600);
    renameSync(`${path}.tmp`, path);
  };

  const withLock = async <T>(operation: () => Promise<T>, mutates: boolean): Promise<T> => {
    if (!directoryReady) { mkdirSync(dirname(path), { recursive: true }); directoryReady = true; }
    let acquired = false;
    for (let attempts = 0; attempts < 500; attempts++) {
      try { await mkdir(`${path}.lock`); acquired = true; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('style_profile_store_unavailable');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    if (!acquired) throw new Error('style_profile_store_busy');
    try {
      const dropped = reload();
      const before = mutates ? JSON.stringify([...memory.rows]) : '';
      const result = await operation();
      if (dropped || (mutates && JSON.stringify([...memory.rows]) !== before)) save();
      return result;
    } finally { await rmdir(`${path}.lock`); }
  };

  return {
    get: key => withLock(() => memory.get(key), false),
    update: (key, fn) => withLock(() => memory.update(key, fn), true),
    delete: key => withLock(() => memory.delete(key), true),
    deletePerson: personId => withLock(() => memory.deletePerson(personId), true),
    deletePersona: personaId => withLock(() => memory.deletePersona(personaId), true),
    listPersona: personaId => withLock(() => memory.listPersona(personaId), false),
    listPerson: (personId, space) => withLock(() => memory.listPerson(personId, space), false),
    sweep: now => withLock(() => memory.sweep(now), true),
  };
}

/** Firestore store. Values are plain numbers (epoch ms), never Timestamps; no field is ever undefined. */
export class FirestoreStyleProfileStore implements StyleProfileStore {
  constructor(private readonly db: Firestore) {}

  private get collection() {
    return this.db.collection(STYLE_PROFILES_COLLECTION);
  }

  async get(key: StyleProfileKey): Promise<StyleProfile | null> {
    const ref = this.collection.doc(styleProfileDocId(key));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const row = parseRow(snap.data());
    if (!row) { await ref.delete(); return null; }
    return sameKey(row, key) ? row : null;
  }

  async update(key: StyleProfileKey, fn: (current: StyleProfile | null) => StyleProfile | null): Promise<StyleProfile | null> {
    const ref = this.collection.doc(styleProfileDocId(key));
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const stored = snap.exists ? parseRow(snap.data()) : null;
      const current = stored && sameKey(stored, key) ? stored : null;
      const next = fn(current);
      if (next === null) {
        if (snap.exists) tx.delete(ref);
        return null;
      }
      if (next === current) return current;
      const row = validRowFor(key, next);
      tx.set(ref, row as unknown as Record<string, unknown>);
      return row;
    });
  }

  async delete(key: StyleProfileKey): Promise<boolean> {
    const ref = this.collection.doc(styleProfileDocId(key));
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  private async deleteWhere(field: 'personId' | 'personaId', value: string): Promise<number> {
    const snap = await this.collection.where(field, '==', value).get();
    const refs = snap.docs.map(doc => doc.ref);
    for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + FIRESTORE_BATCH_LIMIT)) batch.delete(ref);
      await batch.commit();
    }
    return refs.length;
  }

  deletePerson(personId: string): Promise<number> { return this.deleteWhere('personId', personId); }
  deletePersona(personaId: string): Promise<number> { return this.deleteWhere('personaId', personaId); }

  private async listWhere(field: 'personId' | 'personaId', value: string): Promise<StyleProfile[]> {
    const snap = await this.collection.where(field, '==', value).get();
    const rows: StyleProfile[] = [];
    for (const doc of snap.docs) {
      const row = parseRow(doc.data());
      if (row) rows.push(row); else await doc.ref.delete();
    }
    return rows;
  }

  listPersona(personaId: string): Promise<StyleProfile[]> { return this.listWhere('personaId', personaId); }
  async listPerson(personId: string, space: 'work' | 'personal'): Promise<StyleProfile[]> {
    // Filter the space in memory so no composite index is needed.
    return (await this.listWhere('personId', personId)).filter(row => row.space === space);
  }

  async sweep(now: number): Promise<{ reset: number; deleted: number }> {
    const snap = await this.collection.where('expiresAt', '<=', now).get();
    let reset = 0, deleted = 0;
    for (const doc of snap.docs) {
      const outcome = await this.db.runTransaction(async tx => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return 'none' as const;
        const row = parseRow(fresh.data());
        const next = row ? sweepRow(row, now) : null;
        if (next === undefined) return 'none' as const;
        if (next === null || !row) { tx.delete(doc.ref); return 'deleted' as const; }
        tx.set(doc.ref, validRowFor(row, next) as unknown as Record<string, unknown>);
        return 'reset' as const;
      });
      if (outcome === 'reset') reset++;
      else if (outcome === 'deleted') deleted++;
    }
    return { reset, deleted };
  }
}
