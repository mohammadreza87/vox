import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage } from '../persistence/storage';
import { AdaptiveRepository } from '../persistence/repository';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
describe('adaptive durable storage', () => {
  it('persists no mutation when the callback throws and never treats corruption as an empty account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-adaptive-storage-')); directories.push(dir);
    const storage = new FileAdaptiveStorage(dir);
    await storage.transact('test', () => ({ document: { count: 1 }, result: true }));
    await expect(storage.transact('test', () => { throw new Error('abort'); })).rejects.toThrow('abort');
    expect(await storage.transact('test', current => ({ document: current, result: current }))).toEqual({ count: 1 });
    const file = join(dir, (await readdir(dir)).find(f => f.endsWith('.json'))!);
    await writeFile(file, 'corrupt');
    await expect(storage.transact('test', () => ({ document: {}, result: null }))).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('corrupt');
  });
  it('uses a separate per-account Firestore transaction and retries on current state', async () => {
    let json: string | undefined;
    const paths: string[] = [];
    const db = { collection: (collection: string) => ({ doc: (id: string) => { paths.push(`${collection}/${id}`); return {}; } }),
      runTransaction: async (fn: (tx: unknown) => unknown) => {
        const tx = { get: async () => ({ exists: json !== undefined, get: () => json }),
          set: (_ref: unknown, value: { json: string }) => { json = value.json; } };
        return fn(tx);
      } } as unknown as Firestore;
    const repo = new AdaptiveRepository(new FirestoreAdaptiveStorage(db));
    await repo.transaction('telegram-account:1', 100, d => { d.revision++; });
    expect(await repo.transaction('telegram-account:1', 100, d => d.revision)).toBe(2);
    expect(paths.every(p => p.startsWith('adaptiveAccounts/') && !p.includes('telegram-account:1'))).toBe(true);
    expect(json).toContain('telegram-account:1');
  });
  it('rejects malformed persisted scope without invoking a mutation', async () => {
    const storage = { transact: async (_id: string, fn: (data: unknown) => unknown) => fn({ schemaVersion: 2 }) };
    const repo = new AdaptiveRepository(storage as never);
    await expect(repo.transaction('telegram-account:1', 100, () => { throw new Error('must not reach'); })).rejects.not.toThrow('must not reach');
  });
});
