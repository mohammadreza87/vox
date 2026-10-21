import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, rmdirSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { InProcessRevisionSource, sameRevisions } from '../privacy/revisions';
import { loadSnapshot } from '../privacy/snapshot';
import { createFileStores } from '../memory/file-store';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'vox-cross-writer-')); directories.push(dir); return dir; };

it('detects adaptive commits from a different storage instance and fails closed while its writer is busy', async () => {
  const dir = directory(), reader = new FileAdaptiveStorage(dir), writer = new FileAdaptiveStorage(dir), account = 'telegram-account:77';
  await reader.transact(account, () => ({ document: { revision: 1, allowed: true }, result: undefined }));
  const probe = reader.revisionProbe(account), source = new InProcessRevisionSource();
  expect(sameRevisions([probe], await source.read([probe]))).toBe(true);
  await writer.transact(account, () => ({ document: { revision: 2, allowed: false }, result: undefined }));
  expect(sameRevisions([probe], await source.read([probe]))).toBe(false);
  const lock = join(dir, createHash('sha256').update(account).digest('hex') + '.json.lock');
  mkdirSync(lock);
  await expect(source.read([probe])).rejects.toThrow();
  rmdirSync(lock);
});

it('invalidates shared snapshots after another repository commits', async () => {
  const dir = directory(), reader = new SharedMemoryRepository(new FileAdaptiveStorage(dir)), writer = new SharedMemoryRepository(new FileAdaptiveStorage(dir));
  await reader.transaction(d => { d.revision = 1; });
  const snapshot = await loadSnapshot(async () => {}, () => reader.transaction(d => d.revision));
  expect(snapshot.vector.complete).toBe(true);
  await writer.transaction(d => { d.revision = 2; });
  expect(sameRevisions(snapshot.vector.probes, await new InProcessRevisionSource().read(snapshot.vector.probes))).toBe(false);
  expect(await reader.transaction(d => d.revision)).toBe(2);
});

it('reads committed memory and epoch counters after another FILE store forgets a persona', async () => {
  const file = join(directory(), 'memory.json'), reader = createFileStores(file), writer = createFileStores(file);
  const memory = await reader.memories.revisionProbe!('agent'), epoch = await reader.history.epochProbe!('agent');
  await writer.history.clearPersona('agent');
  const source = new InProcessRevisionSource();
  expect(sameRevisions([memory, epoch], await source.read([memory, epoch]))).toBe(false);
  expect(await source.read([epoch])).toEqual([epoch.value + 1]);
});
