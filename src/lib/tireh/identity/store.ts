/**
 * Style profile stores (S10L): in-memory, file and Firestore ('vox_style_profiles').
 *
 * Every write and every read is validated with the strict styleProfileSchema,
 * so nothing outside the content-free profile shape (for example a `text`
 * field) can be persisted or loaded. Invalid rows are rejected with the fixed
 * error 'style_profile_invalid' (never carrying values) or, on read, deleted
 * best-effort and treated as absent. Rows carry no content, message ids, chat
 * ids or persona ids; Firestore document ids are hashed. No store logs.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { profileDocId, styleProfileSchema, type StyleProfile } from './profile';
import type { IdentitySpace } from './types';

export const STYLE_PROFILES_COLLECTION = 'vox_style_profiles';

export interface StyleProfileStore {
  get(personId: string, space: 'work' | 'personal'): Promise<StyleProfile | null>;
  put(profile: StyleProfile): Promise<void>;                 // strict-schema validated; rejects Error('style_profile_invalid')
  delete(personId: string, space: 'work' | 'personal'): Promise<void>;
  deleteAllFor(personId: string): Promise<number>;           // both spaces (erasure)
  list(space: 'work' | 'personal'): Promise<StyleProfile[]>; // fairness evaluation only
  sweep(cutoff: number): Promise<number>;                    // deletes updatedAt < cutoff
}

const SPACES: readonly IdentitySpace[] = ['work', 'personal'];

/** Drops undefined optional fields so files and Firestore never see `undefined`. */
function clean(profile: StyleProfile): StyleProfile {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) if (value !== undefined) out[key] = value;
  return out as unknown as StyleProfile;
}

function parse(value: unknown): StyleProfile | null {
  const result = styleProfileSchema.safeParse(value);
  return result.success ? clean(result.data) : null;
}

function validated(profile: StyleProfile): StyleProfile {
  const parsed = parse(profile);
  if (!parsed) throw new Error('style_profile_invalid');
  return parsed;
}

/** A stored row is only usable for the key it was stored under. */
function parseFor(value: unknown, docId: string): StyleProfile | null {
  const parsed = parse(value);
  return parsed && profileDocId(parsed.personId, parsed.space) === docId ? parsed : null;
}

export class InMemoryStyleProfileStore implements StyleProfileStore {
  private readonly rows = new Map<string, StyleProfile>();

  async get(personId: string, space: IdentitySpace): Promise<StyleProfile | null> {
    const id = profileDocId(personId, space);
    const row = this.rows.get(id);
    if (row === undefined) return null;
    const parsed = parseFor(row, id);
    if (!parsed) { this.rows.delete(id); return null; }
    return structuredClone(parsed);
  }

  async put(profile: StyleProfile): Promise<void> {
    const row = validated(profile);
    this.rows.set(profileDocId(row.personId, row.space), structuredClone(row));
  }

  async delete(personId: string, space: IdentitySpace): Promise<void> {
    this.rows.delete(profileDocId(personId, space));
  }

  async deleteAllFor(personId: string): Promise<number> {
    let removed = 0;
    for (const space of SPACES) if (this.rows.delete(profileDocId(personId, space))) removed++;
    return removed;
  }

  async list(space: IdentitySpace): Promise<StyleProfile[]> {
    const out: StyleProfile[] = [];
    for (const [id, row] of [...this.rows.entries()]) {
      const parsed = parseFor(row, id);
      if (!parsed) { this.rows.delete(id); continue; }
      if (parsed.space === space) out.push(structuredClone(parsed));
    }
    return out;
  }

  async sweep(cutoff: number): Promise<number> {
    let removed = 0;
    for (const [id, row] of [...this.rows.entries()]) {
      if (row.updatedAt < cutoff) { this.rows.delete(id); removed++; }
    }
    return removed;
  }
}

interface FileState { version: 1; profiles: Record<string, unknown> }

/**
 * JSON file store for the Mac file profile. It assumes ONE writing process:
 * mutations are serialised through an in-process promise chain, the file is
 * reloaded at the start of every operation, and writes go through a 0600 temp
 * file and an atomic rename (as memory/file-store.ts does). If the Studio ever
 * runs several processes on one profile, port memory/file-store.ts's mkdir lock.
 */
