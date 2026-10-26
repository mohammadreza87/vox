import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage } from '../persistence/storage';
import { AdaptiveRepository } from '../persistence/repository';
import { ChannelDrafts, DRAFT_TTL_MS, draftKey, textHash, type ChannelDraft } from '../../circles/channels';
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
  it('shared FILE storage preserves generic JSON and null post-images without inventing an ARC format marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-generic-file-null-')); directories.push(dir);
    const storage = new FileAdaptiveStorage(dir), key = 'qa-shared-non-account';
    for (const document of [null, { v: 1, drafts: [] }, [], false, 0, 'synthetic-generic-json', null]) {
      await storage.transact(key, () => ({ document, result: undefined }));
      const reopened = new FileAdaptiveStorage(dir).readCommittedForEffect(key);
      expect(reopened).toEqual({ status: 'ready', document });
    }
    const files = await readdir(dir); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(await readFile(join(dir, files[0]), 'utf8')).toBe('null');
  });

  it('actual ChannelDrafts take, expiry and erasure blank only their non-account FILE records across reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-channel-null-regression-')); directories.push(dir);
    const now = new Date('2026-10-27T00:00:00.000Z'), owner = 70300, other = 70400, agent = 'qa-channel-agent';
    let storage = new FileAdaptiveStorage(dir), drafts = new ChannelDrafts(storage);
    const value: ChannelDraft = { id: 'AAAAAAAAAAAA', chatIds: [-77001], silent: true,
      textHash: textHash('SYNTHETIC_CHANNEL_PREVIEW_NOT_STORED'), createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(), via: 'studio' };
    expect(await drafts.list(agent, owner, now)).toEqual([]); expect(await readdir(dir)).toEqual([]);
    await drafts.update(agent, owner, now, () => ({ drafts: [value], result: undefined }));
    expect(await drafts.take(agent, owner, value.id, now, value.textHash)).toEqual(value);
    expect(storage.readCommittedForEffect(draftKey(agent, owner))).toEqual({ status: 'ready', document: null });
    storage = new FileAdaptiveStorage(dir); drafts = new ChannelDrafts(storage);
    expect(await drafts.list(agent, owner, now)).toEqual([]);
    await drafts.restore(agent, owner, value, now);
    expect(await drafts.list(agent, owner, new Date(now.getTime() + DRAFT_TTL_MS))).toEqual([]);
    expect(storage.readCommittedForEffect(draftKey(agent, owner))).toEqual({ status: 'ready', document: null });
    const later = new Date(now.getTime() + DRAFT_TTL_MS + 1000), laterValue = { ...value,
      createdAt: later.toISOString(), expiresAt: new Date(later.getTime() + DRAFT_TTL_MS).toISOString() };
    for (const [a, person] of [[agent, owner], ['qa-other-agent', owner], [agent, other]] as const) {
      await drafts.update(a, person, later, () => ({ drafts: [laterValue], result: undefined }));
    }
    expect(await drafts.eraseUser(owner, [agent, 'qa-other-agent'])).toBe(2);
    expect(storage.readCommittedForEffect(draftKey(agent, owner))).toEqual({ status: 'ready', document: null });
    expect(storage.readCommittedForEffect(draftKey('qa-other-agent', owner))).toEqual({ status: 'ready', document: null });
    expect(await new ChannelDrafts(new FileAdaptiveStorage(dir)).list(agent, other, later)).toEqual([laterValue]);
    expect((await readdir(dir)).every(name => /^[a-f0-9]{64}\.json$/.test(name))).toBe(true);
  });

  it('corrupt ARC property presence cannot be cleared or overwritten through a generic shared FILE transaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-corrupt-arc-null-')); directories.push(dir);
    const storage = new FileAdaptiveStorage(dir), key = 'qa-non-account-corrupt-arc';
    await storage.transact(key, () => ({ document: { v: 1, drafts: [] }, result: undefined }));
    const file = join(dir, (await readdir(dir))[0]);
    for (const corrupt of [null, false, 0, '', [], {}]) {
      const persisted = JSON.stringify({ v: 1, drafts: [], assistantDeliveryControl: corrupt }); await writeFile(file, persisted);
      for (const replacement of [null, { v: 1, drafts: [] }]) {
        await expect(storage.transact(key, () => ({ document: replacement, result: undefined }))).rejects.toThrow();
        expect(await readFile(file, 'utf8')).toBe(persisted);
      }
    }
  });

});
