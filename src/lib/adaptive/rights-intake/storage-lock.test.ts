import { afterEach, expect, it, vi } from 'vitest';
import { resetFileRuntimeIoHooks, setFileRuntimeIoHooks } from '@/test/fro1-io-fixture';
vi.mock('@/lib/studio/file-runtime-owner', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/studio/file-runtime-owner')>();
  const { instrumentFileRuntime } = await import('@/test/fro1-io-fixture');
  return instrumentFileRuntime(actual);
});
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RightsFileStorage } from './storage';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); resetFileRuntimeIoHooks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'vox-rights-lock-')); roots.push(root);
  const storage = new RightsFileStorage(root), account = 'telegram-account:101';
  const file = join(storage.directory, `${createHash('sha256').update(account).digest('hex')}.json`);
  return { root, storage, account, file, lock: `${file}.lock` };
}
const increment = (raw: unknown | null) => {
  const value = raw === null ? 0 : (raw as { value: number }).value;
  return { document: { value: value + 1 }, result: value + 1 };
};

it('acquires a released lock after EEXIST without losing either writer commit', async () => {
  const f = await fixture();
  await f.storage.transact(f.account, () => ({ document: { value: 0 }, result: undefined }));
  const ready = join(f.root, 'first-ready'), release = join(f.root, 'first-release'), done = join(f.root, 'first-done');
  // A separate real writer is necessary: synchronous EEXIST -> lstat leaves no
  // same-process scheduling gap. It releases only its own lease after commit.
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import { existsSync, writeFileSync } from 'node:fs';
    const module = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/lib/adaptive/rights-intake/storage.ts')).href)});
    const RightsFileStorage = module.RightsFileStorage ?? module.default.RightsFileStorage;
    const store = new RightsFileStorage(${JSON.stringify(f.root)});
    const value = await store.transact(${JSON.stringify(f.account)}, raw => ({ document: { value: raw.value + 1 }, result: raw.value + 1 }), () => {
      writeFileSync(${JSON.stringify(ready)}, 'ready'); process.send('ready');
      const deadline = Date.now() + 2000, sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(${JSON.stringify(release)})) {
        if (Date.now() >= deadline) throw new Error('First writer release was not observed');
        Atomics.wait(sleeper, 0, 0, 1);
      }
    });
    writeFileSync(${JSON.stringify(done)}, JSON.stringify(value));
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = Buffer.alloc(0);
  child.stderr!.on('data', chunk => { stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(0, 8192); });
  // Exit observation never rejects independently of readiness (including a
  // spawn failure), so a startup failure cannot leave an unhandled rejection.
  const exited = new Promise<number | null>(resolve => {
    child.once('error', () => { if (child.pid === undefined) resolve(null); });
    child.once('exit', resolve);
  });
  async function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: ${stderr}`)), milliseconds);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  const childReady = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve()); child.once('error', reject);
    child.once('exit', () => reject(new Error(`First writer exited before readiness: ${stderr}`)));
  });
  let collisions = 0, acquisitions = 0, primaryFailure: unknown;
  try {
    await bounded(childReady, 2000, 'First writer startup timed out'); expect(existsSync(ready)).toBe(true);
    setFileRuntimeIoHooks({ transientDirectory: (path, error) => {
      if (path !== f.lock) return;
      if (!error) { acquisitions++; return; }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return;
      collisions++; writeFileSync(release, 'release');
      const deadline = Date.now() + 2000, sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(done)) {
        if (Date.now() >= deadline) throw new Error(`First writer did not finish: ${stderr}`);
        Atomics.wait(sleeper, 0, 0, 1);
      }
      expect(existsSync(f.lock)).toBe(false);
    } });
    const mutate = vi.fn(increment), beforeCommit = vi.fn();
    expect(await f.storage.transact(f.account, mutate, beforeCommit)).toBe(2);
    expect(JSON.parse(readFileSync(done, 'utf8'))).toBe(1);
    expect(await bounded(exited, 1000, 'First writer exit timed out'), stderr.toString('utf8')).toBe(0);
    expect(collisions).toBe(1);
    expect(acquisitions).toBe(1);
    expect(mutate).toHaveBeenCalledExactlyOnceWith({ value: 1 });
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(f.file, 'utf8'))).toEqual({ value: 2 });
    expect((await fs.readdir(f.storage.directory)).filter(name => name.endsWith('.lock') || name.endsWith('.tmp'))).toEqual([]);
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    try {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        try { await bounded(exited, 500, 'Synthetic writer termination timed out'); }
        catch {
          child.kill('SIGKILL');
          await bounded(exited, 1000, 'Synthetic writer kill was not observed');
        }
      }
    } catch (error) {
      if (primaryFailure instanceof Error) primaryFailure.message += `\nSynthetic writer cleanup failed: ${String(error)}`;
      else if (primaryFailure !== undefined) throw new AggregateError([primaryFailure, error], 'Synthetic writer failed and cleanup failed');
      else throw error;
    }
  }
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
