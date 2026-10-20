/** Rights-only file hardening and monotonic read-boundary clock. No canonical
 * adaptive format, account authority, queue index or production policy change. */
import { createHash, randomUUID } from 'crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';
import { join, parse, relative, resolve, sep } from 'path';
import type { AdaptiveStorage, AdaptiveAccountPageInput, AdaptiveAccountPage } from '../persistence/storage';
import { fail } from './repository';
const unavailable = (): never => fail(503, 'rights_storage_unavailable');
const keyFor = (id: string) => createHash('sha256').update(id).digest('hex');
function stat(path: string) {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
/** Only the two exact macOS root aliases may be normalized. Application
 * components remain lexical, so both existing and later ancestor links deny
 * access instead of silently selecting another protected-data directory. */
function canonicalDirectory(path: string): string {
  let absolute = resolve(path);
  for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']] as const) {
    if (absolute !== alias && !absolute.startsWith(`${alias}/`)) continue;
    if (stat(alias)?.isSymbolicLink()) {
      const link = readlinkSync(alias);
      if (link !== target && link !== target.slice(1)) return unavailable();
      absolute = join(target, relative(alias, absolute));
    }
    break;
  }
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const value = stat(current);
    if (!value) break;
    if (!value.isDirectory() || value.isSymbolicLink()) return unavailable();
  }
  return absolute;
}
export class RightsFileStorage implements AdaptiveStorage {
  readonly supportsCommittedWriteFence = true as const;
  readonly directory: string;
  constructor(directory: string) { this.directory = canonicalDirectory(directory); }
  private root(create: boolean): boolean {
    let current = parse(this.directory).root;
    for (const part of relative(current, this.directory).split(sep).filter(Boolean)) {
      current = join(current, part); const value = stat(current);
      if (!value) { if (!create) return false; mkdirSync(current, { mode: 0o700 }); }
      else if (!value.isDirectory() || value.isSymbolicLink() || current === this.directory && (value.mode & 0o077) !== 0) return unavailable();
    }
    return true;
  }
  private record(key: string): unknown | null {
    if (!this.root(false)) return null;
    const file = join(this.directory, `${key}.json`), info = stat(file);
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0) return unavailable();
    let fd: number | undefined;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > 65_536 || opened.ino !== info.ino || opened.dev !== info.dev) return unavailable();
      const raw = readFileSync(fd, 'utf8');
      if (Buffer.byteLength(raw) > 65_536) return unavailable();
      this.root(false);
      const latest = stat(file);
      if (!latest || latest.isSymbolicLink() || latest.ino !== opened.ino || latest.dev !== opened.dev) return unavailable();
      return JSON.parse(raw);
    } catch { return unavailable(); } finally { if (fd !== undefined) closeSync(fd); }
  }
  private guardRecord(accountId: string): void {
    this.root(true);
    const value = stat(join(this.directory, `${keyFor(accountId)}.json`));
    if (value && (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || (value.mode & 0o077) !== 0 || value.size > 65_536)) return unavailable();
  }
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' } {
    const lock = stat(join(this.directory, `${keyFor(accountId)}.json.lock`));
    if (lock) {
      this.root(false); if (!lock.isDirectory() || lock.isSymbolicLink()) return unavailable();
      return { status: 'busy' };
    }
    return { status: 'ready', document: this.record(keyFor(accountId)) };
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    this.guardRecord(accountId);
    const key = keyFor(accountId), file = join(this.directory, `${key}.json`), lock = `${file}.lock`;
    const temporary = `${file}.${randomUUID()}.tmp`, waitUntil = Date.now() + 3000;
    while (true) {
      this.root(true);
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const held = stat(lock);
        if (!held?.isDirectory() || held.isSymbolicLink()) return unavailable();
        if (Date.now() >= waitUntil) return fail(503, 'rights_storage_busy');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try {
      // Every acquisition, including mutations, goes through the bounded
      // no-follow descriptor reader. The generic adapter's async reader is
      // deliberately not used for rights records.
      const raw = this.record(key), original = JSON.stringify(raw), { document, result } = mutate(raw);
      const serialized = JSON.stringify(document);
      if (Buffer.byteLength(serialized) > 65_536) return fail(409, 'rights_capacity');
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
      this.guardRecord(accountId);
      if (JSON.stringify(this.record(key)) !== original) return fail(503, 'rights_storage_busy');
      beforeCommit?.(); renameSync(temporary, file);
      const directory = await fs.open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
      return result === undefined ? result : structuredClone(result);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
      await fs.rmdir(lock);
    }
  }
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20 || input.after !== undefined && !/^[a-f0-9]{64}$/.test(input.after)) return unavailable();
    if (!this.root(false)) return { accountIds: [] };
    const keys: string[] = [];
    for await (const entry of await fs.opendir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) return unavailable();
      const key = entry.name.slice(0, -5);
      if (input.after && key <= input.after) continue;
      keys.push(key); keys.sort(); if (keys.length > input.limit + 1) keys.pop();
    }
    const selected = keys.slice(0, input.limit), accountIds: string[] = [];
    for (const key of selected) {
      const raw = this.record(key);
      if (!raw || typeof raw !== 'object' || !('accountId' in raw) || typeof raw.accountId !== 'string' || !/^telegram-account:[1-9]\d{0,15}$/.test(raw.accountId) || keyFor(raw.accountId) !== key) return unavailable();
      accountIds.push(raw.accountId);
    }
    this.root(false);
    return { accountIds, ...(keys.length > input.limit ? { next: selected.at(-1)! } : {}) };
  }
  /** A bounded clock sidecar, not an account ledger. Status reads may advance it
   * so restart at an earlier time cannot revive expired policy/handles. A crash
   * can leave .clock-v1.lock; subsequent reads fail closed. There is no automatic
   * timeout/reset: an operator must verify the writer is stopped, inspect the
   * durable clock and interrupted temporary file, then remove the stale lock. */
  /** Final-effect fences never acquire the separate clock writer lock. */
  readRightsTimeForEffect():{status:'ready';observedServerTime:number}|{status:'busy'} {
    if(!this.root(false))return unavailable();
    if(stat(join(this.directory,'.clock-v1.lock')))return {status:'busy'};
    const file=join(this.directory,'.clock-v1.json'),info=stat(file);let fd:number|undefined;
    try {
      if(!info || !info.isFile() || info.isSymbolicLink() || info.nlink!==1 || (info.mode&0o077)!==0 || info.size>256)return unavailable();
      fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd);
      if(!opened.isFile() || opened.nlink!==1 || opened.size>256 || opened.ino!==info.ino || opened.dev!==info.dev)return unavailable();
      const raw:unknown=JSON.parse(readFileSync(fd,'utf8'));this.root(false);const latest=stat(file);
      if(!latest || latest.isSymbolicLink() || latest.ino!==opened.ino || latest.dev!==opened.dev || stat(join(this.directory,'.clock-v1.lock')) || !raw || typeof raw!=='object' || Object.keys(raw).sort().join(',')!=='observedServerTime,version' || !('version' in raw) || raw.version!==1 || !('observedServerTime' in raw) || !Number.isSafeInteger(raw.observedServerTime) || Number(raw.observedServerTime)<0)return unavailable();
      return {status:'ready',observedServerTime:Number(raw.observedServerTime)};
    }catch{return unavailable();}finally{if(fd!==undefined)closeSync(fd);}
  }
  observeRightsTime(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) return fail(503, 'rights_clock_unavailable');
    this.root(true);
    const file = join(this.directory, '.clock-v1.json'), lock = join(this.directory, '.clock-v1.lock');
    let fd: number | undefined, locked = false;
    const temporary = join(this.directory, `.clock-v1.${randomUUID()}.tmp`);
    try {
      fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); closeSync(fd); fd = undefined; locked = true;
      const info = stat(file);
      let previous = 0;
      if (info) {
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > 256) return unavailable();
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); const opened = fstatSync(fd);
        if (!opened.isFile() || opened.size > 256 || opened.ino !== info.ino || opened.dev !== info.dev) return unavailable();
        const raw: unknown = JSON.parse(readFileSync(fd, 'utf8')); closeSync(fd); fd = undefined;
        if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'observedServerTime,version' || !('version' in raw) || raw.version !== 1 || !('observedServerTime' in raw) || !Number.isSafeInteger(raw.observedServerTime) || Number(raw.observedServerTime) < 0) return fail(503, 'rights_clock_unavailable');
        previous = Number(raw.observedServerTime);
      }
      if (now < previous) return fail(503, 'rights_clock_unavailable');
      if (now === previous && info) return;
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, JSON.stringify({ version: 1, observedServerTime: now })); fsyncSync(fd); closeSync(fd); fd = undefined;
      this.root(false); const current = stat(file);
      if (current && (!current.isFile() || current.isSymbolicLink() || current.ino !== info?.ino || current.dev !== info?.dev)) return unavailable();
      renameSync(temporary, file);
      fd = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW); fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* Temporary may never have been created. */ }
      if (locked) unlinkSync(lock);
    }
  }
}
