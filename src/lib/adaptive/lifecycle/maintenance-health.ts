/** Read-only, bounded inspection of the existing restricted FILE checkpoint.
 * It never claims a lease, observes a durable clock, initializes or repairs data. */
import { createHash } from 'crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, type Stats } from 'fs';
import { join, parse, relative, resolve, sep } from 'path';
import { FileAdaptiveStorage, type AdaptiveStorage } from '../persistence/storage';
import { CHECKPOINT, checkpointSchema } from './maintenance';
import { maintenanceHealthSchema, type MaintenanceHealth } from './maintenance-health-contracts';
const MAX_BYTES = 16_384; // Legitimate strict v1 checkpoints are substantially smaller.
type ReadReason = 'unsafe_path' | 'oversized_checkpoint' | 'unreadable_checkpoint';
class InspectionError extends Error { constructor(readonly reason: ReadReason) { super('Maintenance checkpoint unavailable'); } }
const unsafe = (): never => { throw new InspectionError('unsafe_path'); };
function stat(path: string): Stats | undefined { try { return lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; } }
function canonical(path: string): string {
  let root = resolve(path);
  for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']]) {
    if (root !== alias && !root.startsWith(alias + '/')) continue;
    if (stat(alias)?.isSymbolicLink()) { const link = readlinkSync(alias); if (link !== target && link !== target.slice(1)) unsafe(); root = join(target, relative(alias, root)); }
    break;
  }
  return root;
}
function parents(root: string): { path: string; info: Stats }[] | null {
  const entries: { path: string; info: Stats }[] = []; let current = parse(root).root;
  for (const part of relative(current, root).split(sep).filter(Boolean)) {
    current = join(current, part); const info = stat(current); if (!info) return null;
    if (!info.isDirectory() || info.isSymbolicLink() || current === root && (info.mode & 0o077) !== 0) unsafe();
    entries.push({ path: current, info });
  }
  if (!entries.length) unsafe(); return entries;
}
function same(a: Stats, b: Stats): boolean { return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.nlink === b.nlink; }
function validFile(s: Stats): void { if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600) unsafe(); if (s.size > MAX_BYTES) throw new InspectionError('oversized_checkpoint'); }
function locked(path: string): boolean { const info = stat(path); if (!info) return false; if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) unsafe(); return true; }
function inspect(directory: string): { state: 'missing' } | { state: 'busy' } | { state: 'ready'; raw: string } {
  const root = canonical(directory), chain = parents(root); if (!chain) return { state: 'missing' };
  const file = join(root, createHash('sha256').update(CHECKPOINT).digest('hex') + '.json'), lock = file + '.lock';
  if (locked(lock)) return { state: 'busy' };
  const info = stat(file); if (!info) { if (locked(lock)) return { state: 'busy' }; return { state: 'missing' }; }
  validFile(info); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd); validFile(opened); if (!same(info, opened)) unsafe();
    const buffer = Buffer.alloc(MAX_BYTES + 1); let size = 0;
    while (size < buffer.length) { const n = readSync(fd, buffer, size, buffer.length - size, null); if (!n) break; size += n; }
    if (size > MAX_BYTES) throw new InspectionError('oversized_checkpoint');
    const after = fstatSync(fd), latest = stat(file); if (!latest || !same(opened, after) || !same(after, latest)) unsafe();
    const current = parents(root); if (!current || chain.some((entry, i) => entry.info.ino !== current[i]?.info.ino || entry.info.dev !== current[i]?.info.dev)) unsafe();
    if (locked(lock)) return { state: 'busy' };
    return { state: 'ready', raw: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)) };
  } finally { closeSync(fd); }
}
export function readMaintenanceHealth(storage: AdaptiveStorage, clock: () => number = Date.now): MaintenanceHealth {
  let observedAt: number | null = null;
  const unavailable = (reason: MaintenanceHealth['reason']): MaintenanceHealth => ({ version: 1, state: 'unavailable', observedAt, checkpoint: null, leaseExpiresAt: null, reason });
  try { observedAt = clock(); } catch { return unavailable('invalid_clock'); }
  if (!Number.isSafeInteger(observedAt) || observedAt! < 0) { observedAt = null; return unavailable('invalid_clock'); }
  if (!(storage instanceof FileAdaptiveStorage)) return unavailable('unsupported_store');
  let result: ReturnType<typeof inspect>;
  try { result = inspect(storage.directory); } catch (error) { return unavailable(error instanceof InspectionError ? error.reason : 'unreadable_checkpoint'); }
  try { const latest = clock(); if (!Number.isSafeInteger(latest) || latest < 0) { observedAt = null; return unavailable('invalid_clock'); } if (latest < observedAt!) { observedAt = latest; return unavailable('clock_regressed'); } observedAt = latest; } catch { observedAt = null; return unavailable('invalid_clock'); }
  if (result.state === 'busy') return { version: 1, state: 'busy', observedAt, checkpoint: null, leaseExpiresAt: null, reason: 'checkpoint_locked' };
  if (result.state === 'missing') return { version: 1, state: 'not_started', observedAt, checkpoint: null, leaseExpiresAt: null, reason: null };
  let raw: unknown; try { raw = JSON.parse(result.raw); } catch { return unavailable('invalid_checkpoint'); }
  const parsed = checkpointSchema.safeParse(raw); if (!parsed.success) return unavailable('invalid_checkpoint');
  const d = parsed.data;
  if (d.updatedAt > observedAt!) return unavailable('clock_regressed');
  if ((d.status === 'failed') !== (d.failure === 'sweep_failed') || d.status === 'completed' && d.cursor !== undefined || d.lease && d.lease.until <= d.updatedAt) return unavailable('invalid_checkpoint');
  const state = d.lease ? (d.lease.until > observedAt! ? 'leased' : 'stale') : d.status;
  return maintenanceHealthSchema.parse({ version: 1, state, observedAt,
    checkpoint: { updatedAt: d.updatedAt, recordedStatus: d.status, checkpointedPages: d.pages, checkpointedAccounts: d.accounts, failure: d.failure ?? null },
    leaseExpiresAt: d.lease?.until ?? null, reason: state === 'stale' ? 'lease_expired' : null });
}
