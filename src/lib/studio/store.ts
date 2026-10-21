/**
 * Where Studio keeps its state and media. Two implementations:
 *  - StudioStore (this file): local disk, for one always-on server (Mac Studio)
 *  - FirestoreStudioStore: Firestore + Cloud Storage, for serverless production
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { AuditEntry, StudioState } from './types';
import { activeReadScope } from '../tireh/privacy/read-scope';
import { RevisionCounter } from '../tireh/privacy/revisions';

export const EMPTY_STATE: StudioState = { members: [], agents: [], groups: [], audit: [] };
export const SAFE_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

export interface StudioStorage {
  /** A deep copy of the current state. */
  read(): Promise<StudioState>;
  /** File-only effect fence: latest committed state, no awaited work. */
  readCommittedForEffect?(): StudioState;
  /** Apply `fn` to a draft and persist it; throwing inside `fn` changes nothing. `fn` may run more than once. */
  update<T>(fn: (state: StudioState) => T): Promise<T>;
  audit(entry: Omit<AuditEntry, 'at'>): Promise<void>;
  saveMedia(name: string, data: Buffer): Promise<string>;
  readMedia(name: string): Promise<Buffer | null>;
}

/**
 * Local disk: one JSON document, written atomically, with every change
 * serialized through one queue so concurrent requests never lose writes.
 * Binary media (avatars, voice previews) live next to it as files.
 */
export class StudioStore implements StudioStorage {
  private state: StudioState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Monotonic in-process revision of the state, bumped after every committed update. */
  readonly revisions = new RevisionCounter('studio-file');
  readonly mediaDir: string;
  private readonly file: string;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.mediaDir = join(dir, 'media');
    mkdirSync(this.mediaDir, { recursive: true });
    this.file = join(dir, 'studio.json');
  }

  private load(): StudioState {
    if (!this.state) {
      this.state = existsSync(this.file)
        ? { ...EMPTY_STATE, ...(JSON.parse(readFileSync(this.file, 'utf8')) as StudioState) }
        : structuredClone(EMPTY_STATE);
    }
    return this.state;
  }

  private persist(state: StudioState) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** A deep copy: callers can't mutate stored state by accident. Inside a read
   * scope every read of one turn snapshot is served from one committed state. */
  async read(): Promise<StudioState> {
    const scope = activeReadScope();
    if (scope) {
      const loaded = await scope.document(this, 'state', async () => {
        await this.queue.catch(() => undefined);
        // Updates replace the state object and never mutate a published one.
        return { probe: this.revisions.probe('state'), value: this.load() };
      });
      return structuredClone(loaded.value);
    }
    await this.queue.catch(() => undefined);
    return structuredClone(this.load());
  }

  readCommittedForEffect(): StudioState {
    const state: unknown = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : EMPTY_STATE;
    if (!state || typeof state !== 'object' || !('members' in state) || !Array.isArray(state.members) || !('agents' in state) || !Array.isArray(state.agents) || !('groups' in state) || !Array.isArray(state.groups) || !('audit' in state) || !Array.isArray(state.audit)) throw new Error('Invalid Studio state');
    return structuredClone(state) as StudioState;
  }

  /**
   * Run a change against the live state. Throwing inside `fn` aborts the
   * change and leaves the stored state untouched.
   */
  update<T>(fn: (state: StudioState) => T): Promise<T> {
    activeReadScope()?.noteWrite();
    const run = async () => {
      const draft = structuredClone(this.load());
      const result = fn(draft);
      // Write first: if the disk write fails, memory must not move ahead of disk.
      this.persist(draft);
      this.state = draft;
      this.revisions.bump('state');
      // Results often point into the draft; hand back a copy so callers can't
      // mutate stored state without going through update().
      return result === undefined ? result : structuredClone(result);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  audit(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    return this.update((s) => {
      s.audit.push({ ...entry, at: new Date().toISOString() });
      if (s.audit.length > 5000) s.audit.splice(0, s.audit.length - 5000);
    });
  }

  async saveMedia(name: string, data: Buffer): Promise<string> {
    if (!SAFE_FILE.test(name)) throw new Error('Unsafe media file name');
    writeFileSync(join(this.mediaDir, name), data);
    return name;
  }

  async readMedia(name: string): Promise<Buffer | null> {
    const clean = basename(name);
    if (clean !== name || !SAFE_FILE.test(name)) return null;
    const path = join(this.mediaDir, name);
    return existsSync(path) ? readFileSync(path) : null;
  }
}
