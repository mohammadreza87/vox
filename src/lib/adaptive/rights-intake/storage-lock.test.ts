import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RightsFileStorage } from './storage';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'vox-rights-lock-')); roots.push(root);
  const storage = new RightsFileStorage(root), account = 'telegram-account:101';
  const file = join(storage.directory, `${createHash('sha256').update(account).digest('hex')}.json`);
  return { root, storage, account, file, lock: `${file}.lock` };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const increment = (raw: unknown | null) => {
  const value = raw === null ? 0 : (raw as { value: number }).value;
  return { document: { value: value + 1 }, result: value + 1 };
};

it('acquires a released lock after EEXIST without losing either writer commit', async () => {
  const f = await fixture();
  await f.storage.transact(f.account, () => ({ document: { value: 0 }, result: undefined }));
  const opened = deferred(), release = deferred(), originalOpen = fs.open.bind(fs), originalMkdir = fs.mkdir.bind(fs);
  // Hold a real first writer after its lease is acquired and before its temp
  // record opens. The competing writer observes EEXIST, then sees the lease
  // disappear before lstat because the first writer finishes normally.
  vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
    opened.resolve(); await release.promise; return originalOpen(...args);
  });
  const first = f.storage.transact(f.account, increment);
  await opened.promise;
  let collisions = 0, acquisitions = 0;
  vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
    try {
      const result = await originalMkdir(...args);
      if (String(args[0]) === f.lock) acquisitions++;
      return result;
    } catch (error) {
      if (String(args[0]) === f.lock && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        collisions++; release.resolve(); await first;
        expect(await fs.lstat(f.lock).catch(() => undefined)).toBeUndefined();
      }
      throw error;
    }
  });
  const mutate = vi.fn(increment), beforeCommit = vi.fn();
  expect(await f.storage.transact(f.account, mutate, beforeCommit)).toBe(2);
  expect(await first).toBe(1);
  expect(collisions).toBe(1);
  expect(acquisitions).toBe(1);
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ value: 1 });
  expect(beforeCommit).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await fs.readFile(f.file, 'utf8'))).toEqual({ value: 2 });
  expect((await fs.readdir(f.storage.directory)).filter(name => name.endsWith('.lock') || name.endsWith('.tmp'))).toEqual([]);
});

it.each(['file', 'symlink'] as const)('refuses a malformed %s lock without mutation or removal', async kind => {
  const f = await fixture(), mutate = vi.fn(increment);
  if (kind === 'file') await fs.writeFile(f.lock, 'LOCK_CANARY', { mode: 0o600 });
  else {
    const target = join(f.root, 'holder'); await fs.mkdir(target); await fs.symlink(target, f.lock);
  }
  await expect(f.storage.transact(f.account, mutate)).rejects.toMatchObject({ code: 'rights_storage_unavailable' });
  expect(mutate).not.toHaveBeenCalled();
  expect((await fs.lstat(f.lock)).isSymbolicLink()).toBe(kind === 'symlink');
  if (kind === 'file') expect(await fs.readFile(f.lock, 'utf8')).toBe('LOCK_CANARY');
  expect(await fs.readFile(f.file).catch(() => undefined)).toBeUndefined();
});

it('keeps the existing three-second bound and never reclaims an active directory lease', async () => {
  const f = await fixture(); await fs.mkdir(f.lock, { mode: 0o700 });
  const original = await fs.lstat(f.lock), mutate = vi.fn(increment);
  // Advance the observed wall clock to the existing deadline; do not wait on or
  // change production timing, and do not remove another writer's lease.
  vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(4000);
  await expect(f.storage.transact(f.account, mutate)).rejects.toMatchObject({ code: 'rights_storage_busy' });
  expect(mutate).not.toHaveBeenCalled();
  expect((await fs.lstat(f.lock)).ino).toBe(original.ino);
  expect(await fs.readFile(f.file).catch(() => undefined)).toBeUndefined();
});
