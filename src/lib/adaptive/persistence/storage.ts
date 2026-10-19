/** Separate account documents; never shares the administrator-readable Studio state. */
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';

export interface AdaptiveStorage {
  /** Callback must be synchronous and retry safe. A throw commits nothing. */
  transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T>;
}
export const MAX_ADAPTIVE_DOCUMENT_BYTES = 700_000;
const key = (id: string) => createHash('sha256').update(id).digest('hex');
function encode(document: unknown): string {
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json) > MAX_ADAPTIVE_DOCUMENT_BYTES) throw new Error('Adaptive account storage capacity reached');
  return json;
}

/** Cross-instance process locks, fsync and atomic rename. A crashed lock fails closed;
 * an operator must inspect/remove it after verifying no writer still owns it. */
export class FileAdaptiveStorage implements AdaptiveStorage {
  constructor(readonly directory: string) {}
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${key(accountId)}.json`);
    const lock = `${file}.lock`;
    const deadline = Date.now() + 3000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Adaptive storage is busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      let current: unknown | null;
      try { current = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        current = null;
      }
      const { document, result } = mutate(current);
      const json = encode(document);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, file);
      const directory = await fs.open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result === undefined ? result : structuredClone(result);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
      await fs.rmdir(lock);
    }
  }
}

export class FirestoreAdaptiveStorage implements AdaptiveStorage {
  constructor(private readonly db: Firestore, private readonly collection = 'adaptiveAccounts') {}
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }): Promise<T> {
    const ref = this.db.collection(this.collection).doc(key(accountId));
    const result = await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const raw = snap.exists ? snap.get('json') : null;
      // Existing malformed documents never become an empty account.
      if (snap.exists && typeof raw !== 'string') throw new Error('Invalid adaptive document');
      const { document, result } = mutate(raw === null ? null : JSON.parse(raw));
      tx.set(ref, { json: encode(document), updatedAt: new Date() });
      return result;
    });
    return result === undefined ? result : structuredClone(result);
  }
}
