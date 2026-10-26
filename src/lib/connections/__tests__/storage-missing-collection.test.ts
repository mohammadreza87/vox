import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionsRecords, RecordCollection } from '../contracts';
import { COLLECTIONS_ADDED_LATER, FileConnectionsStorage, collectionFiles, type RawConnectionsRecords } from '../storage';

/**
 * Settings Part 2b S0: a release that adds a record collection must still read partitions written before it existed.
 * Only a collection listed as added later may be missing from the committed generation (it reads as empty). Every other
 * collection (tombstones, grants) was always written, so a missing directory is damage and fails closed, as does a missing generation.
 */
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory))); });
const rm = (directory: string) => fs.rm(directory, { recursive: true, force: true });
const key = (value: string) => createHash('sha256').update(value).digest('hex');
const PARTITION = 'qa-partition';

async function seeded() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'vox-connections-missing-')); directories.push(directory);
  const storage = new FileConnectionsStorage(directory);
  await storage.transact(PARTITION, raw => ({ records: { ...raw, audits: [{ id: 'qa-audit' }], occurrences: [{ id: 'qa-occurrence' }] } as unknown as ConnectionsRecords, result: undefined }));
  const root = join(directory, key(PARTITION));
  const generation = (JSON.parse(await fs.readFile(join(root, 'current.json'), 'utf8')) as { generation: string }).generation;
  return { directory, storage, root, generation };
}

/** Runs `run` as a release that added `occurrences` after the partition was written. */
async function withOccurrencesAddedLater<T>(run: () => Promise<T>): Promise<T> {
  const later = COLLECTIONS_ADDED_LATER as RecordCollection[];
  later.push('occurrences');
  try { return await run(); } finally { later.pop(); }
}

describe('file storage: a collection added after a partition was written', () => {
  it('no collection is listed as added later today: every one is in each generation written so far', () => {
    expect(COLLECTIONS_ADDED_LATER).toEqual([]);
  });

  it('a missing tombstones directory fails closed: peek and transact throw, nothing is rewritten without it', async () => {
    const f = await seeded();
    await f.storage.transact(PARTITION, raw => ({ records: { ...raw, tombstones: [{ id: 'qa-tombstone' }] } as unknown as ConnectionsRecords, result: undefined }));
    const generation = (JSON.parse(await fs.readFile(join(f.root, 'current.json'), 'utf8')) as { generation: string }).generation;
    await rm(join(f.root, generation, 'tombstones'));
    await expect(f.storage.peek(PARTITION)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.storage.transact(PARTITION, raw => ({ records: { ...raw, audits: [] } as unknown as ConnectionsRecords, result: undefined }))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((JSON.parse(await fs.readFile(join(f.root, 'current.json'), 'utf8')) as { generation: string }).generation).toBe(generation);
    await expect(fs.stat(join(f.root, 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a missing directory of an always-written collection fails closed even for the newest one', async () => {
    const f = await seeded();
    await rm(join(f.root, f.generation, 'occurrences'));
    await expect(f.storage.peek(PARTITION)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(collectionFiles(join(f.root, f.generation), 'occurrences')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await collectionFiles(join(f.root, f.generation), 'occurrences', ['occurrences'])).toBeNull();
  });

  it('an old partition without a newer collection directory peeks and transacts, then gains the directory', () => withOccurrencesAddedLater(async () => {
    const f = await seeded();
    // Simulate a partition written before `occurrences` existed.
    await rm(join(f.root, f.generation, 'occurrences'));
    const peeked = await f.storage.peek(PARTITION);
    expect(peeked.occurrences).toEqual([]);
    expect(peeked.audits).toEqual([{ id: 'qa-audit' }]);
    let seen: RawConnectionsRecords | undefined;
    await f.storage.transact(PARTITION, raw => { seen = raw; return { records: { ...raw, occurrences: [{ id: 'qa-new' }] } as unknown as ConnectionsRecords, result: undefined }; });
    expect(seen?.occurrences).toEqual([]);
    expect(seen?.audits).toEqual([{ id: 'qa-audit' }]);
    const next = (JSON.parse(await fs.readFile(join(f.root, 'current.json'), 'utf8')) as { generation: string }).generation;
    expect(next).not.toBe(f.generation);
    expect(await fs.readdir(join(f.root, next, 'occurrences'))).toHaveLength(1);
    expect((await f.storage.peek(PARTITION)).occurrences).toEqual([{ id: 'qa-new' }]);
  }));

  it('an unchanged transaction over the old partition writes nothing and still reads the rows', () => withOccurrencesAddedLater(async () => {
    const f = await seeded();
    await rm(join(f.root, f.generation, 'occurrences'));
    expect(await f.storage.transact(PARTITION, raw => ({ records: raw as unknown as ConnectionsRecords, result: raw.audits.length }))).toBe(1);
    expect((JSON.parse(await fs.readFile(join(f.root, 'current.json'), 'utf8')) as { generation: string }).generation).toBe(f.generation);
  }));

  it('a missing generation still retries, then throws: it never reads as an empty partition', () => withOccurrencesAddedLater(async () => {
    const f = await seeded();
    await rm(join(f.root, f.generation));
    await expect(f.storage.peek(PARTITION)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.storage.transact(PARTITION, raw => ({ records: raw as unknown as ConnectionsRecords, result: undefined }))).rejects.toMatchObject({ code: 'ENOENT' });
    // The failed transaction released its lock and left the pointer alone.
    await expect(fs.stat(join(f.root, 'lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((JSON.parse(await fs.readFile(join(f.root, 'current.json'), 'utf8')) as { generation: string }).generation).toBe(f.generation);
  }));

  it('manager counts fail closed when the connections directory is missing, never counting it as none', async () => {
    const f = await seeded();
    await rm(join(f.root, f.generation, 'connections'));
    await expect(f.storage.countLivePeopleByAgent('qa-agent')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