export function createFileStyleProfileStore(path: string): StyleProfileStore {
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = chain.then(operation, operation);
    chain = run.catch(() => undefined);
    return run;
  };

  const load = async (): Promise<FileState> => {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return { version: 1, profiles: {} };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version === 1) {
        const profiles = (parsed as { profiles?: unknown }).profiles;
        if (typeof profiles === 'object' && profiles !== null && !Array.isArray(profiles)) {
          return { version: 1, profiles: { ...(profiles as Record<string, unknown>) } };
        }
      }
    } catch {
      // an unreadable file holds nothing usable
    }
    return { version: 1, profiles: {} };
  };

  const save = async (state: FileState): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  };

  /** Validates every row; drops invalid ones from `state` and reports whether any were dropped. */
  const validRows = (state: FileState): { rows: Map<string, StyleProfile>; dropped: boolean } => {
    const rows = new Map<string, StyleProfile>();
    let dropped = false;
    for (const [id, value] of Object.entries(state.profiles)) {
      const parsed = parseFor(value, id);
      if (parsed) rows.set(id, parsed);
      else { delete state.profiles[id]; dropped = true; }
    }
    return { rows, dropped };
  };

  const saveBestEffort = async (state: FileState): Promise<void> => {
    try { await save(state); } catch { /* best-effort cleanup of invalid rows */ }
  };

  return {
    get: (personId, space) => exclusive(async () => {
      const state = await load();
      const id = profileDocId(personId, space);
      if (!(id in state.profiles)) return null;
      const parsed = parseFor(state.profiles[id], id);
      if (!parsed) {
        delete state.profiles[id];
        await saveBestEffort(state);
        return null;
      }
      return parsed;
    }),
    put: (profile) => exclusive(async () => {
      const row = validated(profile);
      const state = await load();
      state.profiles[profileDocId(row.personId, row.space)] = row;
      await save(state);
    }),
    delete: (personId, space) => exclusive(async () => {
      const state = await load();
      const id = profileDocId(personId, space);
      if (!(id in state.profiles)) return;
      delete state.profiles[id];
      await save(state);
    }),
    deleteAllFor: (personId) => exclusive(async () => {
      const state = await load();
      let removed = 0;
      for (const space of SPACES) {
        const id = profileDocId(personId, space);
        if (id in state.profiles) { delete state.profiles[id]; removed++; }
      }
      if (removed > 0) await save(state);
      return removed;
    }),
    list: (space) => exclusive(async () => {
      const state = await load();
      const { rows, dropped } = validRows(state);
      if (dropped) await saveBestEffort(state);
      return [...rows.values()].filter(row => row.space === space);
    }),
    sweep: (cutoff) => exclusive(async () => {
      const state = await load();
      const { rows, dropped } = validRows(state);
      let removed = 0;
      for (const [id, row] of rows) {
        if (row.updatedAt < cutoff) { delete state.profiles[id]; removed++; }
      }
      if (removed > 0 || dropped) await save(state);
      return removed;
    }),
  };
}

/** Firestore store: documents at vox_style_profiles/{profileDocId}. No composite index is needed. */
export class FirestoreStyleProfileStore implements StyleProfileStore {
  constructor(private readonly db: Firestore) {}

  private collection() {
    return this.db.collection(STYLE_PROFILES_COLLECTION);
  }

  async get(personId: string, space: IdentitySpace): Promise<StyleProfile | null> {
    const id = profileDocId(personId, space);
    const ref = this.collection().doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const parsed = parseFor(snapshot.data(), id);
    if (!parsed) {
      try { await ref.delete(); } catch { /* best-effort cleanup */ }
      return null;
    }
    return parsed;
  }

  async put(profile: StyleProfile): Promise<void> {
    const row = validated(profile);
    await this.collection().doc(profileDocId(row.personId, row.space)).set(clean(row));
  }

  async delete(personId: string, space: IdentitySpace): Promise<void> {
    await this.collection().doc(profileDocId(personId, space)).delete();
  }

  async deleteAllFor(personId: string): Promise<number> {
    const ids = new Set(SPACES.map(space => profileDocId(personId, space)));
    const snapshot = await this.collection().where('personId', '==', personId).get();
    for (const doc of snapshot.docs) ids.add(doc.id);
    let removed = 0;
    for (const id of ids) {
      const ref = this.collection().doc(id);
      const existing = await ref.get();
      if (!existing.exists) continue;
      await ref.delete();
      removed++;
    }
    return removed;
  }

  async list(space: IdentitySpace): Promise<StyleProfile[]> {
    const snapshot = await this.collection().where('space', '==', space).get();
    const out: StyleProfile[] = [];
    for (const doc of snapshot.docs) {
      const parsed = parseFor(doc.data(), doc.id);
      if (parsed) { if (parsed.space === space) out.push(parsed); continue; }
      try { await doc.ref.delete(); } catch { /* best-effort cleanup */ }
    }
    return out;
  }

  async sweep(cutoff: number): Promise<number> {
    let removed = 0;
    for (const space of SPACES) {
      for (const row of await this.list(space)) {
        if (row.updatedAt < cutoff) {
          await this.collection().doc(profileDocId(row.personId, row.space)).delete();
          removed++;
        }
      }
    }
    return removed;
  }
}
