/**
 * Studio state on local disk — designed for a single always-on server
 * (the Mac Studio). One JSON document, written atomically, with every change
 * serialized through one queue so concurrent requests never lose writes.
 * Binary media (avatars, voice previews) live next to it as files.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { AuditEntry, StudioState } from './types';

const EMPTY: StudioState = { members: [], agents: [], groups: [], audit: [] };
const SAFE_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

export class StudioStore {
  private state: StudioState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
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
        ? { ...EMPTY, ...(JSON.parse(readFileSync(this.file, 'utf8')) as StudioState) }
        : structuredClone(EMPTY);
    }
    return this.state;
  }

  private persist(state: StudioState) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** A deep copy: callers can't mutate stored state by accident. */
  async read(): Promise<StudioState> {
    await this.queue.catch(() => undefined);
    return structuredClone(this.load());
  }

  /**
   * Run a change against the live state. Throwing inside `fn` aborts the
   * change and leaves the stored state untouched.
   */
  update<T>(fn: (state: StudioState) => T): Promise<T> {
    const run = async () => {
      const draft = structuredClone(this.load());
      const result = fn(draft);
      // Write first: if the disk write fails, memory must not move ahead of disk.
      this.persist(draft);
      this.state = draft;
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

  saveMedia(name: string, data: Buffer): string {
    if (!SAFE_FILE.test(name)) throw new Error('Unsafe media file name');
    writeFileSync(join(this.mediaDir, name), data);
    return name;
  }

  readMedia(name: string): Buffer | null {
    const clean = basename(name);
    if (clean !== name || !SAFE_FILE.test(name)) return null;
    const path = join(this.mediaDir, name);
    return existsSync(path) ? readFileSync(path) : null;
  }
}
